/** Shared JSON-over-HTTP client for browser services. Single error contract. */

const API_URL = "/api/execution";

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options?: { apiUrl?: string; fetchImpl?: typeof fetch }
): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const base = options?.apiUrl ?? API_URL;
  const response = await fetchImpl(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => ({}))).error ??
        `Execution request failed (${response.status})`
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
