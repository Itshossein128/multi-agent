/**
 * Shared condition-branch resolution.
 *
 * The resolver is deterministic and fail-closed: it either resolves to a
 * *declared* branch key or reports why it could not. Callers must never
 * substitute "the first configured branch" for an unresolved route; the safe
 * outcomes are an explicitly declared `unknownRoute` branch or a typed
 * routing error (BRANCH_ROUTING_UNKNOWN).
 */

export interface BranchRouteConfig {
  branches: ReadonlyArray<{ key: string }>;
  /** Explicitly declared branch that receives unroutable values, if any. */
  unknownRoute?: string;
  /** Explicitly declared branch for malformed or mistyped routing input. */
  errorRoute?: string;
}

export type BranchRouteReason =
  | "resolved"
  | "missing"
  | "malformed"
  | "type_mismatch"
  | "not_declared"
  | "ambiguous";

export interface BranchRouteResolution {
  status: "routed" | "unknown";
  /** Declared branch key selected for routing (only when status is "routed"). */
  branch?: string;
  reason: BranchRouteReason;
  /** String form of the requested value when it was a string. */
  requested?: string;
  /** True when routing used the declared unknown/error route. */
  viaUnknownRoute?: boolean;
  /** True when routing used the explicit error route. */
  viaErrorRoute?: boolean;
}

/** Stable code surfaced by compiler, runtime, persistence, API, and UI. */
export const BRANCH_ROUTING_ERROR_CODE = "BRANCH_ROUTING_UNKNOWN";

/**
 * Deterministic branch-candidate normalization: trim, then apply the generic
 * verdict synonyms used across the platform ("passed" → "pass",
 * "approve" → "approved", …). Values are never taken from prose here — only
 * already-structured strings are normalized.
 */
export function normalizeBranchCandidate(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "passed" || normalized === "success" || normalized === "successful") return "pass";
  if (normalized === "failed" || normalized === "error" || normalized === "blocked") return "fail";
  if (normalized === "approve") return "approved";
  if (normalized === "reject" || normalized === "rejected") return "rejected";
  return normalized;
}

/**
 * Resolve a requested branch value against a condition node's declared
 * branches.
 *
 * Match order (preserving legacy input-routing behavior):
 *  1. exact match on the raw value;
 *  2. exact match on the normalized value;
 *  3. case-insensitive match — ambiguous when more than one declared key hits.
 *
 * Anything else is `unknown`, optionally routed to the explicitly declared
 * `unknownRoute`.
 */
export function resolveBranchRoute(config: BranchRouteConfig, requested: unknown): BranchRouteResolution {
  const keys = (config.branches ?? [])
    .map((branch) => (typeof branch?.key === "string" ? branch.key : ""))
    .filter((key) => key.trim().length > 0);

  let requestedText: string | undefined;
  let reason: BranchRouteReason;

  if (requested === undefined || requested === null) {
    reason = "missing";
  } else if (typeof requested !== "string") {
    reason = "type_mismatch";
  } else if (!requested.trim()) {
    reason = "malformed";
  } else {
    requestedText = requested;
    const raw = requested.trim();
    const normalized = normalizeBranchCandidate(raw);
    if (keys.includes(raw)) {
      return { status: "routed", branch: raw, reason: "resolved", requested: raw };
    }
    if (keys.includes(normalized)) {
      return { status: "routed", branch: normalized, reason: "resolved", requested: raw };
    }
    const lower = raw.toLowerCase();
    const normalizedLower = normalized.toLowerCase();
    const matches = keys.filter((key) => {
      const keyLower = key.toLowerCase();
      return keyLower === lower || keyLower === normalizedLower;
    });
    if (matches.length === 1) {
      return { status: "routed", branch: matches[0], reason: "resolved", requested: raw };
    }
    if (matches.length > 1) {
      reason = "ambiguous";
    } else {
      reason = "not_declared";
    }
  }

  const errorReason = reason === "malformed" || reason === "type_mismatch";
  const fallback = errorReason
    ? (typeof config.errorRoute === "string" ? config.errorRoute : undefined)
    : (typeof config.unknownRoute === "string" ? config.unknownRoute : undefined);
  if (fallback && keys.includes(fallback)) {
    return { status: "routed", branch: fallback, reason, requested: requestedText, ...(errorReason ? { viaErrorRoute: true } : { viaUnknownRoute: true }) };
  }
  return { status: "unknown", reason, requested: requestedText };
}
