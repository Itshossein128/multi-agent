import type { StudioStore } from "../../../../src/studio/contracts";
import type { PgPool } from "../../../../src/memory/infrastructure";
export interface StudioComposition {
    store?: StudioStore;
    pool?: PgPool & {
        end(): Promise<void>;
    };
    mode: "postgres" | "in-memory" | "disabled";
    close(): Promise<void>;
}
/** No migrations at startup; durable storage never silently falls back to a Map. */
export declare function createStudioComposition(): StudioComposition;
