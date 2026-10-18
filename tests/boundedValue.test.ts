import { boundJsonValue, boundedBytesFromEnvironment, TruncatedValue } from "../src/runtime/boundedValue";

describe("boundedValue runtime utilities", () => {
  describe("boundJsonValue", () => {
    it("returns parsed JSON when value serialized size is within maxBytes limit", () => {
      const input = { key: "value", num: 123, ok: true };
      const result = boundJsonValue(input, 1024);
      expect(result).toEqual(input);
    });

    it("truncates values exceeding byte limit and returns TruncatedValue metadata", () => {
      const longText = "a".repeat(500);
      const input = { text: longText };
      const result = boundJsonValue(input, 200) as TruncatedValue;

      expect(result).toBeDefined();
      expect(result.truncated).toBe(true);
      expect(result.originalBytes).toBeGreaterThan(500);
      expect(typeof result.preview).toBe("string");
      expect(result.preview).toContain("…[truncated]");
    });

    it("handles UTF-8 multibyte characters cleanly during truncation without trailing replacement chars", () => {
      // 🌟 is a 4-byte UTF-8 character
      const emojiString = "🌟".repeat(100);
      const input = { emoji: emojiString };
      const result = boundJsonValue(input, 150) as TruncatedValue;

      expect(result.truncated).toBe(true);
      expect(result.preview).not.toContain("\uFFFD");
      expect(result.preview.endsWith("…[truncated]")).toBe(true);
    });

    it("handles unserializable objects such as circular references", () => {
      const circular: Record<string, unknown> = { name: "test" };
      circular.self = circular;

      const result = boundJsonValue(circular, 1024);
      expect(result).toEqual({ unserializable: true, preview: "[object Object]" });
    });

    it("handles BigInt values that throw on JSON.stringify", () => {
      const input = { big: 9007199254740991n };
      const result = boundJsonValue(input, 1024);
      expect(result).toEqual({ unserializable: true, preview: "[object Object]" });
    });

    it("handles undefined input safely", () => {
      const result = boundJsonValue(undefined, 1024);
      expect(result).toEqual({ value: "undefined" });
    });

    it("returns empty string preview when budget is zero or negative", () => {
      const result = boundJsonValue({ data: "hello world" }, 10) as TruncatedValue;
      expect(result.truncated).toBe(true);
      expect(result.preview).toBe("");
    });
  });

  describe("boundedBytesFromEnvironment", () => {
    it("returns parsed integer when environment variable is valid and within bounds", () => {
      expect(boundedBytesFromEnvironment("2048", 1024, 1024, 1048576)).toBe(2048);
    });

    it("returns fallback when value is undefined", () => {
      expect(boundedBytesFromEnvironment(undefined, 4096, 1024, 1048576)).toBe(4096);
    });

    it("returns fallback when value is not a valid integer string", () => {
      expect(boundedBytesFromEnvironment("invalid_number", 4096)).toBe(4096);
      expect(boundedBytesFromEnvironment("1024.5", 4096)).toBe(4096);
    });

    it("returns fallback when parsed integer is below minimum limit", () => {
      expect(boundedBytesFromEnvironment("500", 4096, 1024, 1048576)).toBe(4096);
    });

    it("returns fallback when parsed integer is above maximum limit", () => {
      expect(boundedBytesFromEnvironment("20000000", 4096, 1024, 1048576)).toBe(4096);
    });
  });
});
