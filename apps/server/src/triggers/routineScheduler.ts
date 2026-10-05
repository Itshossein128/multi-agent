import { nowIso, uid, type RoutineRecord, type RoutineHistoryRecord } from "@multi-agent/types";
import type { StudioStore } from "../../../../src/studio/contracts";
import { log } from "../logging";

export interface RoutineSchedulerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  claimLimit?: number;
}

/**
 * Parse interval expression like "every:30s", "every:5m", "every:2h", "every:1d", "every:120".
 */
export function parseIntervalSeconds(scheduleExpr: string): number {
  const trimmed = scheduleExpr.trim().replace(/^every:\s*/i, "");
  const match = trimmed.match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!match) {
    throw new Error(`Invalid interval schedule expression: "${scheduleExpr}". Expected format like "60s", "5m", "1h", "1d".`);
  }
  const val = parseInt(match[1], 10);
  if (val <= 0) {
    throw new Error(`Interval schedule must be at least 1 second.`);
  }
  const unit = (match[2] || "s").toLowerCase();
  let seconds = val;
  if (unit === "m") seconds = val * 60;
  else if (unit === "h") seconds = val * 3600;
  else if (unit === "d") seconds = val * 86400;
  return seconds;
}

/**
 * Computes next run timestamp for a cron expression or interval with timezone support.
 */
export function computeNextRun(
  scheduleType: "cron" | "interval",
  scheduleExpr: string,
  timezone = "UTC",
  fromDate: Date = new Date(),
): Date {
  const normalizedTz = timezone || "UTC";

  if (scheduleType === "interval") {
    const seconds = parseIntervalSeconds(scheduleExpr);
    return new Date(fromDate.getTime() + seconds * 1000);
  }

  // Cron schedule parsing (5 fields: minute hour day-of-month month day-of-week)
  const parts = scheduleExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${scheduleExpr}". Standard 5-field cron required.`);
  }

  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

  function matchesField(expr: string, value: number, minVal: number, maxVal: number): boolean {
    if (expr === "*") return true;
    const subParts = expr.split(",");
    for (const sub of subParts) {
      const stepMatch = sub.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[2], 10);
        let rangeMin = minVal;
        let rangeMax = maxVal;
        if (stepMatch[1] !== "*") {
          const [r1, r2] = stepMatch[1].split("-").map((x) => parseInt(x, 10));
          rangeMin = r1;
          rangeMax = r2 ?? r1;
        }
        if (value >= rangeMin && value <= rangeMax && (value - rangeMin) % step === 0) {
          return true;
        }
        continue;
      }
      const rangeMatch = sub.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (value >= start && value <= end) return true;
        continue;
      }
      if (parseInt(sub, 10) === value) return true;
    }
    return false;
  }

  // Helper to extract localized date components in the specified timezone
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizedTz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hour12: false,
  });

  // Advance by 1 minute from fromDate rounded to the next whole minute
  let candidate = new Date(Math.floor(fromDate.getTime() / 60_000) * 60_000 + 60_000);
  const maxIterations = 525_600; // Look ahead up to 1 full year of minutes
  let iterations = 0;

  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  while (iterations < maxIterations) {
    iterations += 1;
    const formatted = dtf.formatToParts(candidate);
    let minute = 0;
    let hour = 0;
    let day = 0;
    let month = 0;
    let dow = 0;

    for (const part of formatted) {
      if (part.type === "minute") minute = parseInt(part.value, 10);
      else if (part.type === "hour") hour = parseInt(part.value, 10) % 24;
      else if (part.type === "day") day = parseInt(part.value, 10);
      else if (part.type === "month") month = parseInt(part.value, 10);
      else if (part.type === "weekday") dow = dowMap[part.value] ?? 0;
    }

    // Cron DOW: 7 is also Sunday
    const matchesDow = matchesField(dowExpr, dow, 0, 7) || (dow === 0 && matchesField(dowExpr, 7, 0, 7));

    if (
      matchesField(minExpr, minute, 0, 59) &&
      matchesField(hourExpr, hour, 0, 23) &&
      matchesField(domExpr, day, 1, 31) &&
      matchesField(monthExpr, month, 1, 12) &&
      matchesDow
    ) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() + 60_000);
  }

  throw new Error(`Cron schedule "${scheduleExpr}" has no matching occurrences within the next year.`);
}

