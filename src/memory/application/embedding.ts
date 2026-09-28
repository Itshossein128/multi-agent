import type { EmbeddingProvider, MemoryEmbeddingMetadata } from "../contracts";
export function validVector(vector: number[], dimensions: number): boolean {
  return Array.isArray(vector) && dimensions > 0 && vector.length === dimensions && vector.every(Number.isFinite) && vector.some(n => n !== 0);
}
export function sameEmbedding(a: MemoryEmbeddingMetadata | undefined, b: MemoryEmbeddingMetadata): boolean {
  return !!a && a.provider === b.provider && a.model === b.model && a.version === b.version && a.dimensions === b.dimensions;
}
/** A failed or slow embedding service never disables lexical memory. */
export async function embedSafely(provider: EmbeddingProvider | undefined, text: string, timeoutMs: number): Promise<number[] | undefined> {
  if (!provider) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const vector = await Promise.race([Promise.resolve().then(() => provider.embed(text)), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); })]);
    return vector && validVector(vector, provider.metadata.dimensions) ? vector : undefined;
  } catch { return undefined; }
  finally { if (timer) clearTimeout(timer); }
}

/**
 * Produces embeddable text for a memory according to the embedding metadata version.
 * Version 1 (default legacy) embeds raw content.
 * Version 2+ incorporates structured context fields (subject, trigger, title).
 */
export function embeddableMemoryText(
  memory: { content: string; subject?: string; trigger?: string; title?: string },
  version = "1"
): string {
  if (version === "1" || !version) return memory.content;
  const parts: string[] = [];
  if (memory.subject) parts.push(`Subject: ${memory.subject}`);
  if (memory.trigger) parts.push(`Trigger: ${memory.trigger}`);
  if (memory.title) parts.push(`Title: ${memory.title}`);
  parts.push(memory.content);
  return parts.join("\n");
}
