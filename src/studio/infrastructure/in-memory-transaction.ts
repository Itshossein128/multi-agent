import { isDeepStrictEqual } from "node:util";

type Collection = Map<string, unknown> | Set<string>;
type State = Record<string, Collection>;

// structuredClone can produce objects from another realm (for example inside Jest).
const equal = (left: unknown, right: unknown) => isDeepStrictEqual(structuredClone(left), structuredClone(right));

/** Validate every changed entry before applying any writes, preserving unrelated commits. */
export function prepareInMemoryCommit(current: State, before: State, staged: State): () => void {
  const writes: Array<() => void> = [];
  for (const name of Object.keys(before)) {
    const original = before[name];
    const draft = staged[name];
    const live = current[name];
    const value = (collection: Collection, key: string) => "get" in collection ? collection.get(key) : collection.has(key);
    for (const key of new Set([...original.keys(), ...draft.keys()])) {
      if (original.has(key) === draft.has(key) && equal(value(original, key), value(draft, key))) continue;
      if (original.has(key) !== live.has(key) || !equal(value(original, key), value(live, key))) {
        throw new Error("In-memory transaction conflict");
      }
      const present = draft.has(key);
      const next = structuredClone(value(draft, key));
      writes.push(() => {
        if (!present) live.delete(key);
        else if ("set" in live) live.set(key, next);
        else live.add(key);
      });
    }
  }
  return () => { for (const write of writes) write(); };
}
