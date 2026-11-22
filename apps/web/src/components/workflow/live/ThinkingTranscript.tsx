"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { ThinkingAttemptView, ThinkingOutcome } from "./liveCanvas.types";
import { THINKING_COPY, shouldFollowThinkingTail } from "@/lib/thinkingPresentation";
import { ReadableContent } from "@/components/runs/ReadableContent";

const OUTCOME_LABEL: Record<ThinkingOutcome, string> = {
  in_progress: "In progress",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
};

export function ThinkingTranscript({ attempts }: { attempts: ThinkingAttemptView[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const signature = attempts.map((attempt) => `${attempt.attempt}:${attempt.text}:${attempt.outcome}:${attempt.availability}`).join("|");
  useEffect(() => {
    const element = scroller.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [signature]);
  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    follow.current = shouldFollowThinkingTail(element.scrollHeight - element.scrollTop - element.clientHeight);
  };
  return <div ref={scroller} onScroll={onScroll} className="max-h-64 space-y-3 overflow-y-auto" aria-label="Thinking transcript">
    {attempts.map((attempt) => <article key={attempt.attempt} aria-label={`Attempt ${attempt.attempt}`}>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">Attempt {attempt.attempt} · {OUTCOME_LABEL[attempt.outcome]}</p>
      {attempt.availability === "shared" ? attempt.segments.map((segment, index) => segment.kind === "thinking"
        ? <ReadableContent key={index} text={segment.text} variant="inline" />
        : <p key={index} className="mt-1 inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-300">Used {segment.label} · {segment.status}</p>) : (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
          {attempt.outcome === "in_progress" && attempt.availability === "pending" && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-indigo-400" />}
          <span>{THINKING_COPY[attempt.availability]}</span>
        </p>
      )}
      {attempt.recordIncomplete && <p className="mt-1 text-xs text-amber-200">{THINKING_COPY.incomplete}</p>}
    </article>)}
  </div>;
}
