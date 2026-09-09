import type { Memory, MemoryNamespace, MemoryStore, MemoryStoreQuery } from "../contracts";
/** Structural node-postgres compatible boundary; infrastructure owns no driver dependency. */
export interface PgQueryable {
    query(text: string, values?: any[]): Promise<{
        rows: any[];
        rowCount: number | null;
    }>;
}
export interface PgClient extends PgQueryable {
    release(): void;
}
export interface PgPool extends PgQueryable {
    connect(): Promise<PgClient>;
}
export interface PostgresMemoryStoreOptions {
    vectorEnabled?: boolean;
}
export declare class PostgresMemoryStore implements MemoryStore {
    private readonly pool;
    private readonly options;
    private readonly client?;
    private active;
    constructor(pool: PgPool, options?: PostgresMemoryStoreOptions, client?: PgClient | undefined);
    private query;
    transaction<T>(key: string, operation: (store: MemoryStore) => Promise<T>): Promise<T>;
    insert(memory: Memory): Promise<void>;
    update(memory: Memory, expectedVersion: number): Promise<void>;
    get(tenantId: string, id: string): Promise<Memory | null>;
    delete(tenantId: string, id: string): Promise<void>;
    search(query: MemoryStoreQuery): Promise<Memory[]>;
    deleteNamespace(tenantId: string, namespace: MemoryNamespace): Promise<number>;
    deleteExpired(tenantId: string, namespace: MemoryNamespace, before?: Date, limit?: number): Promise<number>;
}
