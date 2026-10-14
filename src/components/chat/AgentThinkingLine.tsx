/** Live "thinking" line for the agent: Megsy star + the agent's real current thought. */
import MegsyStar from "@/components/branding/MegsyStar";
import { useUserLang } from "@/lib/authI18n";

export default function AgentThinkingLine({ text }: { text?: string | null }) {
  const isAr = useUserLang() === "ar-eg";
  const line = (text || "").trim() || (isAr ? "بيفكر…" : "Thinking…");
  return (
    <div className="my-2 flex items-start gap-2 text-[13.5px] leading-relaxed text-muted-foreground" role="status" aria-live="polite">
      <MegsyStar
        className="megsy-thinking-mark mt-[3px] h-4 w-4 shrink-0 text-[var(--megsy-blue)]"
        aria-hidden
      />
      <span key={line} className="ai-shimmer inline-block max-w-full whitespace-pre-wrap break-words motion-reduce:animate-none">{line}</span>
    </div>
  );
}
