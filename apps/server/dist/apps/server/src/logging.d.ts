export type LogContext = Record<string, string | number | boolean | undefined>;
/** Compact JSON logger for server/runtime boundaries; never serializes request bodies or secrets. */
export declare const log: {
    info(event: string, context?: LogContext): void;
    warn(event: string, context?: LogContext): void;
    error(event: string, context?: LogContext): void;
};
