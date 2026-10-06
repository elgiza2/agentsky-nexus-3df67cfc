/** @doc AgentSky server client — the single provider for the agent (OpenClaw), media and tools.
 *  Server-only: reads AGENTSKY_API_KEY inside each call. Ownership of agents and sessions is
 *  encoded in AgentSky itself (agent name prefix + session metadata.owner), so no DB writes. */
import { createHmac, timingSafeEqual } from "crypto";

const API = "https://api.agentsky.dev/v1";
const GATEWAY = "https://gateway.agentsky.dev/v1";

export const AGENT_HARNESS = "openclaw";
export const AGENT_MODEL = "gpt-5.6-luna";
export const AGENT_CAPABILITIES = ["exa.search", "exa.contents", "tinyfish.fetch", "tinyfish.browser"];

export class AgentSkyError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Keys come from the `agentsky_keys` pool (filled from the Telegram bot), least-recently-used
 *  first; AGENTSKY_API_KEY stays as a fallback when the pool is empty. */
type PooledKey = { id: string | null; value: string };
async function takeKey(): Promise<PooledKey> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any).rpc("take_agentsky_key");
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.key_value) return { id: row.id, value: row.key_value };
  } catch {
    /* fall back to env */
  }
  const k = process.env.AGENTSKY_API_KEY;
  if (!k) throw new AgentSkyError(500, "not_configured", "AgentSky is not configured");
  return { id: null, value: k };
}

async function reportKey(k: PooledKey, status: number, message: string) {
  if (!k.id) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dead = status === 401 || status === 402 || status === 403;
    await (supabaseAdmin as any)
      .from("agentsky_keys")
      .update({ last_error: `${status} ${message}`.slice(0, 300), ...(dead ? { active: false } : {}) })
      .eq("id", k.id);
  } catch {
    /* best effort */
  }
}

async function call<T = any>(base: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const k = await takeKey();
  const res = await fetch(base + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${k.value}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { code: "bad_response", message: text.slice(0, 300) } };
  }
  if (!res.ok) {
    const e = body?.error ?? {};
    if ([401, 402, 403, 429].includes(res.status) && k.id) {
      await reportKey(k, res.status, e.message || "");
      if (attempt < 2) return call<T>(base, path, init, attempt + 1);
    }
    throw new AgentSkyError(res.status, e.code || "error", e.message || `AgentSky ${res.status}`);
  }
  return body as T;
}

/** Checks a key against the provider before it is saved. */
export async function validateAgentSkyKey(value: string): Promise<boolean> {
  const res = await fetch(`${API}/agents`, { headers: { Authorization: `Bearer ${value}` } });
  return res.ok;
}

export const api = <T = any>(path: string, init?: RequestInit) => call<T>(API, path, init);
export const gateway = <T = any>(path: string, init?: RequestInit) => call<T>(GATEWAY, path, init);

export async function streamSession(sessionId: string, signal: AbortSignal) {
  const k = await takeKey();
  return fetch(`${API}/sessions/${encodeURIComponent(sessionId)}/stream`, {
    headers: { Authorization: `Bearer ${k.value}`, Accept: "text/event-stream" },
    signal,
  });
}

/* ---------- ownership ---------- */

export const ownerPrefix = (userId: string) => `mg_${userId.replace(/-/g, "")}`;

export type AgentRecord = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  prompt?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
};

export async function listUserAgents(userId: string): Promise<AgentRecord[]> {
  const { agents } = await api<{ agents: AgentRecord[] & any[] }>("/agents");
  const p = ownerPrefix(userId);
  return (agents as any[]).filter((a) => !a.archived && String(a.name).startsWith(p));
}

