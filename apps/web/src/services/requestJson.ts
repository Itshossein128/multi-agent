/** Shared JSON-over-HTTP client for browser services. Single error contract. */

const API_URL = "/api/execution";

/**
 * Single error type for Studio/BFF requests. `status` is undefined for
 * transport-level failures (offline server, aborted request) so callers can
 * treat "genuine 404" differently from "the request itself failed".
 */
export class ApiRequestError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options?: { apiUrl?: string; fetchImpl?: typeof fetch }
): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const base = options?.apiUrl ?? API_URL;
  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    throw new ApiRequestError("The execution server could not be reached.");
  }
  if (!response.ok) {
    const serverMessage = (await response.json().catch(() => ({}))).error;
    if (response.status === 404) {
      // Status is the machine-readable "missing resource" signal; the server
      // message (when present) stays available for display.
      throw new ApiRequestError(serverMessage ?? "Resource not found", 404);
    }
    throw new ApiRequestError(
      serverMessage ?? `Execution request failed (${response.status})`,
      response.status
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
