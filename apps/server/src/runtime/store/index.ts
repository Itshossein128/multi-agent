export type { RunStoreContract, RunEntry, RunListFilters, MemoryOwner } from "./contracts";
export { InMemoryRunStore } from "./inMemoryRunStore";
export { PostgresRunStore } from "./postgresRunStore";

// Back-compat alias: consumers that import { RunStore } from "./runStore"
// should continue to work.
import { InMemoryRunStore } from "./inMemoryRunStore";
export class RunStore extends InMemoryRunStore {}
