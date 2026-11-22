import type { RunEvent, WorkflowDefinition } from "@multi-agent/types";

export interface ExplainedError {
  title: string;
  explanation: string;
  code?: string;
  hint?: string;
}

export interface AgentBlockerContext {
  nodeId?: string;
  agentId?: string;
  sequence: number;
  status?: string;
  workPackage?: string;
  blockers: string[];
  summary?: string;
  formattedMarkdown: string;
}

const KNOWN_ERROR_MAP: Record<string, { title: string; hint: string }> = {
  WORK_PACKAGE_COMPLETION_UNVERIFIED: {
    title: "Work package did not finish cleanly",
    hint: "Review the blocker reported by the previous agent step below, resolve it, then click Retry to resume directly from that step.",
  },
  AGENT_BLOCKED: {
    title: "Agent reported a blocker",
    hint: "Resolve the missing prerequisite or decision described below, then retry.",
  },
  NODE_BLOCKED: {
    title: "Step blocked before completion",
    hint: "Check the step details below to see what blocked execution before retrying.",
  },
  AGENT_EXECUTION_FAILED: {
    title: "Agent execution failed",
    hint: "Inspect the error message below. You can update the agent's model or settings and click Retry to continue from the last checkpoint.",
  },
  RUN_CANCELLED: {
    title: "Run was cancelled",
    hint: "Click Retry to resume from the last saved checkpoint, or Restart to run from the beginning.",
  },
  DYNAMIC_FANOUT_ITEMS_INVALID: {
    title: "Parallel fan-out received invalid items",
    hint: "The previous step must return a JSON array for the fan-out field.",
  },
  WORKFLOW_STEP_LIMIT: {
    title: "Workflow reached its maximum step limit",
    hint: "A loop repeated too many times or the step budget was exceeded.",
  },
  ORGANIZATION_ACCESS_REVOKED: {
    title: "Organization access revoked",
    hint: "Confirm your organization membership is still active before retrying.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeEscapedNewlines(value: string): string {
  return value.includes("\\n") && !value.includes("\n")
    ? value.replaceAll("\\n", "\n").replaceAll("\\t", "\t")
    : value;
}

export function humanizeKey(key: string): string {
  const special: Record<string, string> = {
    workPackage: "Work Package",
    stage5QA: "Stage 5 QA",
    semanticIndex: "Semantic Index",
    qaStatus: "QA Status",
    resultStatus: "Result Status",
    featureArtifacts: "Feature Artifacts",
    verificationEvidence: "Verification Evidence",
    remainingTasks: "Remaining Tasks",
    required_input: "Required Input",
    requiredInput: "Required Input",
    blocked_stage: "Blocked Stage",
    resume_when: "Resume When",
    retriedFromRunId: "Retried From Run",
    resumedFromCheckpointId: "Resumed Checkpoint",
    resumedAtNodes: "Resumed At Step",
    routeReason: "Routing Reason",
    maxIterations: "Max Iterations",
    totalItems: "Total Items",
    durationMs: "Duration (ms)",
  };
  if (special[key]) return special[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function humanizeEventLabel(type: string): string {
  const labels: Record<string, string> = {
    "run.created": "Run Created",
    "run.started": "Run Started",
    "run.resumed": "Resumed from Checkpoint",
    "run.paused": "Paused for Human Input",
    "run.completed": "Run Completed",
    "run.failed": "Run Failed",
    "run.cancelled": "Run Cancelled",
    "node.started": "Step Started",
    "node.completed": "Step Completed",
    "node.failed": "Step Failed",
    "node.retrying": "Step Retrying",
    "node.loop_iteration": "Loop Iteration",
    "node.loop_limit_reached": "Loop Limit Reached",
    "agent.started": "Agent Running",
    "agent.completed": "Agent Report",
    "agent.failed": "Agent Failed",
    "tool.started": "Tool Started",
    "tool.completed": "Tool Completed",
    "tool.failed": "Tool Failed",
    "edge.traversed": "Moved to Next Step",
    "memory.read": "Memory Loaded",
    "memory.write": "Memory Saved",
    "fanout.started": "Parallel Fan-Out Started",
    "fanout.item_started": "Fan-Out Item Started",
    "fanout.item_completed": "Fan-Out Item Completed",
    "fanout.item_failed": "Fan-Out Item Failed",
    "fanout.completed": "Parallel Fan-Out Completed",
    "human_approval.requested": "Human Decision Requested",
    "human_approval.approved": "Approved by Human",
    "human_approval.rejected": "Rejected by Human",
    "human_approval.resolved": "Human Decision Recorded",
    "state.updated": "State Updated",
    log: "Debug Log",
  };
  if (labels[type]) return labels[type];
  return type
    .split(".")
    .map((part) => humanizeKey(part))
    .join(" · ");
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatBulletValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return decodeEscapedNewlines(value).trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      const indent = "  ".repeat(depth);
      return "\n" + value.map((item) => `${indent}- ${decodeEscapedNewlines(String(item)).trim()}`).join("\n");
    }
    const indent = "  ".repeat(depth);
    return "\n" + value.map((item) => `${indent}- ${formatBulletValue(item, depth + 1).replace(/^\n/, "")}`).join("\n");
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return "None";
    const indent = "  ".repeat(depth);
    return (
      "\n" +
      entries
        .map(([k, v]) => {
          const rendered = formatBulletValue(v, depth + 1);
          if (rendered.startsWith("\n")) {
            return `${indent}- **${humanizeKey(k)}:**${rendered}`;
          }
          return `${indent}- **${humanizeKey(k)}:** ${rendered}`;
        })
        .join("\n")
    );
  }
  return String(value);
}

/**
 * Convert a structured JSON agent object (receipt, QA report, blocker report,
 * supervisor verdict, etc.) into readable Markdown sections.
 */
export function formatStructuredObjectAsMarkdown(record: Record<string, unknown>): string {
  const lines: string[] = [];
  const consumed = new Set<string>();

  // Top summary strip (status, workPackage, stage, verdict, qaStatus, next)
  const headerKeys = ["status", "workPackage", "stage", "blocked_stage", "verdict", "qaStatus", "next"] as const;
  const badges: string[] = [];
  for (const key of headerKeys) {
    const val = record[key];
    if (typeof val === "string" && val.trim()) {
      badges.push(`**${humanizeKey(key)}:** \`${val.trim()}\``);
      consumed.add(key);
    }
  }
  if (badges.length > 0) {
    lines.push(badges.join(" · "));
  }

  // Primary narrative sections in priority order
  const primaryTextKeys = ["summary", "reason", "required_input", "requiredInput", "message", "notes", "acceptance", "resume_when"] as const;
  for (const key of primaryTextKeys) {
    const val = record[key];
    if (typeof val === "string" && val.trim()) {
      lines.push(`### ${humanizeKey(key)}\n${decodeEscapedNewlines(val).trim()}`);
      consumed.add(key);
    }
  }

  // Prominent list/object sections
  const prominentKeys = ["blockers", "defects", "remainingTasks", "questions", "verification", "findings", "decisions", "warnings", "references", "answers"] as const;
  for (const key of prominentKeys) {
    if (!(key in record) || consumed.has(key)) continue;
    const val = record[key];
    if (val === undefined || val === null) continue;
    consumed.add(key);
    if (Array.isArray(val) && val.length === 0) {
      if (key === "defects" || key === "blockers" || key === "remainingTasks") {
        lines.push(`**${humanizeKey(key)}:** None`);
      }
      continue;
    }
    const body = formatBulletValue(val, 0).replace(/^\n/, "");
    lines.push(`### ${humanizeKey(key)}\n${body}`);
  }

  // Any remaining fields
  const remaining = Object.entries(record).filter(([k, v]) => !consumed.has(k) && v !== undefined && v !== null);
  if (remaining.length > 0) {
    const detailLines = remaining.map(([k, v]) => {
      const rendered = formatBulletValue(v, 1);
      return rendered.startsWith("\n")
        ? `- **${humanizeKey(k)}:**${rendered}`
        : `- **${humanizeKey(k)}:** ${rendered}`;
    });
    lines.push(`### Details\n${detailLines.join("\n")}`);
  }

  return lines.join("\n\n").trim();
}

/**
 * Transform raw JSON or Markdown containing fenced ```json ... ``` agent reports
 * into clean human-readable Markdown prose. Plain non-JSON Markdown passes through unchanged.
 */
export function formatAgentTextForReading(raw: string): { markdown: string; formattedFromJson: boolean } {
  const decoded = decodeEscapedNewlines(raw).trim();
  if (!decoded) return { markdown: "", formattedFromJson: false };

  // Case 1: The entire text is a single JSON object.
  const wholeObj = tryParseJsonObject(decoded);
  if (wholeObj) {
    return { markdown: formatStructuredObjectAsMarkdown(wholeObj), formattedFromJson: true };
  }

  // Case 2: Markdown containing one or more fenced ```json { ... } ``` blocks.
  let formattedFromJson = false;
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  const replaced = decoded.replace(fenceRegex, (fullMatch, inner: string) => {
    const parsed = tryParseJsonObject(inner);
    if (!parsed) return fullMatch;
    // Only format agent-like structured payloads (avoid altering small code examples without recognized keys).
    const looksLikeAgentPayload = [
      "status",
      "workPackage",
      "blockers",
      "summary",
      "verdict",
      "qaStatus",
      "next",
      "defects",
      "verification",
      "reason",
      "required_input",
      "questions",
      "remainingTasks",
    ].some((key) => key in parsed);
    if (!looksLikeAgentPayload) return fullMatch;
    formattedFromJson = true;
    return formatStructuredObjectAsMarkdown(parsed);
  });

  return { markdown: replaced.trim(), formattedFromJson };
}

/** Format any unknown value (string, structured object, primitive) for readable UI rendering. */
export function formatAnyValueForReading(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return formatAgentTextForReading(value).markdown;
  if (isRecord(value)) {
    // Unwrap NodeResultEnvelope if it wraps a readable value
    if (typeof value.contractVersion === "number" && "value" in value && value.status === "success") {
      return formatAnyValueForReading(value.value);
    }
    if (typeof value.content === "string" && Object.keys(value).length <= 3) {
      return formatAgentTextForReading(value.content).markdown;
    }
    return formatStructuredObjectAsMarkdown(value);
  }
  if (Array.isArray(value)) {
    return formatBulletValue(value, 0).replace(/^\n/, "");
  }
  return String(value);
}

/** Turn a raw server/runtime error string + optional code into a clear user-facing explanation. */
export function explainRunError(errorText?: string | null, explicitCode?: string): ExplainedError {
  const raw = decodeEscapedNewlines(errorText ?? "").trim();
  const prefixMatch = raw.match(/^([A-Z][A-Z0-9_]{3,}):\s*([\s\S]+)$/);
  const code = explicitCode || prefixMatch?.[1];
  const cleanMessage = prefixMatch ? prefixMatch[2].trim() : raw;
  const known = code ? KNOWN_ERROR_MAP[code] : undefined;

  let hint = known?.hint;
  if (/RESOURCE_EXHAUSTED|quota reached|429/i.test(cleanMessage)) {
    hint = "The selected model hit its quota limit. Change the agent's model in Agents settings and click Retry to resume from this exact step.";
  } else if (/127\.0\.0\.1:1234|connection_error|ECONNREFUSED|could not be reached/i.test(cleanMessage)) {
    hint = "A required local service (such as LM Studio on 127.0.0.1:1234) is not reachable. Start the service and click Retry.";
  } else if (/credential resolution failed|Authentication required/i.test(cleanMessage)) {
    hint = "The CLI provider is not authenticated. Log in / set credentials or switch the agent's provider, then click Retry.";
  } else if (/cannot be used with/i.test(cleanMessage)) {
    hint = "Conflicting CLI flags were passed to the agent backend. Fix the agent's CLI args and click Retry.";
  }

  return {
    title: known?.title ?? (code ? humanizeKey(code.toLowerCase()) : "Execution stopped"),
    explanation: cleanMessage || "The run stopped with an unspecified error.",
    ...(code ? { code } : {}),
    ...(hint ? { hint } : {}),
  };
}

function extractObjectFromEventContent(content: unknown): Record<string, unknown> | null {
  if (isRecord(content)) return content;
  if (typeof content !== "string") return null;
  const decoded = decodeEscapedNewlines(content).trim();
  const whole = tryParseJsonObject(decoded);
  if (whole) return whole;
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let lastParsed: Record<string, unknown> | null = null;
  while ((match = fenceRegex.exec(decoded)) !== null) {
    const parsed = tryParseJsonObject(match[1] ?? "");
    if (parsed) lastParsed = parsed;
  }
  return lastParsed;
}

/**
 * Find the most recent agent report/failure before a run/node failure so error views
 * immediately surface the actual human-readable blocker (e.g., why B03 was blocked).
 */
export function extractLatestAgentBlockerContext(
  events: readonly RunEvent[],
  upToSequence?: number,
): AgentBlockerContext | null {
  const ordered = [...events]
    .filter((event) => (upToSequence === undefined ? true : event.sequence <= upToSequence))
    .sort((a, b) => b.sequence - a.sequence);

  for (const event of ordered) {
    if (event.type !== "agent.completed" && event.type !== "agent.failed") continue;
    const payload = event.payload;
    if (event.type === "agent.failed" && typeof payload.error === "string" && payload.error.trim()) {
      return {
        nodeId: event.nodeId,
        agentId: event.agentId,
        sequence: event.sequence,
        status: "failed",
        blockers: [decodeEscapedNewlines(payload.error).trim()],
        formattedMarkdown: decodeEscapedNewlines(payload.error).trim(),
      };
    }

    const content = payload.content ?? payload.output;
    const parsed = extractObjectFromEventContent(content);
    if (parsed) {
      const blockers: string[] = [];
      if (Array.isArray(parsed.blockers)) {
        for (const item of parsed.blockers) {
          if (typeof item === "string" && item.trim()) blockers.push(item.trim());
        }
      }
      if (typeof parsed.reason === "string" && parsed.reason.trim()) blockers.push(parsed.reason.trim());
      if (typeof parsed.required_input === "string" && parsed.required_input.trim()) blockers.push(parsed.required_input.trim());
      if (isRecord(parsed.error) && typeof parsed.error.message === "string" && parsed.error.message.trim()) {
        blockers.push(parsed.error.message.trim());
      }
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : typeof parsed.notes === "string" && parsed.notes.trim()
            ? parsed.notes.trim()
            : undefined;
      return {
        nodeId: event.nodeId,
        agentId: event.agentId,
        sequence: event.sequence,
        status: typeof parsed.status === "string" ? parsed.status : undefined,
        workPackage: typeof parsed.workPackage === "string" ? parsed.workPackage : undefined,
        blockers,
        summary,
        formattedMarkdown: formatStructuredObjectAsMarkdown(parsed),
      };
    }

    if (typeof content === "string" && content.trim()) {
      const formatted = formatAgentTextForReading(content).markdown;
      return {
        nodeId: event.nodeId,
        agentId: event.agentId,
        sequence: event.sequence,
        blockers: [],
        summary: formatted.slice(0, 300),
        formattedMarkdown: formatted,
      };
    }
  }
  return null;
}

/** Produce a compact 1-line human preview for an event row in the timeline list. */
export function summarizeEventPreview(event: RunEvent): string | null {
  const payload = event.payload;
  if (typeof payload.error === "string" && payload.error.trim()) {
    return explainRunError(payload.error, typeof payload.code === "string" ? payload.code : undefined).explanation.slice(0, 140);
  }
  if (event.type === "edge.traversed" && typeof payload.source === "string" && typeof payload.target === "string") {
    const branch = typeof payload.branchKey === "string" && payload.branchKey ? ` (${payload.branchKey})` : "";
    return `${payload.source} → ${payload.target}${branch}`;
  }
  if (event.type === "fanout.completed") {
    return `${payload.succeeded ?? 0}/${payload.totalItems ?? 0} succeeded${Number(payload.failed) > 0 ? `, ${payload.failed} failed` : ""}`;
  }
  if (event.type === "run.resumed" && Array.isArray(payload.resumedAtNodes)) {
    return `Resumed at ${payload.resumedAtNodes.join(", ")}`;
  }
  if (event.type === "memory.write" && typeof payload.key === "string") {
    return `Saved key "${payload.key}"`;
  }
  if (event.type === "state.updated" && typeof payload.branch === "string") {
    return `Routed to "${payload.branch}"`;
  }
  const content = payload.content ?? payload.output;
  const parsed = extractObjectFromEventContent(content);
  if (parsed) {
    if (Array.isArray(parsed.blockers) && typeof parsed.blockers[0] === "string") {
      return `Blocked: ${parsed.blockers[0].slice(0, 130)}`;
    }
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      return parsed.summary.trim().slice(0, 140);
    }
    if (typeof parsed.reason === "string" && parsed.reason.trim()) {
      return parsed.reason.trim().slice(0, 140);
    }
    if (typeof parsed.status === "string") {
      const wp = typeof parsed.workPackage === "string" ? ` (${parsed.workPackage})` : "";
      return `Status: ${parsed.status}${wp}`;
    }
  }
  if (typeof content === "string" && content.trim()) {
    const firstLine = decodeEscapedNewlines(content)
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0 && !l.startsWith("```"));
    return firstLine ? firstLine.slice(0, 140) : null;
  }
  return null;
}

