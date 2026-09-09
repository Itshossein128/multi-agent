import type { Memory, MemoryKind, MemoryNamespace, MemoryRetrievalResult } from "@multi-agent/types";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? "http://localhost:4000";

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Memory request failed (${response.status})`);
  return body as T;
}

export const memoryService = {
  listMemories(token: string, namespace: MemoryNamespace, options?: { kind?: MemoryKind; limit?: number; offset?: number }) {
    const params = new URLSearchParams({ scope: namespace.scope, namespaceId: namespace.id });
    if (options?.kind) params.set("kind", options.kind);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    return request<Memory[]>(token, `/memories?${params}`);
  },
  searchMemories(token: string, namespace: MemoryNamespace, text: string, kinds?: MemoryKind[]) {
    return request<MemoryRetrievalResult>(token, "/memories/search", { method: "POST", body: JSON.stringify({ text, namespaces: [namespace], kinds }) });
  },
  getMemory(token: string, id: string) { return request<Memory>(token, `/memories/${encodeURIComponent(id)}`); },
  deleteMemory(token: string, id: string) { return request<void>(token, `/memories/${encodeURIComponent(id)}`, { method: "DELETE" }); },
};
