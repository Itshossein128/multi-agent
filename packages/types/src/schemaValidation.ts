/**
 * Dependency-free JSON-Schema subset validator shared by the workflow
 * compiler, tool runtime, server API, and editor.
 *
 * Design rules:
 * - Stable machine-readable issue codes (`SCHEMA_*`) for every failure kind.
 * - Diagnostics are sanitized by construction: they carry a JSON path, an
 *   expected shape, and the *type* of the offending value — never the value
 *   itself — so secrets and payloads cannot leak into logs, events, or
 *   persisted run data.
 * - Issue lists, path lengths, and traversal depth are bounded.
 *
 * Supported keywords: type, properties, required, additionalProperties, items,
 * enum, const, minLength, maxLength, minimum, maximum, exclusiveMinimum,
 * exclusiveMaximum, minItems, maxItems, minProperties, maxProperties,
 * uniqueItems, pattern, format, allOf, anyOf, oneOf, not, $ref. Annotation
 * keywords ($schema, title, description, default, examples, deprecated,
 * readOnly, writeOnly, $comment, $id) are accepted and ignored. Any other
 * keyword is reported as unsupported so the server can reject contracts it
 * cannot actually enforce (fail closed).
 */

export interface SchemaIssue {
  /** Stable machine-readable code. */
  code: string;
  /** Sanitized human-readable detail; never contains raw value payloads. */
  message: string;
  /** JSON path of the offending value, e.g. `$.items[2].name`. */
  path: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaIssue[];
  /** True when issues were dropped because the issue cap was reached. */
  truncated: boolean;
}

export interface SchemaValidationOptions {
  /** Maximum number of issues reported. Default 25. */
  maxIssues?: number;
  /** Maximum object/array traversal depth. Default 12. */
  maxDepth?: number;
  /** Maximum path length in characters. Default 200. */
  maxPathLength?: number;
}

const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "type", "properties", "required", "additionalProperties", "items",
  "enum", "const", "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems",
  "minProperties", "maxProperties", "uniqueItems",
  "pattern", "format", "allOf", "anyOf", "oneOf", "not", "$ref",
]);

const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema", "$id", "$comment", "title", "description", "default",
  "examples", "deprecated", "readOnly", "writeOnly",
  "definitions", "$defs",
]);

export const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([...SUPPORTED_KEYWORDS, ...ANNOTATION_KEYWORDS]);

const DEFAULT_MAX_ISSUES = 25;
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_PATH_LENGTH = 200;
const MAX_ENUM_PREVIEW = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Collect structural keywords the validator cannot enforce. Recursive through
 * `properties`, `items`, `additionalProperties`, and `$defs`/`definitions`.
 */
export function findUnsupportedSchemaKeywords(schema: unknown, maxDepth = DEFAULT_MAX_DEPTH): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > maxDepth || !isPlainObject(node)) return;
    for (const [keyword, value] of Object.entries(node)) {
      if (ANNOTATION_KEYWORDS.has(keyword)) continue;
      if (!SCHEMA_KEYWORDS.has(keyword)) {
        found.add(keyword);
        continue;
      }
      if (keyword === "properties" || keyword === "$defs" || keyword === "definitions") {
        if (isPlainObject(value)) for (const child of Object.values(value)) visit(child, depth + 1);
      } else if (keyword === "items" || keyword === "additionalProperties") {
        if (isPlainObject(value)) visit(value, depth + 1);
      } else if (keyword === "allOf" || keyword === "anyOf" || keyword === "oneOf") {
        if (Array.isArray(value)) for (const child of value) visit(child, depth + 1);
      } else if (keyword === "not") {
        visit(value, depth + 1);
      }
    }
  };
  visit(schema, 0);
  return [...found].sort().slice(0, 10);
}

/** A schema is usable when it is a plain object without unsupported keywords. */
export function isUsableSchema(schema: unknown): boolean {
  return isPlainObject(schema) && findUnsupportedSchemaKeywords(schema).length === 0;
}

interface Context {
  issues: SchemaIssue[];
  truncated: boolean;
  maxIssues: number;
  maxDepth: number;
  maxPathLength: number;
}

