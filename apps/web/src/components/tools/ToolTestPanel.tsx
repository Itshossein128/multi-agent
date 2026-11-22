"use client";
import { useState } from "react";
import { Play } from "lucide-react";
import type { ToolRecord } from "@multi-agent/types";
import { toolService } from "@/services/toolService";
import { Button } from "@/components/ui/button";
import { Field, fieldClass, Section } from "@/components/agents/AgentFields";

export function ToolTestPanel({ tool, dirty }: { tool: ToolRecord; dirty: boolean }) {
  const [input, setInput] = useState('{ "example": "value" }');
  const [output, setOutput] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Section
      title="Test tool"
      description='Runs the saved tool with sample input through the execution server. Only the "function" category is implemented; other categories report an explicit not-implemented error.'
    >
      {dirty && (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Save or discard changes before testing.
        </p>
      )}
      <Field label="Sample input (JSON object)">
        <textarea
          rows={5}
          className={`${fieldClass} font-mono`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </Field>
      <div>
        <Button
          disabled={busy || dirty || tool.enabled === false}
          className="gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
          onClick={async () => {
            setBusy(true);
            setError("");
            setOutput(null);
            try {
              const sample: unknown = JSON.parse(input);
              if (!sample || typeof sample !== "object" || Array.isArray(sample))
                throw new Error("Sample input must be a JSON object.");
              const result = await toolService.testTool(tool, sample as Record<string, unknown>);
              setOutput(result.output);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? "Testing…" : "Test tool"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {output && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Execution output</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-200">
            {JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}
    </Section>
  );
}
