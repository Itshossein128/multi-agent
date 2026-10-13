import type { Memory, MemoryKind, MemoryNamespace, MemoryRetrievalResult } from "@multi-agent/types";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? "http://localhost:4000";

export type MemoryAuthContext = { orgSlug?: string; token?: string } | string;

function resolveAuth(auth: MemoryAuthContext): { isOrgSlug: boolean; target: string } {
  if (typeof auth === "object" && auth !== null) {
    if (auth.orgSlug) return { isOrgSlug: true, target: auth.orgSlug };
    if (auth.token) return { isOrgSlug: false, target: auth.token };
  }
  const str = String(auth ?? "").trim();
  if (str.startsWith("Bearer ")) {
    return { isOrgSlug: false, target: str };
  }
  const isSlug = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(str) && !str.startsWith("sk-") && !str.startsWith("token-");
  return { isOrgSlug: isSlug, target: str };
}

async function request<T>(auth: MemoryAuthContext, path: string, init?: RequestInit): Promise<T> {
  const { isOrgSlug, target } = resolveAuth(auth);
  const url = isOrgSlug
    ? `/api/o/${encodeURIComponent(target)}/execution${path}`
    : `${API_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (!isOrgSlug && target) {
    headers["Authorization"] = target.startsWith("Bearer ") ? target : `Bearer ${target}`;
  }
  const response = await fetch(url, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Memory request failed (${response.status})`);
  return body as T;
}

export const memoryService = {
  listMemories(auth: MemoryAuthContext, namespace: MemoryNamespace, options?: { kind?: MemoryKind; limit?: number; offset?: number }) {
    const params = new URLSearchParams({ scope: namespace.scope, namespaceId: namespace.id });
    if (options?.kind) params.set("kind", options.kind);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    return request<Memory[]>(auth, `/memories?${params}`);
  },
  searchMemories(auth: MemoryAuthContext, namespace: MemoryNamespace, text: string, kinds?: MemoryKind[]) {
    return request<MemoryRetrievalResult>(auth, "/memories/search", { method: "POST", body: JSON.stringify({ text, namespaces: [namespace], kinds }) });
  },
  getMemory(auth: MemoryAuthContext, id: string) { return request<Memory>(auth, `/memories/${encodeURIComponent(id)}`); },
  deleteMemory(auth: MemoryAuthContext, id: string) { return request<void>(auth, `/memories/${encodeURIComponent(id)}`, { method: "DELETE" }); },
};
