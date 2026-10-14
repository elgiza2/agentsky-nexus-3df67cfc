/** Agent roster settings: choose the primary chat assistant and which specialists may auto-join. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Check, ChevronRight, Crown, Loader2, Plus, RotateCw, Users } from "lucide-react";
import { useWorkspaceStore, loadWorkspace } from "@/lib/agentsky/store";
import { AGENT_ROSTER_STORAGE_KEY } from "@/lib/agentsky/rosterSettings";
import { AgentIcon } from "@/components/agent/AgentIcon";
import { SubCard, SubSection, SubShell } from "@/components/settings/SubShell";
import SEOHead from "@/components/common/SEOHead";
import { canUseAgent } from "@/lib/octoberOffer";
import { promptUpgrade } from "@/lib/upgradeMoment";

type RosterSettings = { enabledIds: string[]; autoJoinIds: string[] };
const emptySettings: RosterSettings = { enabledIds: [], autoJoinIds: [] };

function readSettings(): RosterSettings {
  try {
    const value = JSON.parse(localStorage.getItem(AGENT_ROSTER_STORAGE_KEY) || "{}");
    return {
      enabledIds: Array.isArray(value.enabledIds) ? value.enabledIds.filter((x: unknown) => typeof x === "string") : [],
      autoJoinIds: Array.isArray(value.autoJoinIds) ? value.autoJoinIds.filter((x: unknown) => typeof x === "string") : [],
    };
  } catch {
    return emptySettings;
  }
}

function Toggle({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "bg-primary" : "bg-muted-foreground/25"}`}
    >
      <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1"}`} />
    </button>
  );
}

export default function AgentSelectionPage() {
  const { agents, ready, error, tier } = useWorkspaceStore();
  const [settings, setSettings] = useState<RosterSettings>(emptySettings);
  const [now] = useState(Date.now());

  useEffect(() => {
    setSettings(readSettings());
    if (!ready) void loadWorkspace();
  }, [ready]);

  const save = useCallback((next: RosterSettings) => {
    setSettings(next);
    try { localStorage.setItem(AGENT_ROSTER_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }, []);

  const available = useMemo(() => agents.filter((agent) => !agent.isDefault && !agent.mediaOnly), [agents]);
  const selectedCount = settings.autoJoinIds.filter((id) => settings.enabledIds.includes(id)).length;

  const toggleEnabled = (id: string) => {
    const agent = agents.find((item) => item.id === id);
    if (agent && !canUseAgent(tier, !!agent.mediaOnly, now)) {
      promptUpgrade("Enable specialist agents", "Activate specialist agents for your chats.");
      return;
    }
    const enabled = settings.enabledIds.includes(id);
    save({
      enabledIds: enabled ? settings.enabledIds.filter((item) => item !== id) : [...settings.enabledIds, id],
      autoJoinIds: enabled ? settings.autoJoinIds.filter((item) => item !== id) : settings.autoJoinIds,
    });
  };

  const toggleAutoJoin = (id: string) => {
    if (!settings.enabledIds.includes(id)) return;
    const active = settings.autoJoinIds.includes(id);
    save({
      ...settings,
      autoJoinIds: active ? settings.autoJoinIds.filter((item) => item !== id) : [...settings.autoJoinIds, id],
    });
  };

  const back = () => (window.history.length > 1 ? window.history.back() : window.location.assign("/chat"));

  return (
    <div data-no-translate>
      <SEOHead locale="en" path="/agents" title="Agent settings" description="Choose Megsy's primary chat and specialist agents." />
      <SubShell
        title="Agents"
        subtitle="Megsy Quick Chat leads every conversation. Specialists join only when enabled below."
        onBack={back}
        action={
          <Link to="/agents/new" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12px] font-semibold text-background transition hover:opacity-85" aria-label="Create agent" title="Create agent">
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add agent
          </Link>
        }
      >
        <div className="space-y-7">
          <SubSection title="Primary assistant">
            <SubCard className="border border-foreground/[0.08] bg-card/65 shadow-[0_18px_50px_-35px_hsl(var(--foreground)/0.45)] backdrop-blur-xl">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-primary/10 text-primary border border-foreground/[0.08]"><Bot size={23} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><strong className="text-[14.5px]">Megsy Quick Chat</strong><span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Primary</span></div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">Leads every normal conversation. Specialist agents stay off unless enabled below.</p>
                </div>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Check size={15} /></span>
              </div>
            </SubCard>
          </SubSection>

          <SubSection title={`Specialists${selectedCount ? ` · ${selectedCount} auto-join` : ""}`} description="Let Megsy bring a specialist in when its skills fit the task.">
            {!ready && (
              <SubCard>
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground" role="status"><Loader2 size={17} className="animate-spin" />Loading agents…</div>
              </SubCard>
            )}
            {error && (
              <SubCard>
                <div className="px-4 py-4">
                  <p role="alert" className="text-sm text-destructive">{error}</p>
                  <button type="button" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-foreground/[0.12] bg-foreground/[0.04] px-3 py-1.5 text-[12px] font-semibold" onClick={() => void loadWorkspace(true)}><RotateCw size={16} />Try again</button>
                </div>
              </SubCard>
            )}
            {ready && !available.length && !error && (
              <SubCard>
                <p className="px-4 py-4 text-sm text-muted-foreground">No specialist agents are available yet.</p>
              </SubCard>
            )}
            {available.length > 0 && (
              <SubCard
                flush
                className="divide-y divide-foreground/[0.07] border border-foreground/[0.08] bg-card/65 shadow-[0_18px_50px_-35px_hsl(var(--foreground)/0.45)] backdrop-blur-xl"
              >
                {available.map((agent) => {
                  const enabled = settings.enabledIds.includes(agent.id);
                  const autoJoin = settings.autoJoinIds.includes(agent.id);
                  const locked = !canUseAgent(tier, !!agent.mediaOnly, now);
                  return (
                    <div key={agent.id} className="px-4 py-3.5 transition-colors hover:bg-foreground/[0.035]">
                      <div className="flex items-center gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-muted/60 border border-foreground/[0.08]"><AgentIcon agent={agent} /></span>
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate text-[14.5px]">{agent.name}</strong>
                          <span className="mt-0.5 block line-clamp-2 text-[12px] text-muted-foreground">{agent.description || "Specialist agent"}</span>
                        </div>
                        {locked && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground"><Crown size={12} />Pro</span>}
                        <Toggle checked={enabled} label={`Enable ${agent.name}`} onClick={() => toggleEnabled(agent.id)} />
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-foreground/[0.07] pt-3 ps-14">
                        <div className="min-w-0">
                          <strong className="text-[13px]">Auto-join relevant chats</strong>
                          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Let Megsy bring this specialist in when its skills fit.</p>
                        </div>
                        <Toggle checked={autoJoin} label={`Auto-join ${agent.name}`} disabled={!enabled || locked} onClick={() => toggleAutoJoin(agent.id)} />
                      </div>
                    </div>
                  );
                })}
              </SubCard>
            )}
          </SubSection>

          <SubSection title="Always-on teams">
            <SubCard className="border border-foreground/[0.08] bg-card/65 shadow-[0_18px_50px_-35px_hsl(var(--foreground)/0.45)] backdrop-blur-xl">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-primary/10 text-primary border border-foreground/[0.08]"><Users size={20} /></span>
                <div className="min-w-0 flex-1"><strong className="text-[14px]">Team Workspace</strong><p className="mt-0.5 text-[12px] text-muted-foreground">A separate paid workspace for long-running teams and 24/7 tasks.</p></div>
                <Link to="/team" className="inline-flex h-9 items-center gap-1 rounded-full border border-foreground/[0.12] bg-foreground/[0.04] px-3 text-[12px] font-semibold transition hover:bg-foreground/[0.09]">Open <ChevronRight size={15} /></Link>
              </div>
            </SubCard>
          </SubSection>
        </div>
      </SubShell>
    </div>
  );
}
