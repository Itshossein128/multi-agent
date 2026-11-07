/**
 * Contract sketch: Explicit Step Data Mapping (016).
 * Not imported by production code — documents shapes for implementers and tests.
 * Normative codes: ./data-mapping.codes.md
 * Decisions: ../research.md
 */

/** Roots the grammar accepts. Anything else inside a recognized reference is forbidden. */
export type DataReferenceRoot = "input" | "nodes";

export type DataInputPort = "prompt" | "context" | "input" | "value";
export type DataOutputPort = "text" | "json" | "value";

export interface NodeDataMapping {
  /** Single reference. Replaces implicit primary input. */
  inputBinding?: string;
  /** Port ids that must be wired. Omitted or empty ⇒ none required. */
  requiredInputs?: DataInputPort[];
}

export interface DataWire {
  id: string;
  source: string;
  sourcePort: DataOutputPort;
  target: string;
  targetPort: DataInputPort;
}

/** Additive workflow fields. Omit when unused. schemaVersion stays 2. */
export interface DataMappingDefinitionFields {
  dataWires?: DataWire[];
}

export const DATA_MAPPING_MAX_PATH_SEGMENTS = 8;
export const DATA_MAPPING_MAX_BYTES = 256 * 1024;
export const DATA_MAPPING_PREVIEW_CHARS = 8_000;

/** Canvas handle id prefix. Must not collide with approval or condition handles. */
export const DATA_HANDLE_PREFIX = "data:";

export const DATA_PORTS: Record<
  string,
  { inputs: readonly DataInputPort[]; outputs: readonly DataOutputPort[] }
> = {
  agent: { inputs: ["prompt", "context"], outputs: ["text", "json"] },
  tool: { inputs: ["input"], outputs: ["text", "json"] },
  output: { inputs: ["value"], outputs: [] },
  memory: { inputs: ["value"], outputs: ["value"] },
  condition: { inputs: ["value"], outputs: [] },
  approval: { inputs: ["context"], outputs: [] },
  input: { inputs: [], outputs: ["value"] },
  parallel_split: { inputs: [], outputs: [] },
  parallel_join: { inputs: [], outputs: [] },
  subgraph: { inputs: [], outputs: [] },
};

/** Primary-input ports. A wire here conflicts with inputBinding. */
export const PRIMARY_INPUT_PORTS = ["context", "input", "value"] as const;

/**
 * Authored strings scanned for references.
 * Memory keys, ids, condition valueField, and subgraph mappings are not in this list.
 */
export const INTERPOLATED_FIELDS = [
  { nodeType: "agent", path: "config.taskInstruction" },
  { nodeType: "approval", path: "config.message" },
] as const;

export type DataMappingIssueCode =
  | "DATA_REF_SYNTAX"
  | "DATA_REF_FORBIDDEN"
  | "DATA_REF_DANGLING"
  | "DATA_REF_NOT_UPSTREAM"
  | "DATA_REF_UNKNOWN_FIELD"
  | "DATA_REF_UNRESOLVED"
  | "DATA_REF_TOO_LARGE"
  | "DATA_WIRE_CONFLICT"
  | "DATA_WIRE_NOT_UPSTREAM"
  | "DATA_INPUT_REQUIRED"
  | "DATA_PORT_UNKNOWN";

/** Design-time codes. Runtime adds DATA_REF_UNRESOLVED and DATA_REF_TOO_LARGE. */
export const DATA_MAPPING_DESIGN_CODES = [
  "DATA_REF_SYNTAX",
  "DATA_REF_FORBIDDEN",
  "DATA_REF_DANGLING",
  "DATA_REF_NOT_UPSTREAM",
  "DATA_REF_UNKNOWN_FIELD",
  "DATA_WIRE_CONFLICT",
  "DATA_WIRE_NOT_UPSTREAM",
  "DATA_INPUT_REQUIRED",
  "DATA_PORT_UNKNOWN",
] as const;

/**
 * node.started payload additions.
 * input is a preview. The step executes with the full value under DATA_MAPPING_MAX_BYTES.
 */
export interface ResolvedInputEventFields {
  input?: unknown;
  inputBytes?: number;
  inputTruncated?: boolean;
  /** Expression, or `port:<id>` when a data wire selected the primary input. */
  inputBinding?: string;
}
