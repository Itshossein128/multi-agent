import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { redact } from "../../adapters/langGraphEventAdapter";
import { boundJsonValue, boundedBytesFromEnvironment } from "../../../../../src/runtime/boundedValue";
import type { RunEntry, RunListFilters } from "./contracts";

export function redactApproval(approval: ApprovalRequest): ApprovalRequest {
  return {
    ...approval,
    message: redact(approval.message) as string,
    context: redact(approval.context) as Record<string, unknown> | undefined,
    response: approval.response !== undefined ? (redact(approval.response) as string) : undefined,
  };
}

export function matchesFilters(entry: RunEntry, filters?: RunListFilters): boolean {
  if (!filters) return true;
  if (filters.agentId && !entry.events.some((event) => event.agentId === filters.agentId)) return false;
  if (filters.workflowId && entry.run.workflowId !== filters.workflowId) return false;
  if (filters.taskId && entry.run.taskId !== filters.taskId) return false;
  if (filters.status && entry.run.status !== filters.status) return false;
  if (filters.from && entry.run.startedAt < filters.from) return false;
  if (filters.to && entry.run.startedAt > filters.to) return false;
  return true;
}

export function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function boundedEventCount(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 1_000_000 ? parsed : fallback;
}

export function createBoundedRun(run: import("@multi-agent/types").Run, maxEventPayloadBytes: number, maxRunPayloadBytes: number): import("@multi-agent/types").Run {
  const input = boundJsonValue(redact(run.input), maxRunPayloadBytes);
  const output = boundJsonValue(redact(run.output), maxRunPayloadBytes);
  const metadata = boundJsonValue(redact(run.metadata), maxRunPayloadBytes);
  const asRecord = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  return {
    ...run,
    ...(run.input !== undefined ? { input: asRecord(input) ?? { value: input } } : {}),
    ...(run.output !== undefined ? { output: asRecord(output) ?? { value: output } } : {}),
    metadata: asRecord(metadata) ?? {},
    ...(run.error !== undefined ? { error: String(redact(run.error)).slice(0, 12_000) } : {}),
  };
}