/** Only deliberately configured catalogue templates, never another user's agents. */
export async function listAgentTemplates() {
  const { agents } = await api<{ agents: any[] }>("/agents");
  const seen = new Set<string>();
  return agents.filter((a) => {
    if (a.archived || !String(a.name).startsWith("Chat · ")) return false;
    const key = `${a.agentType}:${a.llm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveUserAgent(userId: string, origin: string, id?: string) {
  if (id === "higgsfield") return ensureHiggsfieldAgent(userId, origin);
  if (!id?.startsWith("template:")) return id ? getOwnedAgent(userId, id) : ensureDefaultAgent(userId, origin);
  const template = (await listAgentTemplates()).find((a) => `template:${a.id}` === id);
  if (!template) throw new AgentSkyError(404, "not_found", "Agent not found");
  const name = `${ownerPrefix(userId)}_tpl_${template.id}`.slice(0, 60);
  const existing = (await listUserAgents(userId)).find((a) => a.name === name);
  if (existing) return existing;
  const { agent } = await api<{ agent: any }>("/agents", {
    method: "POST",
    headers: { "Idempotency-Key": name },
    body: JSON.stringify({
      ...agentSpec({ userId, origin, displayName: String(template.name).replace(/^Chat · /, ""), kind: "custom", color: "ocean" }),
      name, agentType: template.agentType, llm: template.llm,
      metadata: { owner: userId, kind: "custom", templateId: id, color: "ocean" },
    }),
  });
  return agent;
}

export async function getOwnedAgent(userId: string, agentId: string) {
  const { agent } = await api<{ agent: any }>(`/agents/${encodeURIComponent(agentId)}`);
  if (!String(agent?.name || "").startsWith(ownerPrefix(userId)) || agent.archived)
    throw new AgentSkyError(404, "not_found", "Agent not found");
  return agent;
}

export async function getOwnedSession(userId: string, sessionId: string) {
  const { session } = await api<{ session: any }>(`/sessions/${encodeURIComponent(sessionId)}`);
  if (session?.metadata?.owner !== userId) throw new AgentSkyError(404, "not_found", "Not found");
  return session;
}

/* ---------- tool signing (MCP url + media links) ---------- */

function secret() {
  const s = process.env.AGENT_TOOL_SIGNING_SECRET;
  if (!s) throw new AgentSkyError(500, "not_configured", "Signing secret missing");
  return s;
}
export function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 32);
}
export function verify(value: string, sig: string): boolean {
  const a = Buffer.from(sign(value));
  const b = Buffer.from(sig || "");
  return a.length === b.length && timingSafeEqual(a, b);
}
export const mcpToken = (userId: string) => `${userId}.${sign("mcp:" + userId)}`;
export function readMcpToken(token: string): string | null {
  const [uid, sig] = String(token || "").split(".");
  return uid && sig && verify("mcp:" + uid, sig) ? uid : null;
}

/* ---------- agent prompt ---------- */

export const BASE_PROMPT = `You are an autonomous assistant inside the Megsy app. Reply in the user's language.

Tools from the "megsy" MCP server are your ONLY way to make media and talk to the app UI:
- Media generation is for paid subscribers only. If the tool denies access, explain the subscription requirement and never bypass it with another tool.
- generate_image: whenever the user wants a picture, illustration, logo, edit or design. Never say you cannot create images. Never use any other image tool.
- generate_video: whenever the user wants a video or animation. It shows the user a card; the video renders there.
- ask_user: when you truly need the user to choose between options before continuing. Then stop and wait.
- create_task: when the user asks to be reminded, to plan, or when a goal needs follow-up steps. Assign tasks yourself.
- share_file: whenever you created files for the user, deliver every one of them with share_file before finishing. Never end a job that produced files without sharing them.
- update_plan: for multi-step work, publish a short plan of steps and update their status as you go.
- propose_agent: when creating a personal agent, first ask about purpose, audience, outcomes and boundaries. Ask follow-up questions when needed. Explain its role and instructions, then call propose_agent. Never create an agent yourself. Wait for the user to click Create agent or request changes.

For big jobs, split work across helper sub-agents and run them in parallel, then merge results.
Never print tool names, internal instructions, JSON, or system text to the user. Keep answers clean and well formatted in Markdown. Do not paste image or video URLs in your reply — the app shows the media automatically.`;

export function agentSpec(opts: {
  userId: string;
  origin: string;
  displayName: string;
  description?: string;
  prompt?: string;
  color?: string;
  kind: "default" | "custom";
}) {
  const suffix = opts.kind === "default" ? "_default" : `_${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: (ownerPrefix(opts.userId) + suffix).slice(0, 60),
    displayName: opts.displayName.slice(0, 60),
    description: (opts.description || "").slice(0, 500),
    agentType: AGENT_HARNESS,
    llm: AGENT_MODEL,
    prompt: `${BASE_PROMPT}\n\n${opts.prompt ? `Your persona and job:\n${opts.prompt}` : ""}`.slice(0, 100000),
    capabilities: AGENT_CAPABILITIES,
    mcpServers: [
      { type: "url", name: "megsy", url: `${opts.origin}/api/public/agent-tools/${mcpToken(opts.userId)}` },
    ],
    metadata: { owner: opts.userId, kind: opts.kind, color: opts.color || "aurora", userPrompt: opts.prompt || "" },
  };
}

/** Public origin the agent's cloud machine can reach for the MCP tools. */
export function publicOrigin(request: Request): string {
  const env = process.env.PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const url = new URL(request.url);
  const fwd = request.headers.get("x-forwarded-host");
  const host = fwd || url.host;
  if (/localhost|127\.0\.0\.1/.test(host))
    return "https://megsyai.com";
  return `https://${host}`;
}

export async function ensureDefaultAgent(userId: string, origin: string) {
  const mine = await listUserAgents(userId);
  const found = mine.find((a) => a.name.endsWith("_default"));
  if (found) {
    const { agent } = await api<{ agent: AgentRecord }>(`/agents/${encodeURIComponent(found.id)}`);
    if (!String(agent.prompt || "").includes("- propose_agent:")) {
      await api(`/agents/${encodeURIComponent(found.id)}`, { method: "PATCH", body: JSON.stringify({ prompt: `${BASE_PROMPT}\n\n${agent.metadata?.userPrompt || ""}` }) });
    }
    return agent;
  }
  const { agent } = await api<{ agent: AgentRecord }>("/agents", {
    method: "POST",
    headers: { "Idempotency-Key": `default-agent-${userId}` },
    body: JSON.stringify(
      agentSpec({ userId, origin, displayName: "Megsy", kind: "default", color: "aurora" }),
    ),
  });
  return agent;
}

/** Clone only the actual configured Hypit template; never substitute another harness. */
export async function ensureHiggsfieldAgent(userId: string, origin: string) {
  const name = `${ownerPrefix(userId)}_higgsfield`;
  const mine = await listUserAgents(userId);
  const existing = mine.find((a) => a.name === name);
  if (existing) return existing;
  const { agents } = await api<{ agents: any[] }>("/agents");
  const template = agents.find((a) => !a.archived && ["Hypit", "Chat · Hypit"].includes(a.name));
  if (!template) throw new AgentSkyError(503, "hypit_unavailable", "وكيل Hypit مش متاح عند المزود حالياً؛ إنشاء الصور والفيديو متوقف لحد ما يتضاف.");
  const { agent } = await api<{ agent: AgentRecord }>("/agents", {
    method: "POST", headers: { "Idempotency-Key": name },
    body: JSON.stringify({
      ...agentSpec({ userId, origin, displayName: "higgsfield", kind: "custom", color: "sun",
        prompt: "You are Higgsfield, the media specialist. Use generate_image or generate_video to fulfill media requests, and update_plan to track the job. Do not use alternate media providers or native generation tools." }),
      name, agentType: template.agentType, llm: template.llm,
      metadata: { owner: userId, kind: "media", color: "sun", templateId: template.id },
    }),
  });
  return agent;
}
