"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeGuardrailsFromEnvironment = runtimeGuardrailsFromEnvironment;
/** Server-owned bounds. Browser-supplied workflows never control these limits. */
function runtimeGuardrailsFromEnvironment(env = process.env) {
    return {
        maxNodes: bounded(env.WORKFLOW_MAX_NODES, 100, 1, 1_000),
        maxEdges: bounded(env.WORKFLOW_MAX_EDGES, 250, 1, 5_000),
        maxBranches: bounded(env.WORKFLOW_MAX_BRANCHES, 25, 1, 100),
        maxRunDurationMs: bounded(env.RUN_MAX_DURATION_MS, 15 * 60_000, 1_000, 24 * 60 * 60_000),
        recursionLimit: bounded(env.WORKFLOW_RECURSION_LIMIT, 100, 10, 10_000),
    };
}
function bounded(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
//# sourceMappingURL=guardrails.js.map