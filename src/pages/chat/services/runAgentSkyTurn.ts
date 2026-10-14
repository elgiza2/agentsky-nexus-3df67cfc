/** Runs OpenClaw through AgentSky while preserving Megsy's original chat surface. */
import type React from "react";
import { agentApi, openStream, type AgentRequest, type RawEvent } from "@/lib/agentsky/client";
import { buildTranscript, orbStateFor, type AgentTurn, type Lang } from "@/lib/agentsky/transcript";
import type { Message, ToolPart } from "../chatConstants";
import { loadWorkspace, workspace } from "@/lib/agentsky/store";
import { detectMediaIntent } from "@/lib/agentsky/mediaIntent";
import type { AttachedFile } from "../hooks/useAttachments";

type Args = {
  text: string;
  userMsg: Message;
  localTurnId: string;
  sessionId?: string;
  agentId?: string;
  hasPriorTurns?: boolean;
  lang: Lang;
  images?: string[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setInput: (value: string) => void;
  setAttachedFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  setIsLoading: (value: boolean) => void;
  setIsThinking: (value: boolean) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  createOrUpdateConversation: (title: string) => Promise<string | null>;
  saveMessage: (
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    images?: string[],
    metadata?: Record<string, unknown>,
  ) => Promise<string | undefined>;
  ownInsertedIdsRef: React.MutableRefObject<Set<string>>;
  onRequests: (requests: AgentRequest[]) => void;
  onSession: (sessionId: string) => void;
  /** Live narration hook so the fast agent can narrate while this specialist works. */
  onNarrate?: (text: string) => void;
  /** Short human label for the specialist, used in narration lines. */
  agentLabel?: string;
};

const toToolParts = (turn?: AgentTurn): ToolPart[] | undefined =>
  turn?.steps
    .filter((step) => step.kind !== "thought")
    .map((step) => ({
      id: step.id,
      name: step.label,
      state: step.status === "active" ? "running" : step.status,
    }));

export async function runAgentSkyTurn(args: Args): Promise<void> {
  const mediaTurn = Boolean(detectMediaIntent(args.text));
  // Higgsfield only handles images and video; other messages go to the regular agent.
  const selectedAgentId = mediaTurn ? "higgsfield" : args.agentId === "higgsfield" ? undefined : args.agentId;
  const assistantClientId = `assistant-${args.localTurnId}`;
  const controller = new AbortController();
  args.abortControllerRef.current = controller;
  const update = (patch: Partial<Message>) => args.setMessages((prev) => prev.map((message) => message.clientId === assistantClientId ? { ...message, ...patch } : message));
  // The fast agent announces the specialist first, then the robot wakes up
  // (awakening) and starts working. These narration lines keep the fast
  // agent's voice alive while the specialist runs.
  const narrate = (text: string) => {
    const value = String(text || "").trim();
    if (!value) return;
    try {
      args.onNarrate?.(value);
    } catch {
      /* narration must never break the turn */
    }
  };
  const specialistName = args.agentLabel || selectedAgentId || (mediaTurn ? "higgsfield" : "specialist");
  args.setMessages((prev) => [...prev, args.userMsg, {
    role: "assistant", content: "", clientId: assistantClientId, agentPending: true,
    agentSkyState: args.sessionId || args.hasPriorTurns ? "thinking" : "awakening", modelLabel: mediaTurn ? "higgsfield · Hypit" : "OpenClaw · gpt-5.6-luna",
    ...(mediaTurn ? { agentSkyAgent: { id: "higgsfield", name: "higgsfield", color: "sun" as const } } : {}),
  }]);
  narrate(args.lang === "ar" ? `الوكيل ${specialistName} بيصحى دلوقتي…` : `Waking up ${specialistName}…`);
  args.setInput("");
  args.setAttachedFiles([]);
  args.setIsLoading(true);
  args.setIsThinking(true);

  let sid = mediaTurn ? undefined : args.sessionId;
  let events: RawEvent[] = [];
  let turn: AgentTurn | undefined;
  let conversationId: string | null = null;
  let requests: AgentRequest[] = [];
  let identity: Message["agentSkyAgent"];
  let failure: string | undefined;
  let stopped = false;
  const baseline = new Set<string>();
  const received = new Set<string>();
  let started = false;
  let lastNarratedStep = "";
  const apply = (running: boolean) => {
    const turns = buildTranscript(events, args.lang, running);
    turn = [...turns].reverse().find((item): item is AgentTurn => item.type === "agent");
    // Narrate each new specialist step live so the user follows the work.
    try {
      const steps = turn?.steps ?? [];
      const latest = [...steps].reverse().find((s) => s.status === "active") ?? steps[steps.length - 1];
      const label = latest ? String(latest.label || "").trim() : "";
      if (label && label !== lastNarratedStep) {
        lastNarratedStep = label;
        narrate(args.lang === "ar" ? `${specialistName}: ${label}` : `${specialistName}: ${label}`);
      }
    } catch {
      /* ignore narration errors */
    }
    update({
      content: turn?.text || "", agentPending: running && !turn?.text,
      agentSkyState: stopped ? "idle" : orbStateFor(turn, running),
      agentSkySteps: turn?.steps ?? [], toolParts: toToolParts(turn),
      agentSkyCards: turn?.cards, agentSkyStopped: stopped,
      reasoning: turn?.steps.filter((step) => step.kind === "thought").map((step) => step.detail || step.label).join("\n"),
    });
  };
  const conversationPromise = args.createOrUpdateConversation(args.text || "New chat").catch(() => null);
  try {
    await loadWorkspace();
    if (mediaTurn) identity = { id: "higgsfield", name: "higgsfield", color: "sun" };
    if (sid) {
      const existing = await agentApi.session(sid);
      identity = workspace.agent(existing.session.agentId);
      const history = await agentApi.events(sid);
      history.events.forEach((event) => baseline.add(event.id));
    } else {
      if (!mediaTurn) identity = workspace.agent(selectedAgentId);
    }
    if (identity) identity = { id: identity.id, name: identity.name, color: identity.color };
    update({ agentSkyAgent: identity });
    if (controller.signal.aborted) { stopped = true; return; }
    if (!sid) {
      const created = await agentApi.createSession({ agentId: selectedAgentId, text: args.text, images: args.images });
      sid = created.session.id;
      workspace.upsertSession(created.session);
      if (created.agent) workspace.addAgent(created.agent);
      const selected = created.agent ?? workspace.agent(created.session.agentId);
      if (selected) identity = { id: selected.id, name: selected.name, color: selected.color };
    } else {
      await agentApi.send(sid, args.text, args.images);
    }
    const activeSid = sid;
    args.onSession(activeSid);
    update({ agentSkySessionId: activeSid, agentSkyAgent: identity });
    const interrupt = () => { void agentApi.interrupt(activeSid).catch(() => undefined); };
    if (controller.signal.aborted) { stopped = true; interrupt(); return; }
    controller.signal.addEventListener("abort", interrupt, { once: true });
    const feedController = new AbortController();
    const abortFeed = () => feedController.abort();
    controller.signal.addEventListener("abort", abortFeed, { once: true });
    let terminalSeen = false;
    let checking = false;
    const accept = (event: RawEvent) => {
      if (baseline.has(event.id) || received.has(event.id)) return false;
      received.add(event.id);
      if (event.type === "session.status_idle" && !started) return false;
      if (event.type === "session.status_running" || event.type.startsWith("agent.")) started = true;
      events.push(event);
      const terminal = event.type === "session.status_idle" || event.type === "session.error";
      terminalSeen ||= terminal;
      apply(!terminal);
      return terminal;
    };
    // The standing feed can omit status frames; reconcile against persisted events.
    const reconcile = setInterval(async () => {
      if (checking || terminalSeen || controller.signal.aborted) return;
      checking = true;
      try {
        const history = await agentApi.events(activeSid);
        if (controller.signal.aborted || terminalSeen) return;
        for (const event of history.events) {
          if (accept(event)) { feedController.abort(); break; }
        }
      } catch { /* Keep the live feed; the next check can recover. */ }
      finally { checking = false; }
    }, 2500);
    try {
      // A dropped connection never ends the task: reconnect until a terminal event arrives.
      let failures = 0;
      while (!terminalSeen && !controller.signal.aborted) {
        try {
          await openStream(activeSid, accept, feedController.signal);
          failures = 0;
        } catch {
          if (terminalSeen || controller.signal.aborted) break;
          failures++;
        }
        if (terminalSeen || controller.signal.aborted) break;
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** Math.min(failures, 4))));
      }
    } finally {
      clearInterval(reconcile);
      controller.signal.removeEventListener("abort", abortFeed);
      controller.signal.removeEventListener("abort", interrupt);
    }
    if (controller.signal.aborted) { stopped = true; return; }
    apply(false);
    requests = (await agentApi.requests(activeSid).catch(() => ({ requests: [], sessions: [] }))).requests;
    args.onRequests(requests);
    update({ agentSkyRequests: requests });
  } catch (error) {
    stopped = controller.signal.aborted;
    if (!stopped) failure = error instanceof Error ? error.message : (args.lang === "ar" ? "تعذّر تشغيل الوكيل." : "Could not run the agent.");
  } finally {
    stopped = stopped || controller.signal.aborted;
    apply(false);
    update({ agentPending: false, agentSkyState: failure || turn?.error ? "error" : stopped ? "idle" : "done", agentSkyStopped: stopped, ...(failure ? { content: turn?.text ? `${turn.text}\n\n${failure}` : failure } : {}) });
    if (args.abortControllerRef.current === controller) args.abortControllerRef.current = null;
    args.setIsLoading(false);
    args.setIsThinking(false);
    conversationId = await conversationPromise;
    if (conversationId) {
      try {
        const userId = await args.saveMessage(conversationId, "user", args.userMsg.content, args.images);
        if (userId) args.ownInsertedIdsRef.current.add(userId);
        const metadata = {
          kind: "agentSky", agentSkySessionId: sid, agentSkyAgent: identity,
          agentSkySteps: turn?.steps ?? [], agentSkyStopped: stopped,
          agentSkyState: failure || turn?.error ? "error" : "done",
          agentSkyCards: turn?.cards ?? [], agentSkyRequests: requests,
          reasoning: turn?.steps.filter((step) => step.kind === "thought").map((step) => step.detail || step.label).join("\n"),
          toolParts: toToolParts(turn), modelLabel: mediaTurn ? "higgsfield · Hypit" : "OpenClaw · gpt-5.6-luna",
        };
        const text = failure || turn?.error || turn?.text || (stopped ? (args.lang === "ar" ? "اتوقف." : "Stopped.") : "");
        const assistantId = await args.saveMessage(conversationId, "assistant", text, undefined, metadata);
        if (assistantId) args.ownInsertedIdsRef.current.add(assistantId);
        update({ id: assistantId });
        window.dispatchEvent(new CustomEvent("megsy:conversations-changed"));
      } catch (error) {
        console.error("Could not save agent conversation", error);
      }
    }
  }
}
