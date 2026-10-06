/** English agent directory; setup happens in the original main-agent conversation. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, ArrowUpRight, Lock, RotateCw } from "lucide-react";
import { agentApi, type AgentInfo } from "@/lib/agentsky/client";
import { useWorkspaceStore, workspace, loadWorkspace } from "@/lib/agentsky/store";
import { AgentShell } from "@/components/agent/AgentShell";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { Button } from "@/components/ui/button";
import SEOHead from "@/components/common/SEOHead";
import { canUseAgent } from "@/lib/octoberOffer";

export function AgentsPage() {
  const nav = useNavigate();
  const { agents, ready, error, sessions, tier } = useWorkspaceStore();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [now] = useState(Date.now());
  const setup = () => nav("/chat", { state: { agentCreation: true } });
  const filtered = agents;
  const personal = filtered.filter(a => !a.isTemplate);
  const catalogue = filtered.filter(a => a.isTemplate && !a.mediaOnly);
  const media = filtered.filter(a => a.mediaOnly);
  const item = (a: AgentInfo) => {
    const active = sessions.filter(s => s.agentId === a.id && s.status === "running").length;
    const locked = !a.isDefault && !canUseAgent(tier, !!a.mediaOnly, now);
    return <li key={a.id} className="flex flex-wrap items-center gap-4 border-b border-border py-4 last:border-0 sm:flex-nowrap">
      <AgentOrb size={40} color={a.color} state={active ? "tool" : "idle"} />
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold break-words">{a.name}</h3>{a.isDefault && <span className="text-xs text-muted-foreground">Main</span>}</div><p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">{a.mediaOnly ? "Image and video creation" : a.description || (a.isDefault ? "Your everyday partner" : "Personal AI agent")}</p></div>
      <div className="ms-auto flex shrink-0 items-center gap-2">{!a.isDefault && !a.isTemplate && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.name}`} title={`Delete ${a.name}`} disabled={deleting === a.id} onClick={async () => { if (!confirm(`Delete ${a.name}? Your conversations will not be deleted.`)) return; setDeleting(a.id); setDeleteError(null); try { await agentApi.deleteAgent(a.id); workspace.removeAgent(a.id); } catch(e) { setDeleteError(e instanceof Error ? e.message : "Could not delete agent"); } finally { setDeleting(null); } }}><Trash2 size={16} /></Button>}<Button variant="neutral" size="sm" onClick={() => nav(locked ? "/pricing" : `/chat?agent=${encodeURIComponent(a.id)}`)}>{locked ? <><Lock size={14} />Pro</> : <>Open chat<ArrowUpRight size={14} /></>}</Button></div>
    </li>;
  };
  return <div data-no-translate dir="ltr" className="megsy-agents"><AgentShell lang="en" title="Agents" actions={<Button variant="neutral" size="sm" onClick={setup}><Plus size={16} />Add agent</Button>}>
    <SEOHead locale="en" path="/agents" title="Your agents" description="Your personal Megsy AI agents, specialist agents and conversations." />
    <div className="flex-1 overflow-y-auto px-5 py-8 md:px-12 md:py-10"><div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-6"><h1 className="text-2xl font-semibold">Agents</h1></div>
      {(error || deleteError) && <div className="mt-6 flex items-center gap-3" role="alert"><p className="text-sm text-destructive">{error || deleteError}</p><Button variant="ghost" size="icon-sm" aria-label="Retry loading agents" onClick={() => void loadWorkspace(true)}><RotateCw size={16} /></Button></div>}
      {!ready && <div className="flex items-center gap-3 py-16" role="status"><AgentOrb size={36} state="awakening" /><span className="text-sm text-muted-foreground">Loading…</span></div>}
      {[{ title: "Yours", list: personal }, { title: "Specialists", list: catalogue }, { title: "Images & video", list: media }].map(group => group.list.length ? <section key={group.title} className="mt-8"><h2 className="border-b border-border pb-2 text-xs font-semibold uppercase text-muted-foreground">{group.title}</h2><ul>{group.list.map(item)}</ul></section> : null)}
      {ready && !filtered.length && !error && <div className="py-16 text-center"><p className="text-sm text-muted-foreground">Your next agent starts with a conversation.</p><Button variant="neutral" className="mt-5" onClick={setup}><Plus size={16} />Add agent</Button></div>}
    </div></div>
  </AgentShell></div>;
}
export function AgentNewPage() {
  const navigate = useNavigate();
  useEffect(() => { navigate("/chat", { replace: true, state: { agentCreation: true } }); }, [navigate]);
  return null;
}
