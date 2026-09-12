import { isMemoryNamespace, type Memory, type MemoryKind, type MemoryNamespace, type MemoryRetrievalQuery, type RememberMemoryInput } from "@multi-agent/types";
import { MemoryValidationError, type MemoryAccessContext, type MemoryService, type UpdateMemoryInput } from "../../../../../src/memory/contracts";

function visible(memory: Memory) {
  const { embedding, contentHash, tenantId, ...result } = memory;
  void embedding; void contentHash; void tenantId;
  return result;
}

function namespaceFromUrl(url: URL): MemoryNamespace {
  const namespace = { scope: url.searchParams.get("scope"), id: url.searchParams.get("namespaceId") };
  if (!isMemoryNamespace(namespace)) throw new MemoryValidationError("A valid scope and namespaceId are required.");
  return namespace;
}

function integer(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new MemoryValidationError("Invalid pagination value.");
  return parsed;
}

export class MemoryApiService {
  constructor(private readonly memory: MemoryService) {}

  async list(url: URL, access: MemoryAccessContext) {
    const kind = url.searchParams.get("kind");
    if (kind && !["semantic", "episodic", "procedural"].includes(kind)) throw new MemoryValidationError("Invalid memory kind.");
    const result = await this.memory.list({ namespaces: [namespaceFromUrl(url)], limit: integer(url.searchParams.get("limit"), 50, 1, 100),
      offset: integer(url.searchParams.get("offset"), 0, 0, 100000), kinds: kind ? [kind as MemoryKind] : undefined }, access);
    return result.map(visible);
  }

  async search(query: MemoryRetrievalQuery, access: MemoryAccessContext) {
    if (!query || typeof query.text !== "string" || query.text.length > 16000 || !Array.isArray(query.namespaces) || !query.namespaces.length
      || query.namespaces.length > 20 || !query.namespaces.every(isMemoryNamespace)) {
      throw new MemoryValidationError("Search requires text and explicit valid namespaces.");
    }
    const result = await this.memory.recall(query, access);
    return { ...result, results: result.results.map((item) => ({ ...item, memory: visible(item.memory) })) };
  }

  async remember(input: RememberMemoryInput, access: MemoryAccessContext) {
    if (!input || !isMemoryNamespace(input.namespace)) throw new MemoryValidationError("Memory namespace is required.");
    const result = await this.memory.remember(input, access);
    return { action: result.action, body: { ...result, memory: visible(result.memory) } };
  }

  async get(id: string, access: MemoryAccessContext) {
    const memory = await this.memory.get(id, access);
    return memory ? visible(memory) : null;
  }

  async update(id: string, patch: UpdateMemoryInput, access: MemoryAccessContext) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new MemoryValidationError("Memory patch must be an object.");
    return visible(await this.memory.update(id, patch, access));
  }

  forget(id: string, access: MemoryAccessContext) { return this.memory.forget(id, access); }
}
