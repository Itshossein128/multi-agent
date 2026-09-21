export interface TruncatedValue {
  truncated: true;
  originalBytes: number;
  preview: string;
}

/** Keep arbitrary runtime values JSON-safe and below a UTF-8 byte ceiling. */
export function boundJsonValue(value: unknown, maxBytes: number): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = JSON.stringify({ unserializable: true, preview: String(value) });
  }
  if (serialized === undefined) serialized = JSON.stringify({ value: String(value) });
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxBytes) {
    try { return JSON.parse(serialized); } catch { return value; }
  }
  const markerBudget = Math.max(0, maxBytes - 128);
  return {
    truncated: true,
    originalBytes: bytes,
    preview: truncateUtf8(serialized, markerBudget),
  } satisfies TruncatedValue;
}

export function boundedBytesFromEnvironment(value: string | undefined, fallback: number, minimum = 1_024, maximum = 10 * 1024 * 1024): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, "") + "…[truncated]";
}
