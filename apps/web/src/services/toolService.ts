import type { ToolRecord } from "@multi-agent/types";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Execution request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const toolService = {
  testTool(tool: ToolRecord, input: Record<string, unknown>) {
    return request<{ output: Record<string, unknown> }>("/tools/test", { method: "POST", body: JSON.stringify({ tool, input }) });
  },
};