export function isImportantTimelineEvent(event: RunEvent): boolean {
  if (event.type === "log") {
    return typeof event.payload.error === "string" || event.payload.channel === "thinking";
  }
  if (event.type === "memory.read") return false;
  return true;
}

export interface NodeRecordedOutcome {
  nodeId: string;
  status: string;
  summary?: string;
  output?: unknown;
  error?: string;
  branch?: string;
  workPackage?: string;
  sequence: number;
}

const NODE_MAP_PARENT_KEYS = new Set(["nodeOutcomes", "handoffs", "agentOutputs", "outcomes"]);

function isTruncatedSentinel(value: unknown): boolean {
  return value === "[truncated]";
}

function hasAnyTruncatedField(value: unknown): boolean {
  if (isTruncatedSentinel(value)) return true;
  if (!isRecord(value)) return false;
  return Object.values(value).some((entry) => isTruncatedSentinel(entry));
}

function firstReadableSummary(parsed: Record<string, unknown>): string | undefined {
  for (const key of ["summary", "reason", "notes", "message"]) {
    const candidate = parsed[key];
    if (typeof candidate === "string" && candidate.trim() && candidate !== "[truncated]") {
      return candidate.trim();
    }
  }
  if (Array.isArray(parsed.blockers)) {
    const first = parsed.blockers.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (first) return `Blocked: ${first.trim()}`;
  }
  return undefined;
}