/**
 * Previews the next N runs for a given schedule.
 */
export function previewNextRuns(
  scheduleType: "cron" | "interval",
  scheduleExpr: string,
  timezone = "UTC",
  count = 5,
  fromDate: Date = new Date(),
): string[] {
  const previews: string[] = [];
  let current = fromDate;
  for (let i = 0; i < count; i++) {
    current = computeNextRun(scheduleType, scheduleExpr, timezone, current);
    previews.push(current.toISOString());
  }
  return previews;
}

/**
 * Periodically checks for due recurring routines, applies misfire policies,
 * records routine execution history, and enqueues trigger events.
 */
export class RoutineScheduler {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly claimLimit: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private processing = false;

  constructor(
    private readonly store: StudioStore,
    options: RoutineSchedulerOptions = {},
  ) {
    this.workerId = options.workerId ?? `routine-worker-${uid("node")}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.claimLimit = options.claimLimit ?? 5;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        if (this.running) {
          this.scheduleNextTick(this.pollIntervalMs);
        }
      });
    }, delayMs);
  }

  async tick(): Promise<RoutineRecord[]> {
    if (this.processing) return [];
    this.processing = true;

    try {
      const due = await this.store.claimDueRoutines(this.workerId, this.claimLimit);
      if (!due.length) return [];

      const processed: RoutineRecord[] = [];

      for (const routine of due) {
        try {
          const principal = { tenantId: routine.tenantId, userId: routine.ownerId };
          const scheduledAt = routine.nextRunAt ?? nowIso();
          const scheduledMs = Date.parse(scheduledAt);
          const nowMs = Date.now();
          const isMisfired = nowMs - scheduledMs > 60_000; // Over 1 minute overdue

          // Misfire policy check
          if (isMisfired && routine.misfirePolicy === "skip") {
            const nextRun = computeNextRun(
              routine.scheduleType,
              routine.scheduleExpr,
              routine.timezone,
              new Date(),
            );
            const updated = await this.store.saveRoutine(
              {
                ...routine,
                lastRunAt: scheduledAt,
                nextRunAt: nextRun.toISOString(),
                lastStatus: "skipped",
                lastError: "misfire_skip",
              },
              principal,
            );
            await this.store.recordRoutineHistory({
              id: uid("rhist"),
              tenantId: routine.tenantId,
              routineId: routine.id,
              scheduledAt,
              executedAt: nowIso(),
              status: "skipped",
              error: "misfire_skip",
              createdAt: nowIso(),
            });
            log.info("routine.misfire_skipped", {
              routineId: routine.id,
              tenantId: routine.tenantId,
              scheduledAt,
              nextRunAt: nextRun.toISOString(),
            });
            processed.push(updated);
            continue;
          }

          // Compute next future run from now (or from scheduled time if coalesce/enqueue)
          const nextRun = computeNextRun(
            routine.scheduleType,
            routine.scheduleExpr,
            routine.timezone,
            new Date(),
          );

          // Update routine schedule
          const updated = await this.store.saveRoutine(
            {
              ...routine,
              lastRunAt: nowIso(),
              nextRunAt: nextRun.toISOString(),
              lastStatus: "success",
              lastError: null,
            },
            principal,
          );

          // Record history
          await this.store.recordRoutineHistory({
            id: uid("rhist"),
            tenantId: routine.tenantId,
            routineId: routine.id,
            scheduledAt,
            executedAt: nowIso(),
            status: "success",
            createdAt: nowIso(),
          });

          // Enqueue trigger event
          await this.store.enqueueTriggerEvent({
            tenantId: routine.tenantId,
            eventType: "routine_tick",
            targetType: routine.targetType,
            targetId: routine.targetId,
            idempotencyKey: `routine:${routine.id}:${scheduledAt}`,
            payload: {
              routineId: routine.id,
              routineName: routine.name,
              input: routine.inputPayload,
              scheduledAt,
            },
          });

          log.info("routine.dispatched", {
            routineId: routine.id,
            tenantId: routine.tenantId,
            scheduledAt,
            nextRunAt: nextRun.toISOString(),
          });

          processed.push(updated);
        } catch (error) {
          log.warn("routine.failed", {
            routineId: routine.id,
            tenantId: routine.tenantId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return processed;
    } finally {
      this.processing = false;
    }
  }
}
