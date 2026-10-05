import type { Memory, MemoryTemporalQuery, MemoryTemporalScope } from "../contracts";
import { RELIABILITY_KEYS } from "./memoryReliability";

export interface MemoryClock { now(): number }
export class SystemMemoryClock implements MemoryClock { now(): number { return Date.now(); } }

const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const parseIso = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const isoStart = (date: string): string => new Date(`${date}T00:00:00.000Z`).toISOString();

/** Bounded deterministic interpretation. Explicit caller input wins; no LLM parsing is used. */
export function interpretMemoryTemporalQuery(text: string, now: number, explicit?: MemoryTemporalQuery): MemoryTemporalQuery {
  if (explicit) return explicit;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (/\b(?:history|timeline|how has|when did|changes? to|changed over time|evolution)\b/.test(normalized)) return { mode: "history" };
  const asOf = normalized.match(new RegExp(`\\bas of\\s+${DATE}\\b`));
  if (asOf) return { mode: "as_of", at: isoStart(asOf[1]) };
  const before = normalized.match(new RegExp(`\\bbefore\\s+${DATE}\\b`));
  if (before) return { mode: "range", to: isoStart(before[1]) };
  const after = normalized.match(new RegExp(`\\bafter\\s+${DATE}\\b`));
  if (after) return { mode: "range", from: isoStart(after[1]) };
  const inYear = normalized.match(/\bin\s+((?:19|20)\d{2})\b/);
  if (inYear) return { mode: "as_of", at: `${inYear[1]}-01-01T00:00:00.000Z` };
  if (/\b(?:now|currently|today|at present|current)\b/.test(normalized)) return { mode: "current", at: new Date(now).toISOString() };
  return { mode: "current", at: new Date(now).toISOString() };
}

export function memoryValidity(memory: Memory): { from?: string; until?: string } {
  const metadata = memory.metadata ?? {};
  return {
    from: memory.validFrom ?? metadata[RELIABILITY_KEYS.validFrom] as string | undefined,
    until: memory.validUntil ?? metadata[RELIABILITY_KEYS.validUntil] as string | undefined,
  };
}

export function deriveTemporalScope(memory: Memory, now: number): MemoryTemporalScope {
  if (memory.kind !== "semantic") return memory.temporalScope ?? "unknown";
  const { from, until } = memoryValidity(memory);
  const start = parseIso(from), end = parseIso(until);
  if (start !== undefined && start > now) return "future";
  if (end !== undefined && end <= now) return "historical";
  if (start !== undefined || end !== undefined) return "current";
  return memory.temporalScope ?? "unknown";
}

export type TemporalDropReason = "not_yet_valid" | "no_longer_current" | "outside_as_of_time" | "unknown_validity_for_historical_query" | "outside_requested_range";
export interface TemporalSelection { match: boolean; reason?: TemporalDropReason; historicalMatch?: boolean }

/** Validity uses a half-open interval: validFrom is inclusive and validUntil is exclusive. */
export function matchesTemporalQuery(memory: Memory, query: MemoryTemporalQuery, now: number): TemporalSelection {
  if (memory.kind !== "semantic") return { match: true };
  const { from, until } = memoryValidity(memory);
  const start = parseIso(from), end = parseIso(until);
  const known = start !== undefined || end !== undefined;
  if (query.mode === "history") return { match: true, historicalMatch: known || deriveTemporalScope(memory, now) === "historical" };
  if (query.mode === "current") {
    const at = parseIso(query.at) ?? now;
    if (start !== undefined && at < start) return { match: false, reason: "not_yet_valid" };
    if (end !== undefined && at >= end) return { match: false, reason: "no_longer_current" };
    return { match: true };
  }
  if (query.mode === "as_of") {
    const at = parseIso(query.at);
    if (at === undefined) return { match: false, reason: "outside_as_of_time" };
    if (!known) {
      // Legacy historical prose with a matching explicit year remains cautiously eligible.
      const year = String(new Date(at).getUTCFullYear());
      return memory.temporalScope === "historical" || memory.content.includes(year)
        ? { match: true, historicalMatch: true }
        : { match: false, reason: "unknown_validity_for_historical_query" };
    }
    const match = (start === undefined || start <= at) && (end === undefined || at < end);
    return match ? { match: true, historicalMatch: at < now } : { match: false, reason: "outside_as_of_time" };
  }
  const rangeStart = parseIso(query.from) ?? Number.NEGATIVE_INFINITY;
  const rangeEnd = parseIso(query.to) ?? Number.POSITIVE_INFINITY;
  if (!known) return { match: false, reason: "unknown_validity_for_historical_query" };
  const factStart = start ?? Number.NEGATIVE_INFINITY;
  const factEnd = end ?? Number.POSITIVE_INFINITY;
  return factStart < rangeEnd && rangeStart < factEnd
    ? { match: true, historicalMatch: true }
    : { match: false, reason: "outside_requested_range" };
}

export function validityIntervalsOverlap(a: Memory, b: Memory): boolean {
  const av = memoryValidity(a), bv = memoryValidity(b);
  const aStart = parseIso(av.from) ?? Number.NEGATIVE_INFINITY;
  const bStart = parseIso(bv.from) ?? Number.NEGATIVE_INFINITY;
  const aEnd = parseIso(av.until) ?? Number.POSITIVE_INFINITY;
  const bEnd = parseIso(bv.until) ?? Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}

export function compareTimeline(a: Memory, b: Memory): number {
  const aStart = parseIso(memoryValidity(a).from) ?? Number.POSITIVE_INFINITY;
  const bStart = parseIso(memoryValidity(b).from) ?? Number.POSITIVE_INFINITY;
  return aStart - bStart || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

const MONTHS: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
export function extractEffectiveAt(text: string, referenceTime: number): string | undefined {
  const iso = text.match(/\b(?:starting|effective|on|from)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso) return isoStart(iso[1]);
  const named = text.match(/\b(?:starting|effective|on|from)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
  if (!named) return undefined;
  const year = named[3] ? Number(named[3]) : new Date(referenceTime).getUTCFullYear();
  const date = new Date(Date.UTC(year, MONTHS[named[1].toLowerCase()], Number(named[2])));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function extractTransition(text: string, referenceTime: number): Memory["transition"] | undefined {
  const values = text.match(/\b(?:migrated|switched|changed|moved)\s+from\s+([\w.-]+)\s+to\s+([\w.-]+)/i);
  const effectiveAt = extractEffectiveAt(text, referenceTime);
  if (!values || !effectiveAt) return undefined;
  return { oldValue: values[1].toLowerCase(), newValue: values[2].toLowerCase(), effectiveAt };
}
