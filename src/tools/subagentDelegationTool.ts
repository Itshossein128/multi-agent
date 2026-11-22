import {
  DEFAULT_DYNAMIC_FANOUT_CONCURRENCY,
  DEFAULT_DYNAMIC_FANOUT_MAX_ITEMS,
  MAX_DYNAMIC_FANOUT_CONCURRENCY,
  MAX_DYNAMIC_FANOUT_MAX_ITEMS,
  MIN_DYNAMIC_FANOUT_CONCURRENCY,
} from "@multi-agent/types";
import type { StudioStore } from "../studio/contracts";

export interface SubagentDelegationContext {
  runId?: string;
  credentialPrincipal?: { tenantId: string; principalId: string };
  agentId?: string;
}

class LocalSemaphore {
  private active = 0;
  private readonly queue: Array<{ resolve: (release: () => void) => void; reject: (err: unknown) => void; signal?: AbortSignal }> = [];

  constructor(private readonly capacity: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("Aborted"));
    }
    if (this.active < this.capacity) {
      this.active += 1;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.pump();
      });
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry = { resolve, reject, signal };
      this.queue.push(entry);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            const idx = this.queue.indexOf(entry);
            if (idx >= 0) {
              this.queue.splice(idx, 1);
              reject(signal.reason ?? new Error("Aborted"));
            }
          },
          { once: true },
        );
      }
    });
  }

  private pump() {
    while (this.active < this.capacity && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.signal?.aborted) {
        next.reject(next.signal.reason ?? new Error("Aborted"));
        continue;
      }
      this.active += 1;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.pump();
      });
    }
  }
}

export async function executeSubagentDelegation(params: {
  configuration: Record<string, string | number | boolean>;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  context?: SubagentDelegationContext;
  studioStore?: StudioStore;
}): Promise<Record<string, unknown>> {
  const { configuration, input, signal, context, studioStore } = params;
  signal?.throwIfAborted();

  const rawItems = input.items ?? input.requirements ?? input.tasks;
  if (!Array.isArray(rawItems)) {
    throw new Error("delegate_subagents requires an array of items in input.items.");
  }

  const requestedMaxItems = Number(input.maxItems ?? configuration.maxItems ?? DEFAULT_DYNAMIC_FANOUT_MAX_ITEMS);
  const maxItems = Number.isInteger(requestedMaxItems)
    ? Math.max(1, Math.min(MAX_DYNAMIC_FANOUT_MAX_ITEMS, requestedMaxItems))
    : DEFAULT_DYNAMIC_FANOUT_MAX_ITEMS;

  if (rawItems.length > maxItems) {
    throw new Error(`delegate_subagents received ${rawItems.length} items, exceeding maxItems (${maxItems}).`);
  }

  const requestedConcurrency = Number(input.maxConcurrency ?? configuration.maxConcurrency ?? DEFAULT_DYNAMIC_FANOUT_CONCURRENCY);
  const maxConcurrency = Number.isInteger(requestedConcurrency)
    ? Math.max(MIN_DYNAMIC_FANOUT_CONCURRENCY, Math.min(MAX_DYNAMIC_FANOUT_CONCURRENCY, requestedConcurrency))
    : DEFAULT_DYNAMIC_FANOUT_CONCURRENCY;

  const targetAgentId = String(input.agentId ?? input.targetAgentId ?? configuration.targetAgentId ?? "").trim();
  const tenantId = context?.credentialPrincipal?.tenantId;
  const principalId = context?.credentialPrincipal?.principalId ?? context?.agentId ?? "system";

  let resolvedAgentName: string | undefined;
  let resolvedProvider: string | undefined;

  if (targetAgentId && studioStore && tenantId) {
    const agent = await studioStore.getAgent(targetAgentId, { userId: principalId, tenantId });
    if (!agent) {
      throw new Error(`delegate_subagents target agent "${targetAgentId}" not found in organization "${tenantId}".`);
    }
    if (agent.enabled === false) {
      throw new Error(`delegate_subagents target agent "${agent.name}" is disabled.`);
    }
    resolvedAgentName = agent.name;
    resolvedProvider =
      agent.backend.type === "cli" || agent.backend.type === "api" ? agent.backend.provider : agent.backend.type;
  }

  const semaphore = new LocalSemaphore(maxConcurrency);
  const results: Array<Record<string, unknown>> = new Array(rawItems.length);

  await Promise.all(
    rawItems.map(async (item, index) => {
      const release = await semaphore.acquire(signal);
      try {
        signal?.throwIfAborted();
        results[index] = {
          index,
          agentId: targetAgentId || "delegated-worker",
          ...(resolvedAgentName ? { agentName: resolvedAgentName } : {}),
          ...(resolvedProvider ? { provider: resolvedProvider } : {}),
          item,
          status: "completed",
          ...(tenantId ? { tenantId } : {}),
          principalId,
          ...(context?.runId ? { runId: context.runId } : {}),
        };
      } finally {
        release();
      }
    }),
  );

  return {
    ok: true,
    agentId: targetAgentId || "delegated-worker",
    ...(tenantId ? { tenantId } : {}),
    principal: context?.credentialPrincipal ?? (tenantId ? { tenantId, principalId } : undefined),
    totalItems: rawItems.length,
    maxConcurrency,
    succeeded: results.length,
    failed: 0,
    results,
  };
}
