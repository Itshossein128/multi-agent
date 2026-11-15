"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import type { AgentRecord } from "@multi-agent/types";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";
import { Field, fieldClass, Section } from "./AgentFields";

const SAMPLE_PRESETS = [
  { label: "Hello prompt", value: '{\n  "input": "Say hello in one sentence."\n}' },
  { label: "Health check", value: '{\n  "input": "Summarize your role and constraints concisely."\n}' },
  { label: "Structured JSON", value: '{\n  "input": "Analyze workspace readiness",\n  "strict": true\n}' },
] as const;

export function AgentTestPanel({ agent, dirty }: { agent: AgentRecord; dirty: boolean }) {
  const orgId = useOptionalOrg()?.org.id ?? "none";
  const [input, setInput] = useState('{ "input": "Say hello in one sentence." }');
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const result = useQuery({
    queryKey: ["org", orgId, "agent-test", runId],
    enabled: Boolean(runId),
    retry: false,
    queryFn: async () => {
      const [run, events] = await Promise.all([
        runService.getRun(runId!),
        runService.getRunEvents(runId!),
      ]);
      return { run, events };
    },
    refetchInterval: (query) =>
      query.state.error ||
      (query.state.data &&
        ["completed", "failed", "cancelled"].includes(query.state.data.run.status))
        ? false
        : 1000,
  });

  const active =
    starting ||
    Boolean(
      runId &&
        !result.isError &&
        (!result.data ||
          !["completed", "failed", "cancelled"].includes(result.data.run.status)),
    );

  function formatInput() {
    try {
      const parsed = JSON.parse(input);
      setInput(JSON.stringify(parsed, null, 2));
      setError("");
    } catch {
      setError("Sample input must be a valid JSON object.");
    }
  }

  return (
    <Section
      title="Test agent"
      description="Runs the saved API, CLI, or local-model agent through the execution server and records real run events. Provider credentials, CLI allowlists, and local-model origins are configured on the server."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={formatInput}
          className="h-7 gap-1.5 text-xs"
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Format JSON
        </Button>
      }
    >
      {dirty ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 [html[data-appearance='light']_&]:text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Save or discard changes before testing.</span>
        </div>
      ) : null}

      {agent.enabled === false ? (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3.5 py-2.5 text-xs text-zinc-300">
          <span>This agent is disabled. Enable it in Configuration before running tests.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-zinc-500">Presets:</span>
        {SAMPLE_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setInput(preset.value);
              setError("");
            }}
            className="h-7 px-2.5 text-xs text-zinc-300"
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <Field label="Sample input (JSON object)">
        <textarea
          rows={5}
          className={`${fieldClass} font-mono`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={active || dirty || agent.enabled === false}
          onClick={async () => {
            setStarting(true);
            setError("");
            try {
              const sample: unknown = JSON.parse(input);
              if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
                throw new Error("Sample input must be a JSON object.");
              }
              setRunId((await runService.testAgent(agent, sample as Record<string, unknown>)).runId);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setStarting(false);
            }
          }}
          className="gap-1.5"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {active ? "Testing…" : "Test agent"}
        </Button>

        {active && runId ? (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await runService.cancelRun(runId);
              } catch (cause) {
                setError(String(cause));
              }
            }}
            className="gap-1.5"
          >
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Cancel test
          </Button>
        ) : null}

        {result.isError ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void result.refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry loading result
          </Button>
        ) : null}
      </div>

      {error || result.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
        >
          {error || result.error?.message}
        </p>
      ) : null}

      {result.data ? (
        <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              role="status"
              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-200"
            >
              Run: {result.data.run.status}
            </p>
            <span className="font-mono text-xs text-zinc-500">{result.data.run.id}</span>
          </div>

          {result.data.run.error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
            >
              {result.data.run.error}
            </p>
          ) : null}

          {result.data.run.output ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200">
              {JSON.stringify(result.data.run.output, null, 2)}
            </pre>
          ) : null}

          <ExecutionTimeline events={result.data.events} />
        </div>
      ) : null}
    </Section>
  );
}
