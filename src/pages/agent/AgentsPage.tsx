/** Agent directory — unified with the Profile/Settings glass navigation language. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Bot, Check, Lock, Plus, RotateCw, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { agentApi, type AgentInfo } from "@/lib/agentsky/client";
import { useWorkspaceStore, workspace, loadWorkspace } from "@/lib/agentsky/store";
import { getAgentById } from "@/lib/agentRegistry";
import { SubCard, SubSection, SubShell } from "@/components/settings/SubShell";
import SEOHead from "@/components/common/SEOHead";
import { canUseAgent } from "@/lib/octoberOffer";

const fallbackVisual = { Icon: Bot, color: "text-foreground", bg: "bg-foreground/[0.08]" };

function visualFor(agent: AgentInfo): { Icon: LucideIcon; color: string; bg: string } {
  const registered = getAgentById(agent.id);
  if (registered) return { Icon: registered.icon, color: registered.color, bg: registered.bg };
  if (agent.mediaOnly) return { Icon: Bot, color: "text-rose-400", bg: "bg-rose-500/15" };
  return fallbackVisual;
}

function AgentRow({
  agent,
  active,
  locked,
  deleting,
  onOpen,
  onDelete,
}: {
  agent: AgentInfo;
  active: boolean;
  locked: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { Icon, color, bg } = visualFor(agent);
  const canDelete = !agent.isDefault && !agent.isTemplate;

  return (
    <div className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-foreground/[0.035]">
      <div
        className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-[14px] ${bg} border border-foreground/[0.08] backdrop-blur-sm`}
      >
        <Icon className={`h-[21px] w-[21px] ${color}`} strokeWidth={1.75} aria-hidden="true" />
        {active && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-background bg-emerald-500 text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-start">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14.5px] font-semibold text-foreground">{agent.name}</span>
          {agent.isDefault && (
            <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Main
            </span>
          )}
          {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Pro" />}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-relaxed text-muted-foreground">
          {agent.mediaOnly
            ? "Image and video creation"
            : agent.description ||
              (agent.isDefault ? "Your everyday partner" : "Personal AI agent")}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        {canDelete && (
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
            aria-label={`Delete ${agent.name}`}
            title={`Delete ${agent.name}`}
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground/[0.12] bg-foreground/[0.04] px-3 text-[12px] font-semibold text-foreground transition hover:bg-foreground/[0.09]"
        >
          {locked ? "Pro" : "Open"}
          {!locked && <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const nav = useNavigate();
  const { agents, ready, error, sessions, tier } = useWorkspaceStore();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [now] = useState(Date.now());
  const setup = () => nav("/chat", { state: { agentCreation: true } });
  const personal = agents.filter((a) => !a.isTemplate);
  const catalogue = agents.filter((a) => a.isTemplate && !a.mediaOnly);
  const media = agents.filter((a) => a.mediaOnly);

  const remove = async (agent: AgentInfo) => {
    if (!confirm(`Delete ${agent.name}? Your conversations will not be deleted.`)) return;
    setDeleting(agent.id);
    setDeleteError(null);
    try {
      await agentApi.deleteAgent(agent.id);
      workspace.removeAgent(agent.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete agent");
    } finally {
      setDeleting(null);
    }
  };

  const group = (title: string, list: AgentInfo[]) =>
    list.length ? (
      <SubSection key={title} title={title}>
        <SubCard
          flush
          className="divide-y divide-foreground/[0.07] border border-foreground/[0.08] bg-card/65 shadow-[0_18px_50px_-35px_hsl(var(--foreground)/0.45)] backdrop-blur-xl"
        >
          {list.map((agent) => {
            const active = sessions.some((s) => s.agentId === agent.id && s.status === "running");
            const locked = !agent.isDefault && canUseAgent(tier, !!agent.mediaOnly, now) === false;
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                active={active}
                locked={locked}
                deleting={deleting === agent.id}
                onOpen={() =>
                  nav(locked ? "/pricing" : `/chat?agent=${encodeURIComponent(agent.id)}`)
                }
                onDelete={() => void remove(agent)}
              />
            );
          })}
        </SubCard>
      </SubSection>
    ) : null;

  return (
    <div data-no-translate dir="ltr">
      <SEOHead
        locale="en"
        path="/agents"
        title="Your agents"
        description="Your personal Megsy AI agents, specialist agents and conversations."
      />
      <SubShell
        title="Agents"
        subtitle="Your specialists, tools and personal AI companions — all in one calm workspace."
        backTo="/settings"
        action={
          <button
            type="button"
            onClick={setup}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12px] font-semibold text-background transition hover:opacity-85"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add agent
          </button>
        }
      >
        <div className="space-y-7">
          <div className="rounded-[18px] border border-foreground/[0.08] bg-foreground/[0.035] px-4 py-3.5 text-[12.5px] leading-relaxed text-muted-foreground backdrop-blur-xl">
            Choose an agent to open a focused chat. Your conversations stay separate, while every
            agent uses the same workspace and account.
          </div>
          {(error || deleteError) && (
            <div
              className="flex items-center gap-3 rounded-[14px] border border-destructive/20 bg-destructive/[0.06] px-4 py-3"
              role="alert"
            >
              <p className="flex-1 text-[12.5px] text-destructive">{error || deleteError}</p>
              <button
                type="button"
                aria-label="Retry loading agents"
                onClick={() => void loadWorkspace(true)}
                className="grid h-8 w-8 place-items-center rounded-full text-destructive hover:bg-destructive/10"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          )}
          {!ready && (
            <div
              className="flex items-center gap-3 py-16 text-[13px] text-muted-foreground"
              role="status"
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />{" "}
              Loading agents…
            </div>
          )}
          {group("Yours", personal)}
          {group("Specialists", catalogue)}
          {group("Images & video", media)}
          {ready && !agents.length && !error && (
            <div className="rounded-[18px] border border-dashed border-foreground/15 px-5 py-14 text-center">
              <Bot className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-muted-foreground">
                Your next agent starts with a conversation.
              </p>
              <button
                type="button"
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-[12px] font-semibold text-background"
                onClick={setup}
              >
                <Plus className="h-4 w-4" /> Add agent
              </button>
            </div>
          )}
        </div>
      </SubShell>
    </div>
  );
}

export function AgentNewPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/chat", { replace: true, state: { agentCreation: true } });
  }, [navigate]);
  return null;
}
