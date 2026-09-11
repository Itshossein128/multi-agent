"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentRecord } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";
import { Field, fieldClass, Section } from "./AgentFields";

export function AgentTestPanel({ agent, dirty }: { agent: AgentRecord; dirty: boolean }) {
  const [input, setInput] = useState('{ "input": "Say hello in one sentence." }');
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const result = useQuery({
    queryKey: ["agent-test", runId], enabled: Boolean(runId), retry: false,
    queryFn: async () => {
      const [run, events] = await Promise.all([runService.getRun(runId!), runService.getRunEvents(runId!)]);
      return { run, events };
    },
    refetchInterval: (query) => query.state.error || (query.state.data && ["completed", "failed", "cancelled"].includes(query.state.data.run.status)) ? false : 1000,
  });
  const active = starting || Boolean(runId && !result.isError && (!result.data || !["completed", "failed", "cancelled"].includes(result.data.run.status)));
  return <Section title="Test agent">
    <p className="text-sm text-zinc-400">Runs the saved API, CLI, or local-model agent through the execution server and records real run events. Provider credentials, CLI allowlists, and local-model origins are configured on the server.</p>
    {dirty && <p className="text-sm text-amber-200">Save or discard changes before testing.</p>}
    <Field label="Sample input (JSON object)"><textarea rows={5} className={fieldClass} value={input} onChange={(event) => setInput(event.target.value)} /></Field>
    <div className="flex gap-2"><Button disabled={active || dirty || agent.enabled === false} onClick={async () => {
      setStarting(true); setError("");
      try {
        const sample: unknown = JSON.parse(input);
        if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new Error("Sample input must be a JSON object.");
        setRunId((await runService.testAgent(agent, sample as Record<string, unknown>)).runId);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setStarting(false); }
    }}>{active ? "Testing…" : "Test agent"}</Button>
    {active && runId && <Button variant="outline" onClick={async () => { try { await runService.cancelRun(runId); } catch (cause) { setError(String(cause)); } }}>Cancel test</Button>}
    {result.isError && <Button variant="outline" onClick={() => void result.refetch()}>Retry loading result</Button>}</div>
    {(error || result.error) && <p role="alert" className="text-sm text-red-300">{error || result.error?.message}</p>}
    {result.data && <><p role="status">Run: {result.data.run.status}</p>
      {result.data.run.error && <p role="alert" className="text-red-300">{result.data.run.error}</p>}
      {result.data.run.output && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{JSON.stringify(result.data.run.output, null, 2)}</pre>}
      <ExecutionTimeline events={result.data.events} />
    </>}
  </Section>;
}
