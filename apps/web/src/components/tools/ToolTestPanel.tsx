"use client";
import { useState } from "react";
import type { ToolRecord } from "@multi-agent/types";
import { toolService } from "@/services/toolService";
import { Button } from "@/components/ui/button";
import { Field, fieldClass, Section } from "@/components/agents/AgentFields";

export function ToolTestPanel({ tool, dirty }: { tool: ToolRecord; dirty: boolean }) {
  const [input, setInput] = useState('{ "example": "value" }');
  const [output, setOutput] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Section title="Test tool">
    <p className="text-sm text-zinc-400">Runs the saved tool with sample input through the execution server. Only the &quot;function&quot; category is implemented; other categories report an explicit not-implemented error.</p>
    {dirty && <p className="text-sm text-amber-200">Save or discard changes before testing.</p>}
    <Field label="Sample input (JSON object)"><textarea rows={5} className={fieldClass} value={input} onChange={(event) => setInput(event.target.value)} /></Field>
    <Button disabled={busy || dirty || tool.enabled === false} onClick={async () => {
      setBusy(true); setError(""); setOutput(null);
      try {
        const sample: unknown = JSON.parse(input);
        if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new Error("Sample input must be a JSON object.");
        const result = await toolService.testTool(tool, sample as Record<string, unknown>);
        setOutput(result.output);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }}>{busy ? "Testing…" : "Test tool"}</Button>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {output && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{JSON.stringify(output, null, 2)}</pre>}
  </Section>;
}
