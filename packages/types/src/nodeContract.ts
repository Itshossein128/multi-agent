/**
 * Versioned, domain-agnostic node contracts and the deterministic result
 * envelope for workflow node execution.
 *
 * A `NodeContract` declares what a node accepts (`inputSchema`), what it
 * produces (`outputSchema`), which contract version it was authored against,
 * an optional payload bound, and optional evidence/provenance capture. The
 * schemas are enforced at real execution boundaries (tool input/output, agent
 * results, condition carriers, persisted outputs) — they are not metadata.
 *
 * A `NodeResultEnvelope` is the structured result of an execution. It makes
 * successful execution, validation failure, operational failure, policy
 * rejection, blocked execution, needs-human approval, and unknown/ambiguous
 * outcomes distinguishable without parsing free-form model text.
 */

import {
  findUnsupportedSchemaKeywords,
  validateAgainstSchema,
  type SchemaIssue,
} from "./schemaValidation";

/** Current contract schema version understood by this build. */
export const NODE_CONTRACT_VERSION = 1;

/** Default bound applied to contract-governed payloads (256 KiB). */
export const DEFAULT_CONTRACT_PAYLOAD_BYTES = 256 * 1024;
export const MIN_CONTRACT_PAYLOAD_BYTES = 1_024;
export const MAX_CONTRACT_PAYLOAD_BYTES = 10 * 1024 * 1024;

/** Maximum diagnostics retained on any envelope or error. */
export const MAX_CONTRACT_DIAGNOSTICS = 25;

export type JsonSchema = Record<string, unknown>;

/**
 * Versioned input/output contract for a workflow node. Optional fields keep
 * legacy definitions (which predate contracts) fully compatible.
 */
export interface NodeContract {
  /** Contract schema version. Values newer than NODE_CONTRACT_VERSION are rejected. */
  version: number;
  /** JSON-Schema subset validated before the node executes. */
  inputSchema?: JsonSchema;
  /** JSON-Schema subset validated on the node's structured result. */
  outputSchema?: JsonSchema;
  /** Upper bound (bytes) enforced on contract-governed payloads. */
  maxPayloadBytes?: number;
  /** Opt in to retaining bounded provenance/evidence metadata on results. */
  captureEvidence?: boolean;
}

/** Deterministic outcome taxonomy for node and run results. */
export const NODE_OUTCOME_STATUSES = [
  "success",
  "validation_failed",
  "failed",
  "policy_rejected",
  "blocked",
  "needs_human",
  "unknown",
] as const;

export type NodeOutcomeStatus = (typeof NODE_OUTCOME_STATUSES)[number];

