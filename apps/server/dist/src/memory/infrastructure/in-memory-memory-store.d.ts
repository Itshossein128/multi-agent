import type { Memory, MemoryNamespace, MemoryStore, MemoryStoreQuery } from "../contracts";
/** Test adapter: all public operations share a mutex, including writes outside transactions. */
export declare class InMemoryMemoryStore implements MemoryStore {
    private readonly now;
    private readonly transactional;
    private records;
    private tail;
    private active;
    constructor(now?: () => Date, transactional?: boolean);
    private run;
    transaction<T>(_key: string, operation: (store: MemoryStore) => Promise<T>): Promise<T>;
    private key;
    private unique;
    insert(memory: Memory): Promise<void>;
    update(memory: Memory, expectedVersion: number): Promise<void>;
    get(tenantId: string, id: string): Promise<Memory | null>;
    delete(tenantId: string, id: string): Promise<void>;
    search(query: MemoryStoreQuery): Promise<Memory[]>;
    deleteNamespace(tenantId: string, namespace: MemoryNamespace): Promise<number>;
    deleteExpired(tenantId: string, namespace: MemoryNamespace, before?: Date, limit?: number): Promise<number>;
}