/**
 * Collect the actual untruncated outcomes recorded for each node across a run's
 * timeline (agent.completed, agent.output, node.completed, state.updated, failures).
 * Used to hydrate legacy "[truncated]" snapshots in LangGraph log frames and run outputs.
 */
export function buildNodeOutcomeLookup(events: readonly RunEvent[]): Map<string, NodeRecordedOutcome> {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const lookup = new Map<string, NodeRecordedOutcome>();

  const upsert = (nodeId: string, sequence: number, patch: Partial<NodeRecordedOutcome>) => {
    const prev = lookup.get(nodeId);
    lookup.set(nodeId, {
      nodeId,
      status: patch.status ?? prev?.status ?? "recorded",
      summary: patch.summary ?? prev?.summary,
      output: patch.output !== undefined ? patch.output : prev?.output,
      error: patch.error ?? prev?.error,
      branch: patch.branch ?? prev?.branch,
      workPackage: patch.workPackage ?? prev?.workPackage,
      sequence,
    });
  };

  for (const event of ordered) {
    const nodeId = event.nodeId;
    if (!nodeId) continue;
    const payload = event.payload ?? {};

    if (event.type === "node.started" || event.type === "agent.started") {
      if (!lookup.has(nodeId)) upsert(nodeId, event.sequence, { status: "running" });
      continue;
    }

    if (event.type === "state.updated") {
      const branch = typeof payload.branch === "string" ? payload.branch : undefined;
      const workPackage = typeof payload.workPackage === "string" ? payload.workPackage : undefined;
      const summary = branch
        ? `Routed to "${branch}"${workPackage ? ` (${workPackage})` : ""}`
        : workPackage
          ? `Work package ${workPackage}`
          : undefined;
      upsert(nodeId, event.sequence, { branch, workPackage, summary });
      continue;
    }

    if (event.type === "agent.completed" || (event.type === "log" && (payload.content !== undefined || payload.output !== undefined))) {
      const raw = payload.content ?? payload.output;
      if (raw === undefined || isTruncatedSentinel(raw)) continue;
      const parsed = extractObjectFromEventContent(raw);
      if (parsed && !hasAnyTruncatedField(parsed)) {
        const status = typeof parsed.status === "string" ? parsed.status : (event.type === "agent.completed" ? "completed" : undefined);
        const workPackage = typeof parsed.workPackage === "string" ? parsed.workPackage : undefined;
        const summary = firstReadableSummary(parsed);
        upsert(nodeId, event.sequence, { status, workPackage, summary, output: parsed });
      } else if (typeof raw === "string" && raw.trim()) {
        const decoded = decodeEscapedNewlines(raw).trim();
        const firstLine = decoded
          .split("\n")
          .map((line) => line.replace(/^#+\s*/, "").trim())
          .find((line) => line.length > 0 && !line.startsWith("```"));
        upsert(nodeId, event.sequence, {
          status: event.type === "agent.completed" ? "completed" : undefined,
          summary: firstLine ? firstLine.slice(0, 220) : undefined,
          output: decoded,
        });
      }
      continue;
    }

    if (event.type === "node.completed") {
      const existing = lookup.get(nodeId);
      const resultObj = isRecord(payload.result) && !hasAnyTruncatedField(payload.result)
        ? payload.result
        : undefined;
      const status = typeof resultObj?.status === "string"
        ? resultObj.status
        : existing?.status && existing.status !== "running" && existing.status !== "recorded"
          ? existing.status
          : "completed";
      const output = resultObj?.value !== undefined && !isTruncatedSentinel(resultObj.value)
        ? resultObj.value
        : existing?.output;
      upsert(nodeId, event.sequence, { status, output });
      continue;
    }

    if (event.type === "node.failed" || event.type === "agent.failed") {
      const error = typeof payload.error === "string" ? payload.error : undefined;
      upsert(nodeId, event.sequence, { status: "failed", error, summary: error });
    }
  }

  return lookup;
}

function hydrateNodeEntry(
  nodeId: string,
  entry: unknown,
  lookup: Map<string, NodeRecordedOutcome>,
): unknown {
  const recorded = lookup.get(nodeId);
  const preserved: Record<string, unknown> = {};
  if (isRecord(entry)) {
    for (const [k, v] of Object.entries(entry)) {
      if (!isTruncatedSentinel(v)) preserved[k] = v;
    }
  }
  if (!recorded) {
    if (Object.keys(preserved).length > 0) return preserved;
    return { status: "recorded" };
  }
  const hydrated: Record<string, unknown> = {
    ...preserved,
    status: typeof preserved.status === "string" ? preserved.status : recorded.status,
  };
  if (recorded.workPackage && hydrated.workPackage === undefined) hydrated.workPackage = recorded.workPackage;
  if (recorded.branch && hydrated.branch === undefined) hydrated.branch = recorded.branch;
  if (recorded.summary && hydrated.summary === undefined) hydrated.summary = recorded.summary;
  if (recorded.error && hydrated.error === undefined) hydrated.error = recorded.error;
  if (recorded.output !== undefined && hydrated.value === undefined && hydrated.output === undefined) {
    hydrated.output = recorded.output;
  }
  return hydrated;
}

/**
 * Replace "[truncated]" placeholders inside nodeOutcomes / handoffs / nested outcome
 * objects with the real recorded values from the run's timeline events.
 */
export function hydrateTruncatedPayload<T>(
  value: T,
  lookup: Map<string, NodeRecordedOutcome>,
  depth = 0,
): T {
  if (depth > 12 || value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => hydrateTruncatedPayload(item, lookup, depth + 1)) as unknown as T;
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (NODE_MAP_PARENT_KEYS.has(key) && isRecord(item)) {
      const hydratedMap: Record<string, unknown> = {};
      for (const [nodeId, nodeEntry] of Object.entries(item)) {
        hydratedMap[nodeId] = hasAnyTruncatedField(nodeEntry)
          ? hydrateNodeEntry(nodeId, nodeEntry, lookup)
          : hydrateTruncatedPayload(nodeEntry, lookup, depth + 1);
      }
      out[key] = hydratedMap;
      continue;
    }
    if (isTruncatedSentinel(item)) {
      const siblingNodeId = typeof record.node === "string"
        ? record.node
        : typeof record.nodeId === "string"
          ? record.nodeId
          : typeof record.name === "string"
            ? record.name
            : undefined;
      const recorded = siblingNodeId ? lookup.get(siblingNodeId) : undefined;
      if (recorded) {
        if (key === "status") { out[key] = recorded.status; continue; }
        if (key === "summary" && recorded.summary) { out[key] = recorded.summary; continue; }
        if ((key === "value" || key === "output" || key === "result") && recorded.output !== undefined) {
          out[key] = recorded.output;
          continue;
        }
        if (key === "error" && recorded.error) { out[key] = recorded.error; continue; }
      }
      continue;
    }
    out[key] = hydrateTruncatedPayload(item, lookup, depth + 1);
  }
  return out as T;
}