/** Sanitized, bounded diagnostic. Never carries raw payload values. */
export interface ContractDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export interface ContractErrorInfo {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface NeedsHumanInfo {
  reason: string;
}

export interface EvidenceInfo {
  /** Producer class: agent, tool, input, system, or a custom label. */
  source: string;
  producedAt: string;
  detail?: string;
}

/** The reusable result envelope replacing arbitrary model text. */
export interface NodeResultEnvelope {
  contractVersion: number;
  status: NodeOutcomeStatus;
  /** Success (or typed failure) payload. */
  value?: unknown;
  /** Explicit branch value selected by the producer, when any. */
  branch?: string;
  error?: ContractErrorInfo;
  needsHuman?: NeedsHumanInfo;
  /** Optional bounded evidence/provenance metadata. */
  evidence?: EvidenceInfo;
  /** Structured, bounded diagnostics (schema issues, routing reasons, …). */
  diagnostics?: ContractDiagnostic[];
}

export interface ContractDeclarationIssue {
  code: string;
  message: string;
  field?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function clampPayloadBound(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const bytes = Math.floor(value as number);
  if (bytes < MIN_CONTRACT_PAYLOAD_BYTES || bytes > MAX_CONTRACT_PAYLOAD_BYTES) return undefined;
  return bytes;
}

/**
 * Normalize persisted / inbound contract data from older workflow
 * definitions. Unknown shapes are dropped rather than propagated; declared
 * payload bounds and versions are preserved so validation can report them
 * with stable codes instead of silently rewriting author intent.
 */
export function migrateNodeContract(raw: unknown): NodeContract | undefined {
  if (!isPlainObject(raw)) return undefined;
  const contract: NodeContract = {
    version: Number.isInteger(raw.version) && (raw.version as number) >= 1 ? (raw.version as number) : NODE_CONTRACT_VERSION,
  };
  if (isPlainObject(raw.inputSchema)) contract.inputSchema = raw.inputSchema as JsonSchema;
  if (isPlainObject(raw.outputSchema)) contract.outputSchema = raw.outputSchema as JsonSchema;
  if (typeof raw.maxPayloadBytes === "number") contract.maxPayloadBytes = raw.maxPayloadBytes;
  if (typeof raw.captureEvidence === "boolean") contract.captureEvidence = raw.captureEvidence;
  return contract;
}

/** Declaration-time contract validation with stable codes (server authority). */
export function validateNodeContract(contract: NodeContract | undefined): ContractDeclarationIssue[] {
  return validateRawNodeContract(contract);
}

/**
 * Declaration-time validation of a raw (persisted or bound) contract value.
 * Reports malformed shapes with the same stable codes instead of silently
 * normalizing author intent away.
 */
export function validateRawNodeContract(raw: unknown): ContractDeclarationIssue[] {
  if (raw === undefined || raw === null) return [];
  if (!isPlainObject(raw)) {
    return [{ code: "INVALID_CONTRACT_SCHEMA", message: "Node contract must be an object." }];
  }
  const contract = raw;
  const issues: ContractDeclarationIssue[] = [];
  const knownFields = new Set(["version", "inputSchema", "outputSchema", "maxPayloadBytes", "captureEvidence"]);
  for (const field of Object.keys(contract)) {
    if (!knownFields.has(field)) {
      issues.push({
        code: "UNKNOWN_CONTRACT_FIELD",
        field,
        message: `Node contract contains an unsupported field "${field}".`,
      });
    }
  }
  if (contract.version !== undefined && (!Number.isInteger(contract.version) || (contract.version as number) < 1)) {
    issues.push({ code: "INVALID_CONTRACT_VERSION", field: "version", message: "Contract version must be a positive integer." });
  } else if (Number.isInteger(contract.version) && (contract.version as number) > NODE_CONTRACT_VERSION) {
    issues.push({
      code: "UNSUPPORTED_CONTRACT_VERSION",
      field: "version",
      message: `Contract version ${String(contract.version)} is newer than supported version ${NODE_CONTRACT_VERSION}.`,
    });
  }
  for (const field of ["inputSchema", "outputSchema"] as const) {
    const schema = contract[field];
    if (schema === undefined) continue;
    if (!isPlainObject(schema)) {
      issues.push({ code: "INVALID_CONTRACT_SCHEMA", field, message: `Contract ${field} must be a JSON object schema.` });
      continue;
    }
    const unsupported = findUnsupportedSchemaKeywords(schema);
    if (unsupported.length) {
      issues.push({
        code: "UNSUPPORTED_SCHEMA_KEYWORD",
        field,
        message: `Contract ${field} uses keywords this server cannot enforce: ${unsupported.join(", ")}.`,
      });
    }
  }
  if (contract.maxPayloadBytes !== undefined && clampPayloadBound(contract.maxPayloadBytes) === undefined) {
    issues.push({
      code: "INVALID_PAYLOAD_BOUNDS",
      field: "maxPayloadBytes",
      message: `maxPayloadBytes must be an integer between ${MIN_CONTRACT_PAYLOAD_BYTES} and ${MAX_CONTRACT_PAYLOAD_BYTES}.`,
    });
  }
  if (contract.captureEvidence !== undefined && typeof contract.captureEvidence !== "boolean") {
    issues.push({ code: "INVALID_CONTRACT_EVIDENCE", field: "captureEvidence", message: "captureEvidence must be a boolean." });
  }
  return issues;
}

export type ResultEnvelopeParse =
  | { kind: "absent" }
  | { kind: "valid"; envelope: NodeResultEnvelope }
  | { kind: "malformed"; diagnostics: ContractDiagnostic[] };

function diagnosticsFromSchemaIssues(issues: SchemaIssue[]): ContractDiagnostic[] {
  return issues.slice(0, MAX_CONTRACT_DIAGNOSTICS).map((issue) => ({ code: issue.code, message: issue.message, path: issue.path }));
}

/**
 * Strictly parse a structured result envelope. Anything without a recognized
 * `status` is *not* an envelope (it stays a plain value). An object that
 * claims envelope status but violates the envelope shape is `malformed` and
 * must be rejected by the caller instead of being interpreted.
 */
export function parseResultEnvelope(raw: unknown): ResultEnvelopeParse {
  if (!isPlainObject(raw)) return { kind: "absent" };
  const status = raw.status;
  if (typeof status !== "string" || !(NODE_OUTCOME_STATUSES as readonly string[]).includes(status)) {
    return { kind: "absent" };
  }
  // `status: "success"` is a common business payload shape in legacy
  // agents. Treat it as an envelope only when it has an envelope marker or
  // another envelope-specific field; otherwise preserve the legacy value.
  // Non-success statuses remain strict markers because they represent
  // control-flow outcomes rather than ordinary business data.
  const hasEnvelopeMarker = raw.contractVersion !== undefined
    || "value" in raw
    || "branch" in raw
    || "error" in raw
    || "needsHuman" in raw
    || "evidence" in raw
    || "diagnostics" in raw;
  if (status === "success" && !hasEnvelopeMarker) return { kind: "absent" };
  const diagnostics: ContractDiagnostic[] = [];
  if (raw.contractVersion !== undefined && (!Number.isInteger(raw.contractVersion) || (raw.contractVersion as number) < 1)) {
    diagnostics.push({ code: "ENVELOPE_CONTRACT_VERSION_INVALID", message: "contractVersion must be a positive integer.", path: "$.contractVersion" });
  }
  if (raw.branch !== undefined && typeof raw.branch !== "string") {
    diagnostics.push({ code: "ENVELOPE_BRANCH_INVALID", message: "branch must be a string.", path: "$.branch" });
  }
  if (raw.error !== undefined) {
    if (!isPlainObject(raw.error) || typeof raw.error.code !== "string" || typeof raw.error.message !== "string") {
      diagnostics.push({ code: "ENVELOPE_ERROR_INVALID", message: "error must be an object with string code and message.", path: "$.error" });
    }
  }
  if (raw.needsHuman !== undefined && (!isPlainObject(raw.needsHuman) || typeof raw.needsHuman.reason !== "string")) {
    diagnostics.push({ code: "ENVELOPE_NEEDS_HUMAN_INVALID", message: "needsHuman must be an object with a string reason.", path: "$.needsHuman" });
  }
  if (raw.diagnostics !== undefined && !Array.isArray(raw.diagnostics)) {
    diagnostics.push({ code: "ENVELOPE_DIAGNOSTICS_INVALID", message: "diagnostics must be an array.", path: "$.diagnostics" });
  }
  if (diagnostics.length) return { kind: "malformed", diagnostics };

  const envelope: NodeResultEnvelope = {
    contractVersion: Number.isInteger(raw.contractVersion) ? (raw.contractVersion as number) : NODE_CONTRACT_VERSION,
    status: status as NodeOutcomeStatus,
  };
  if ("value" in raw) envelope.value = raw.value;
  if (typeof raw.branch === "string") envelope.branch = raw.branch;
  if (isPlainObject(raw.error)) {
    const errorInfo = raw.error as unknown as ContractErrorInfo;
    envelope.error = {
      code: errorInfo.code,
      message: errorInfo.message,
      ...(typeof errorInfo.retryable === "boolean" ? { retryable: errorInfo.retryable } : {}),
    };
  }
  if (isPlainObject(raw.needsHuman)) {
    envelope.needsHuman = { reason: (raw.needsHuman as unknown as NeedsHumanInfo).reason };
  }
  if (isPlainObject(raw.evidence)) {
    const evidence = raw.evidence as unknown as EvidenceInfo;
    if (typeof evidence.source === "string") {
      envelope.evidence = {
        source: evidence.source.slice(0, 64),
        producedAt: typeof evidence.producedAt === "string" ? evidence.producedAt.slice(0, 40) : new Date(0).toISOString(),
        ...(typeof evidence.detail === "string" ? { detail: evidence.detail.slice(0, 500) } : {}),
      };
    }
  }
  if (Array.isArray(raw.diagnostics)) {
    envelope.diagnostics = raw.diagnostics
      .filter((item): item is ContractDiagnostic => isPlainObject(item) && typeof item.code === "string" && typeof item.message === "string")
      .slice(0, MAX_CONTRACT_DIAGNOSTICS)
      .map((item) => ({
        code: item.code.slice(0, 64),
        message: item.message.slice(0, 300),
        ...(typeof item.path === "string" ? { path: item.path.slice(0, 200) } : {}),
      }));
  }
  return { kind: "valid", envelope };
}

/** Build a structured result envelope with bounded diagnostics. */
export function createResultEnvelope(
  status: NodeOutcomeStatus,
  options: Omit<NodeResultEnvelope, "contractVersion" | "status"> = {},
): NodeResultEnvelope {
  const envelope: NodeResultEnvelope = { contractVersion: NODE_CONTRACT_VERSION, status };
  if ("value" in options) envelope.value = options.value;
  if (options.branch !== undefined) envelope.branch = options.branch;
  if (options.error) envelope.error = options.error;
  if (options.needsHuman) envelope.needsHuman = options.needsHuman;
  if (options.evidence) envelope.evidence = options.evidence;
  if (options.diagnostics?.length) envelope.diagnostics = options.diagnostics.slice(0, MAX_CONTRACT_DIAGNOSTICS);
  return envelope;
}

/** Envelope for schema/contract violations at a boundary. */
export function validationFailedEnvelope(
  code: string,
  message: string,
  diagnostics: ContractDiagnostic[] = [],
): NodeResultEnvelope {
  return createResultEnvelope("validation_failed", {
    error: { code, message: message.slice(0, 300), retryable: false },
    diagnostics: diagnostics.slice(0, MAX_CONTRACT_DIAGNOSTICS),
  });
}

export function diagnosticsFromValidation(
  result: { issues: SchemaIssue[]; truncated: boolean },
): ContractDiagnostic[] {
  const diagnostics = diagnosticsFromSchemaIssues(result.issues);
  if (result.truncated) {
    diagnostics.push({ code: "DIAGNOSTICS_TRUNCATED", message: "Additional issues were omitted (issue cap reached)." });
  }
  return diagnostics;
}

/**
 * Error raised when a contract boundary rejects a value. It is terminal:
 * contract failures are deterministic and must never be retried.
 */
export class ContractViolationError extends Error {
  readonly code: string;
  readonly diagnostics: ContractDiagnostic[];
  readonly nodeId?: string;
  /** Result state accompanying the violation, for run persistence. */
  readonly envelope: NodeResultEnvelope;

