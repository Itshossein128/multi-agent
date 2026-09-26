import type { Memory, MemoryCandidate } from "../contracts";
import { normalizeContent } from "./access";

type MemoryLike = Memory | MemoryCandidate;
export type MemoryRelationship = "duplicate" | "conflict" | "supersede" | "independent";

const VALUE_FAMILIES = [
  ["npm", "pnpm", "yarn", "bun"],
  ["postgres", "postgresql", "mysql", "sqlite", "mongodb"],
];

function normalized(text: string | undefined): string { return normalizeContent(text ?? ""); }

/** Trusted identity for an episode. Prose similarity is deliberately not identity. */
export function episodeIdentity(memory: MemoryLike): string | undefined {
  const sourceEvent = memory.metadata?.sourceEventId ?? memory.metadata?.eventId ?? memory.metadata?.extractionSourceId;
  if (typeof sourceEvent === "string" && sourceEvent.trim()) return `event:${sourceEvent.trim()}`;
  if (memory.idempotencyKey) return `idempotency:${memory.idempotencyKey}`;
  if (memory.source.runId) return `run:${memory.source.runId}`;
  return undefined;
}

export function sameEpisodeIdentity(a: MemoryLike, b: MemoryLike): boolean {
  const left = episodeIdentity(a), right = episodeIdentity(b);
  return !!left && !!right && left === right;
}

export function semanticSubjectKey(memory: MemoryLike): string | undefined {
  const subject = normalized(memory.subject);
  if (!subject) return undefined;
  for (const family of VALUE_FAMILIES) for (const value of family) {
    if (subject === value) continue;
    if (subject.endsWith(`-${value}`) || subject.endsWith(` ${value}`)) return subject.slice(0, -value.length).replace(/[- ]+$/, "");
  }
  return subject;
}

function semanticContentKey(memory: MemoryLike): string | undefined {
  if (memory.kind !== "semantic") return undefined;
  const content = normalized(memory.content);
  if (/\b(package manager|package-management|install tasks?)\b/.test(content)) return "package-manager";
  if (/\b(database|db)\b/.test(content) && /\b(backend|engine|storage)\b/.test(content)) return "database";
  return undefined;
}

export function semanticConflictKey(memory: MemoryLike): string | undefined {
  if (memory.kind !== "semantic") return undefined;
  return semanticSubjectKey(memory) ?? semanticContentKey(memory);
}

function proceduralTrigger(memory: MemoryLike): string { return normalized(memory.trigger); }
function proceduralAction(memory: MemoryLike): string { return normalized(memory.procedure ?? memory.action); }

function explicitConflict(a: MemoryLike, b: MemoryLike): boolean {
  const left = a.metadata?.conflictWithMemoryIds;
  const right = b.metadata?.conflictWithMemoryIds;
  return (Array.isArray(left) && left.includes(b.id)) || (Array.isArray(right) && right.includes(a.id));
}

function explicitSupersession(a: MemoryLike, b: MemoryLike): boolean {
  const aSupersededBy = "supersededByMemoryId" in a ? a.supersededByMemoryId : undefined;
  const bSupersededBy = "supersededByMemoryId" in b ? b.supersededByMemoryId : undefined;
  return (!!a.supersedesMemoryId && a.supersedesMemoryId === b.id)
    || (!!b.supersedesMemoryId && b.supersedesMemoryId === a.id)
    || (!!aSupersededBy && aSupersededBy === b.id)
    || (!!bSupersededBy && bSupersededBy === a.id);
}

/** Shared relationship semantics used by retrieval and consolidation. */
export function classifyMemoryRelationship(a: MemoryLike, b: MemoryLike): MemoryRelationship {
  if (a.kind !== b.kind) return "independent";
  if (explicitSupersession(a, b)) return "supersede";
  if (explicitConflict(a, b)) return "conflict";
  if (a.kind === "episodic") {
    return sameEpisodeIdentity(a, b) && normalized(a.content) === normalized(b.content) ? "duplicate" : "independent";
  }
  if (normalized(a.content) === normalized(b.content)) return "duplicate";
  if (a.kind === "procedural") {
    const sameTrigger = proceduralTrigger(a) && proceduralTrigger(a) === proceduralTrigger(b);
    if (sameTrigger && proceduralAction(a) === proceduralAction(b)) return "duplicate";
    return sameTrigger ? "conflict" : "independent";
  }
  const left = semanticConflictKey(a), right = semanticConflictKey(b);
  return left && left === right ? "conflict" : "independent";
}

export function conflictGroupKey(a: MemoryLike, b: MemoryLike): string | undefined {
  const relationship = classifyMemoryRelationship(a, b);
  if (relationship !== "conflict" && relationship !== "supersede") return undefined;
  if (a.kind === "semantic") {
    const key = semanticConflictKey(a);
    return key ? `${a.kind}|${key}` : `explicit|${[a.id, b.id].sort().join("|")}`;
  }
  if (a.kind === "procedural") {
    const trigger = proceduralTrigger(a);
    return trigger ? `${a.kind}|${trigger}` : `explicit|${[a.id, b.id].sort().join("|")}`;
  }
  return `explicit|${[a.id, b.id].sort().join("|")}`;
}
