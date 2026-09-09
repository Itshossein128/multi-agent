import { redact } from "./adapters/langGraphEventAdapter";

export type LogContext = Record<string, string | number | boolean | undefined>;

/** Compact JSON logger for server/runtime boundaries; never serializes request bodies or secrets. */
export const log = {
  info(event: string, context: LogContext = {}) { write("info", event, context); },
  warn(event: string, context: LogContext = {}) { write("warn", event, context); },
  error(event: string, context: LogContext = {}) { write("error", event, context); },
};

function write(level: "info" | "warn" | "error", event: string, context: LogContext) {
  const safeContext = redact(context) as Record<string, unknown>;
  const record = { timestamp: new Date().toISOString(), level, event, ...safeContext };
  // One line per event keeps local and hosted log collectors machine-readable.
  console[level](JSON.stringify(record));
}