  constructor(code: string, message: string, options: { diagnostics?: ContractDiagnostic[]; nodeId?: string } = {}) {
    super(`${code}: ${message}`.slice(0, 1_000));
    this.name = "ContractViolationError";
    this.code = code;
    this.diagnostics = (options.diagnostics ?? []).slice(0, MAX_CONTRACT_DIAGNOSTICS);
    this.nodeId = options.nodeId;
    this.envelope = validationFailedEnvelope(code, message, this.diagnostics);
  }
}

/** JSON byte size of a value, falling back to a conservative estimate. */
export function payloadByteSize(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
  if (serialized === undefined) return 0;
  // Buffer exists in Node; TextEncoder is the portable fallback.
  if (typeof Buffer !== "undefined") return Buffer.byteLength(serialized, "utf8");
  return new TextEncoder().encode(serialized).length;
}

/** Enforce a declared payload bound; throws a typed contract violation. */
export function enforcePayloadBound(
  value: unknown,
  maxBytes: number | undefined,
  options: { nodeId?: string; phase: string },
): void {
  if (maxBytes === undefined) return;
  const bytes = payloadByteSize(value);
  if (bytes > maxBytes) {
    throw new ContractViolationError(
      "PAYLOAD_TOO_LARGE",
      `${options.phase} payload of ${bytes} bytes exceeds the declared ${maxBytes}-byte bound`,
      {
        nodeId: options.nodeId,
        diagnostics: [{ code: "PAYLOAD_TOO_LARGE", message: `${options.phase} payload exceeded declared byte bound`, path: "$" }],
      },
    );
  }
}

/**
 * Validate a value against an optional declared schema at an execution
 * boundary. Returns `undefined` when the schema is absent; throws a typed
 * `ContractViolationError` with stable code when the value is rejected.
 */
export function enforceSchema(
  schema: JsonSchema | undefined,
  value: unknown,
  options: { code: string; phase: string; nodeId?: string },
): void {
  if (!schema) return;
  const result = validateAgainstSchema(schema, value);
  if (!result.valid) {
    throw new ContractViolationError(
      options.code,
      `${options.phase} does not match the declared ${options.phase.includes("input") ? "input" : "output"} schema (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"})`,
      { nodeId: options.nodeId, diagnostics: diagnosticsFromValidation(result) },
    );
  }
}