function pushIssue(ctx: Context, code: string, path: string, message: string) {
  if (ctx.issues.length >= ctx.maxIssues) {
    ctx.truncated = true;
    return;
  }
  const boundedPath = path.length > ctx.maxPathLength ? `${path.slice(0, ctx.maxPathLength)}…` : path;
  ctx.issues.push({ code, path: boundedPath, message: `${boundedPath}: ${message}`.slice(0, 400) });
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "object": return isPlainObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

function enumSignature(schema: Record<string, unknown>): string {
  const list = Array.isArray(schema.enum) ? schema.enum : [];
  const preview = list
    .slice(0, MAX_ENUM_PREVIEW)
    .map((entry) => (["string", "number", "boolean"].includes(typeof entry) ? JSON.stringify(entry) : typeOf(entry)))
    .join(", ");
  return list.length > MAX_ENUM_PREVIEW ? `${preview}, … (${list.length} options)` : `${preview} (${list.length} options)`;
}

const MAX_PATTERN_LENGTH = 256;

function decodeJsonPointerPart(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveLocalRef(root: Record<string, unknown>, ref: unknown): Record<string, unknown> | undefined {
  if (typeof ref !== "string" || !ref.startsWith("#/") || ref.length > 512) return undefined;
  let current: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    const key = decodeJsonPointerPart(part);
    current = (current as Record<string, unknown>)[key];
  }
  return isPlainObject(current) ? current : undefined;
}

function matchesFormat(value: string, format: string): boolean | undefined {
  switch (format) {
    case "date-time": return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "time": return /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "uri":
    case "uri-reference":
      try { return format === "uri-reference" ? true : Boolean(new URL(value).protocol); } catch { return false; }
    case "ipv4": return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255);
    case "ipv6": return value.includes(":") && /^[0-9a-f:]+$/i.test(value);
    case "hostname": return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?)+$/i.test(value);
    default: return undefined;
  }
}

/**
 * Validate `value` against the supported JSON-Schema subset declared in
 * `schema`. Never throws; results are bounded and sanitized.
 */
export function validateAgainstSchema(
  schema: unknown,
  value: unknown,
  options: SchemaValidationOptions = {},
): SchemaValidationResult {
  const ctx: Context = {
    issues: [],
    truncated: false,
    maxIssues: Math.max(1, Math.min(200, options.maxIssues ?? DEFAULT_MAX_ISSUES)),
    maxDepth: Math.max(1, Math.min(64, options.maxDepth ?? DEFAULT_MAX_DEPTH)),
    maxPathLength: Math.max(16, Math.min(2_000, options.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH)),
  };
  if (!isPlainObject(schema)) {
    pushIssue(ctx, "SCHEMA_INVALID", "$", "declared schema is not a JSON object");
    return { valid: false, issues: ctx.issues, truncated: ctx.truncated };
  }
  const unsupported = findUnsupportedSchemaKeywords(schema, ctx.maxDepth);
  if (unsupported.length) {
    pushIssue(ctx, "SCHEMA_UNSUPPORTED", "$", `schema uses unsupported keywords: ${unsupported.join(", ")}`);
    return { valid: false, issues: ctx.issues, truncated: ctx.truncated };
  }
  walk(schema, value, "$", 0, ctx, schema);
  return { valid: ctx.issues.length === 0, issues: ctx.issues, truncated: ctx.truncated };
}

