import {
  bounds,
  contains,
  cosine,
  validateEmbedding,
  validateMemory,
  validateScope,
  MAX_MEMORY_CANDIDATES,
  MemoryVersionConflictError,
  MemoryDuplicateError,
} from "../src/memory/infrastructure/storage-utils";
import { MemoryValidationError } from "../src/memory/contracts";
import type { Memory } from "../src/memory/contracts";

describe("storage-utils", () => {
  describe("bounds()", () => {
    describe("happy paths", () => {
      test("returns valid limit and offset when provided valid inputs", () => {
        expect(bounds({ limit: 10, offset: 5 })).toEqual({ limit: 10, offset: 5 });
      });

      test("defaults offset to 0 when offset is undefined or null (coalesced via ??)", () => {
        expect(bounds({ limit: 20 })).toEqual({ limit: 20, offset: 0 });
        expect(bounds({ limit: 20, offset: undefined })).toEqual({ limit: 20, offset: 0 });
        expect(bounds({ limit: 20, offset: null as any })).toEqual({ limit: 20, offset: 0 });
      });

      test("caps limit at MAX_MEMORY_CANDIDATES (500) when limit exceeds it", () => {
        expect(bounds({ limit: 1000, offset: 0 })).toEqual({
          limit: MAX_MEMORY_CANDIDATES,
          offset: 0,
        });
        expect(bounds({ limit: 500 })).toEqual({
          limit: 500,
          offset: 0,
        });
      });

      test("accepts boundary minimum valid limit (1) and offset (0)", () => {
        expect(bounds({ limit: 1, offset: 0 })).toEqual({ limit: 1, offset: 0 });
      });
    });

    describe("edge cases & invalid inputs", () => {
      test.each([
        ["limit = 0", { limit: 0 }],
        ["negative limit", { limit: -1 }],
        ["float limit", { limit: 1.5 }],
        ["NaN limit", { limit: NaN }],
        ["Infinity limit", { limit: Infinity }],
        ["-Infinity limit", { limit: -Infinity }],
        ["undefined limit", { limit: undefined as any }],
        ["null limit", { limit: null as any }],
        ["string limit", { limit: "10" as any }],
      ])("throws MemoryValidationError for invalid limit: %s", (_, input) => {
        expect(() => bounds(input)).toThrow(MemoryValidationError);
        expect(() => bounds(input)).toThrow("Invalid memory search bounds");
      });

      test.each([
        ["negative offset", { limit: 10, offset: -1 }],
        ["float offset", { limit: 10, offset: 0.5 }],
        ["NaN offset", { limit: 10, offset: NaN }],
        ["Infinity offset", { limit: 10, offset: Infinity }],
        ["-Infinity offset", { limit: 10, offset: -Infinity }],
        ["string offset", { limit: 10, offset: "5" as any }],
      ])("throws MemoryValidationError for invalid offset: %s", (_, input) => {
        expect(() => bounds(input)).toThrow(MemoryValidationError);
        expect(() => bounds(input)).toThrow("Invalid memory search bounds");
      });
    });
  });

  describe("contains()", () => {
    test("matches scalar values", () => {
      expect(contains("hello", "hello")).toBe(true);
      expect(contains(123, 123)).toBe(true);
      expect(contains(true, true)).toBe(true);
      expect(contains("hello", "world")).toBe(false);
      expect(contains(123, 456)).toBe(false);
    });

    test("matches JSON object containment", () => {
      const value = { a: 1, b: { c: "test", d: true }, e: [1, 2, 3] };
      expect(contains(value, { a: 1 })).toBe(true);
      expect(contains(value, { b: { c: "test" } })).toBe(true);
      expect(contains(value, { a: 2 })).toBe(false);
      expect(contains(value, { nonExistent: 1 })).toBe(false);
    });

    test("handles null, undefined, and primitive filters/values", () => {
      expect(contains(null, { a: 1 })).toBe(false);
      expect(contains(undefined, { a: 1 })).toBe(false);
      expect(contains({ a: 1 }, null)).toBe(false);
      expect(contains(null, null)).toBe(true);
      expect(contains(undefined, undefined)).toBe(true);
      expect(contains("string", { a: 1 })).toBe(false);
      expect(contains(123, { a: 1 })).toBe(false);
    });

    test("handles empty object filters and empty values", () => {
      expect(contains({ a: 1 }, {})).toBe(true);
      expect(contains({}, {})).toBe(true);
      expect(contains({}, { a: 1 })).toBe(false);
    });

    test("matches array containment", () => {
      expect(contains([1, 2, 3], [1, 2])).toBe(true);
      expect(contains([1, 2, 3], [4])).toBe(false);
      expect(contains([{ id: 1 }, { id: 2 }], [{ id: 1 }])).toBe(true);
      expect(contains([{ id: 1 }], [{ id: 2 }])).toBe(false);
      expect(contains("not-an-array", [1])).toBe(false);
    });
  });

  describe("validateScope()", () => {
    const validNamespace = { scope: "user" as const, id: "u1" };

    test("accepts valid tenantId and namespaces", () => {
      expect(() => validateScope("tenant-1", [validNamespace])).not.toThrow();
      expect(() => validateScope("tenant-1", [])).not.toThrow();
    });

    test("throws MemoryValidationError for invalid tenantId", () => {
      expect(() => validateScope("", [validNamespace])).toThrow("Memory tenant and exact namespaces are required");
      expect(() => validateScope("   ", [validNamespace])).toThrow(MemoryValidationError);
      expect(() => validateScope(null as any, [validNamespace])).toThrow(MemoryValidationError);
      expect(() => validateScope(123 as any, [validNamespace])).toThrow(MemoryValidationError);
    });

    test("throws MemoryValidationError for invalid namespaces", () => {
      expect(() => validateScope("tenant-1", null as any)).toThrow("Memory tenant and exact namespaces are required");
      expect(() => validateScope("tenant-1", ["invalid" as any])).toThrow(MemoryValidationError);
      expect(() => validateScope("tenant-1", [{ scope: "invalid", id: "1" } as any])).toThrow(MemoryValidationError);
    });
  });

  describe("validateEmbedding()", () => {
    const metadata = { dimensions: 3, model: "m1", provider: "p1", version: "1" };

    test("returns early when vector is missing or undefined", () => {
      expect(() => validateEmbedding(undefined, metadata)).not.toThrow();
    });

    test("accepts valid non-zero finite vector matching metadata dimensions", () => {
      expect(() => validateEmbedding([0.1, 0.2, 0.3], metadata)).not.toThrow();
    });

    test("throws MemoryValidationError when metadata is missing", () => {
      expect(() => validateEmbedding([0.1, 0.2, 0.3], undefined)).toThrow("Invalid memory embedding or metadata");
    });

    test("throws MemoryValidationError when dimension mismatches or vector empty", () => {
      expect(() => validateEmbedding([0.1, 0.2], metadata)).toThrow(MemoryValidationError);
      expect(() => validateEmbedding([], metadata)).toThrow(MemoryValidationError);
    });

    test("throws MemoryValidationError when vector contains non-finite numbers", () => {
      expect(() => validateEmbedding([0.1, NaN, 0.3], metadata)).toThrow(MemoryValidationError);
      expect(() => validateEmbedding([0.1, Infinity, 0.3], metadata)).toThrow(MemoryValidationError);
    });

    test("throws MemoryValidationError when vector is all zeros", () => {
      expect(() => validateEmbedding([0, 0, 0], metadata)).toThrow(MemoryValidationError);
    });
  });

  describe("validateMemory()", () => {
    const validMemory: Memory = {
      id: "mem-1",
      tenantId: "tenant-1",
      namespace: { scope: "user", id: "u1" },
      kind: "semantic",
      visibility: "private",
      content: "test content",
      importance: 0.5,
      source: { type: "system" },
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentHash: "hash1",
      version: 1,
    };

    test("accepts valid memory object", () => {
      expect(() => validateMemory(validMemory)).not.toThrow();
    });

    test("throws MemoryValidationError for missing id or invalid version", () => {
      expect(() => validateMemory({ ...validMemory, id: "" })).toThrow("Invalid memory identity or version");
      expect(() => validateMemory({ ...validMemory, version: 0 })).toThrow("Invalid memory identity or version");
      expect(() => validateMemory({ ...validMemory, version: -1 })).toThrow(MemoryValidationError);
      expect(() => validateMemory({ ...validMemory, version: 1.5 })).toThrow(MemoryValidationError);
      expect(() => validateMemory({ ...validMemory, version: NaN })).toThrow(MemoryValidationError);
    });

    test("validates embedded vector via validateEmbedding", () => {
      const memoryWithInvalidEmbedding: Memory = {
        ...validMemory,
        embedding: [0, 0, 0],
        embeddingMetadata: { dimensions: 3, model: "m1", provider: "p1", version: "1" },
      };
      expect(() => validateMemory(memoryWithInvalidEmbedding)).toThrow("Invalid memory embedding or metadata");
    });
  });

  describe("cosine()", () => {
    test("calculates cosine similarity correctly", () => {
      expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
      expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
      expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    });
  });

  describe("Custom Conflict Errors", () => {
    test("instantiates error classes with correct names and default messages", () => {
      const versionErr = new MemoryVersionConflictError();
      expect(versionErr.name).toBe("MemoryVersionConflictError");
      expect(versionErr.message).toBe("Memory version conflict or record not found");

      const dupErr = new MemoryDuplicateError();
      expect(dupErr.name).toBe("MemoryDuplicateError");
      expect(dupErr.message).toBe("Memory identity or idempotency key already exists");
    });
  });
});