function walk(schema: Record<string, unknown>, value: unknown, path: string, depth: number, ctx: Context, root: Record<string, unknown>) {
  if (depth > ctx.maxDepth || ctx.issues.length >= ctx.maxIssues) {
    if (ctx.issues.length >= ctx.maxIssues) ctx.truncated = true;
    return;
  }

  if (schema.$ref !== undefined) {
    const referenced = resolveLocalRef(root, schema.$ref);
    if (!referenced) {
      pushIssue(ctx, "SCHEMA_REF_UNRESOLVED", path, "schema reference cannot be resolved");
      return;
    }
    walk(referenced, value, path, depth + 1, ctx, root);
  }

  for (const composition of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = schema[composition];
    if (!Array.isArray(branches) || branches.length === 0) continue;
    let matches = 0;
    for (const branch of branches) {
      if (!isPlainObject(branch)) continue;
      const before = ctx.issues.length;
      const truncatedBefore = ctx.truncated;
      walk(branch, value, path, depth + 1, ctx, root);
      if (ctx.issues.length === before) matches += 1;
      ctx.issues.length = before;
      ctx.truncated = truncatedBefore;
    }
    const valid = composition === "allOf" ? matches === branches.length : composition === "anyOf" ? matches > 0 : matches === 1;
    if (!valid) pushIssue(ctx, `SCHEMA_${composition.toUpperCase()}`, path, `value does not satisfy ${composition}`);
  }
  if (isPlainObject(schema.not)) {
    const before = ctx.issues.length;
    const truncatedBefore = ctx.truncated;
    walk(schema.not, value, path, depth + 1, ctx, root);
    const matched = ctx.issues.length === before;
    ctx.issues.length = before;
    ctx.truncated = truncatedBefore;
    if (matched) pushIssue(ctx, "SCHEMA_NOT", path, "value matches a schema it must not match");
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type.map(String) : [String(schema.type)];
    if (!expected.some((entry) => matchesType(value, entry))) {
      pushIssue(ctx, "SCHEMA_TYPE_MISMATCH", path, `expected type ${expected.join(" | ")}, received ${typeOf(value)}`);
      return; // Type mismatch makes further keyword checks meaningless.
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEquals(entry, value))) {
    pushIssue(ctx, "SCHEMA_ENUM", path, `value is not one of the declared options: ${enumSignature(schema)}`);
    return;
  }
  if ("const" in schema && !deepEquals(schema.const, value)) {
    pushIssue(ctx, "SCHEMA_CONST", path, "value does not match the declared constant");
    return;
  }

  if (typeof value === "string") {
    const minLength = schema.minLength;
    const maxLength = schema.maxLength;
    if (typeof minLength === "number" && value.length < minLength) {
      pushIssue(ctx, "SCHEMA_MIN_LENGTH", path, `string shorter than declared minimum length ${minLength}`);
    }
    if (typeof maxLength === "number" && value.length > maxLength) {
      pushIssue(ctx, "SCHEMA_MAX_LENGTH", path, `string longer than declared maximum length ${maxLength}`);
    }
    if (typeof schema.pattern === "string") {
      if (schema.pattern.length > MAX_PATTERN_LENGTH) {
        pushIssue(ctx, "SCHEMA_PATTERN_TOO_LONG", path, "regular expression pattern exceeds the safety limit");
      } else {
        try {
          if (!new RegExp(schema.pattern).test(value)) pushIssue(ctx, "SCHEMA_PATTERN", path, "string does not match the declared pattern");
        } catch {
          pushIssue(ctx, "SCHEMA_INVALID_PATTERN", path, "declared pattern is not a valid regular expression");
        }
      }
    }
    if (typeof schema.format === "string") {
      const formatResult = matchesFormat(value, schema.format);
      if (formatResult === undefined) pushIssue(ctx, "SCHEMA_UNSUPPORTED_FORMAT", path, "declared string format is not supported");
      else if (!formatResult) pushIssue(ctx, "SCHEMA_FORMAT", path, "string does not match the declared format");
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      pushIssue(ctx, "SCHEMA_MINIMUM", path, `number below declared minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      pushIssue(ctx, "SCHEMA_MAXIMUM", path, `number above declared maximum ${schema.maximum}`);
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      pushIssue(ctx, "SCHEMA_EXCLUSIVE_MINIMUM", path, `number not above declared exclusive minimum ${schema.exclusiveMinimum}`);
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      pushIssue(ctx, "SCHEMA_EXCLUSIVE_MAXIMUM", path, `number not below declared exclusive maximum ${schema.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      pushIssue(ctx, "SCHEMA_MIN_ITEMS", path, `array has fewer than declared minimum ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      pushIssue(ctx, "SCHEMA_MAX_ITEMS", path, `array has more than declared maximum ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true && hasDuplicateItems(value)) {
      pushIssue(ctx, "SCHEMA_UNIQUE_ITEMS", path, "array items are not unique");
    }
    if (isPlainObject(schema.items)) {
        value.forEach((item, index) => walk(schema.items as Record<string, unknown>, item, `${path}[${index}]`, depth + 1, ctx, root));
    }
    return;
  }

  if (isPlainObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        pushIssue(ctx, "SCHEMA_REQUIRED", path, `missing required property ${JSON.stringify(String(key).slice(0, 64))}`);
      }
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
    const minProperties = schema.minProperties;
    const maxProperties = schema.maxProperties;
    if (typeof minProperties === "number" && Object.keys(value).length < minProperties) {
      pushIssue(ctx, "SCHEMA_MIN_PROPERTIES", path, `object has fewer than declared minimum ${minProperties} properties`);
    }
    if (typeof maxProperties === "number" && Object.keys(value).length > maxProperties) {
      pushIssue(ctx, "SCHEMA_MAX_PROPERTIES", path, `object has more than declared maximum ${maxProperties} properties`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      const propertySchema = properties ? properties[key] : undefined;
      if (propertySchema !== undefined) {
        if (isPlainObject(propertySchema)) walk(propertySchema, child, childPath, depth + 1, ctx, root);
        continue;
      }
      if (schema.additionalProperties === false) {
        pushIssue(ctx, "SCHEMA_ADDITIONAL_PROPERTIES", childPath, "property is not declared by the schema");
      } else if (isPlainObject(schema.additionalProperties)) {
        walk(schema.additionalProperties, child, childPath, depth + 1, ctx, root);
      }
    }
  }
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function hasDuplicateItems(items: unknown[]): boolean {
  const seen = new Set<string>();
  for (const item of items.slice(0, 100)) {
    let signature: string;
    try {
      signature = typeof item === "object" && item !== null ? JSON.stringify(item) : `${typeOf(item)}:${String(item)}`;
    } catch {
      continue;
    }
    if (seen.has(signature)) return true;
    seen.add(signature);
  }
  return false;
}
