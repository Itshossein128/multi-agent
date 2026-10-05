import dns from "node:dns/promises";
import standardDns from "node:dns";
import net from "node:net";
import { Agent as UndiciAgent } from "undici";

export class SsrfPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfPolicyError";
  }
}

export interface SsrfValidationOptions {
  allowedHosts?: string[];
  allowPrivateIps?: boolean;
}

export interface WebhookPolicyConfig {
  enabled: boolean;
  allowedHosts: string[];
  allowPrivateIps: boolean;
  maxResponseBytes: number;
  defaultTimeoutMs: number;
}

export function webhookPolicyFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): WebhookPolicyConfig {
  const hosts = (env.WEBHOOK_AGENT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const maxBytes = Number(env.WEBHOOK_AGENT_MAX_RESPONSE_BYTES ?? 2 * 1024 * 1024);
  const timeoutMs = Number(env.WEBHOOK_AGENT_DEFAULT_TIMEOUT_MS ?? 30_000);

  return {
    enabled: env.WEBHOOK_AGENT_ENABLED === "true",
    allowedHosts: hosts,
    allowPrivateIps: env.WEBHOOK_AGENT_ALLOW_PRIVATE_IPS === "true",
    maxResponseBytes: Number.isInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 16 * 1024 * 1024 ? maxBytes : 2 * 1024 * 1024,
    defaultTimeoutMs: Number.isInteger(timeoutMs) && timeoutMs >= 500 && timeoutMs <= 300_000 ? timeoutMs : 30_000,
  };
}

/** Check whether an IPv4 address string falls into private, loopback, or reserved ranges. */
export function isForbiddenIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [b0, b1] = parts;
  // 0.0.0.0/8 - Current network
  if (b0 === 0) return true;
  // 10.0.0.0/8 - Private RFC 1918
  if (b0 === 10) return true;
  // 127.0.0.0/8 - Loopback
  if (b0 === 127) return true;
  // 100.64.0.0/10 - Carrier-grade NAT
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  // 169.254.0.0/16 - Link-local / Cloud metadata (e.g. 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;
  // 172.16.0.0/12 - Private RFC 1918
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  // 192.0.0.0/24 - IETF protocol assignments
  if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;
  // 192.0.2.0/24 - TEST-NET-1
  if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;
  // 192.168.0.0/16 - Private RFC 1918
  if (b0 === 192 && b1 === 168) return true;
  // 198.51.100.0/24 - TEST-NET-2
  if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;
  // 203.0.113.0/24 - TEST-NET-3
  if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;
  // 224.0.0.0/4 - Multicast
  if (b0 >= 224 && b0 <= 239) return true;
  // 240.0.0.0/4 - Reserved
  if (b0 >= 240) return true;

  return false;
}

/** Check whether an IPv6 address falls into loopback, unique local, link-local, or IPv4-mapped private ranges. */
export function isForbiddenIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // ::1 - Loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  // :: - Unspecified
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
  // fc00::/7 - Unique local address (ULA)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // fe80::/10 - Link-local
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  // ff00::/8 - Multicast
  if (normalized.startsWith("ff")) return true;

  // IPv4-mapped IPv6 address (::ffff:192.168.1.1 or ::ffff:c0a8:0101)
  if (normalized.includes("::ffff:")) {
    const after = normalized.split("::ffff:")[1];
    if (net.isIPv4(after)) {
      return isForbiddenIpv4(after);
    }
  }

  return false;
}

/** Check if an IP address string is forbidden. */
export function isForbiddenIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isForbiddenIpv4(ip);
  if (net.isIPv6(ip)) return isForbiddenIpv6(ip);
  return true;
}

/**
 * Validate a target URL against SSRF policy rules:
 * 1. Protocol must be http: or https:
 * 2. Hostname must be in allowedHosts (empty allowlist fails closed!)
 * 3. Pre-resolve DNS and ensure no returned IP is in a forbidden range
 */
export async function assertSafeDestinationUrl(
  rawUrl: string,
  options: SsrfValidationOptions = {},
  lookupFn: typeof dns.lookup = dns.lookup,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfPolicyError(`Destination URL "${rawUrl}" is invalid.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfPolicyError(`Destination URL protocol "${parsed.protocol}" is not permitted (only http and https).`);
  }

  if (parsed.username || parsed.password) {
    throw new SsrfPolicyError("Destination URL must not contain embedded authentication credentials.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new SsrfPolicyError("Destination URL must contain a valid hostname.");
  }

  const allowedHosts = options.allowedHosts ?? [];
  if (allowedHosts.length === 0) {
    throw new SsrfPolicyError("Webhook execution requires an explicit host allowlist (empty allowlist fails closed).");
  }

  const isAllowed = allowedHosts.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) {
      const domain = p.slice(2);
      return hostname === domain || hostname.endsWith(`.${domain}`);
    }
    return hostname === p;
  });
  if (!isAllowed) {
    throw new SsrfPolicyError(`Destination host "${hostname}" is not allowed by the server allowlist.`);
  }

  if (!options.allowPrivateIps) {
    // If hostname is directly an IP literal:
    if (net.isIP(hostname)) {
      if (isForbiddenIp(hostname)) {
        throw new SsrfPolicyError(`Destination IP "${hostname}" is a private or forbidden network destination.`);
      }
      return parsed;
    }

    // DNS pre-resolution check
    try {
      const addresses = await lookupFn(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        throw new SsrfPolicyError(`Destination host "${hostname}" could not be resolved by DNS.`);
      }
      for (const record of addresses) {
        if (isForbiddenIp(record.address)) {
          throw new SsrfPolicyError(`Destination host "${hostname}" resolved to forbidden IP "${record.address}".`);
        }
      }
    } catch (error) {
      if (error instanceof SsrfPolicyError) throw error;
      throw new SsrfPolicyError(`DNS resolution failed for destination host "${hostname}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return parsed;
}

export type DnsLookupCallback = (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void;
export type TransportDnsLookupFn = (hostname: string, options: any, callback: DnsLookupCallback) => void;

/**
 * Creates an undici Agent that pins DNS resolution at the transport layer.
 * When the TCP socket connector makes a connection, this lookup hook resolves
 * and validates that the connected IP address is non-private, completely preventing
 * DNS rebinding attacks where IP changes between pre-resolution and socket connect.
 */
export function createPinnedSsrfDispatcher(
  options: SsrfValidationOptions = {},
  customLookup?: TransportDnsLookupFn,
): UndiciAgent {
  const defaultLookup: TransportDnsLookupFn = (hostname, _opts, callback) => {
    standardDns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const addrs = Array.isArray(addresses)
        ? addresses
        : typeof addresses === "string"
        ? [{ address: addresses, family: net.isIPv4(addresses) ? 4 : 6 }]
        : [];
      callback(null, addrs);
    });
  };

  const lookupFn = customLookup ?? defaultLookup;

  return new UndiciAgent({
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 10_000,
    connect: {
      lookup: (hostname: string, opts: any, callback: (err: Error | null, addresses?: any) => void) => {
        // If hostname is an IP literal:
        if (net.isIP(hostname)) {
          if (!options.allowPrivateIps && isForbiddenIp(hostname)) {
            return callback(new SsrfPolicyError(`Blocked at connection time: IP "${hostname}" is a forbidden address.`));
          }
          const family = net.isIPv4(hostname) ? 4 : 6;
          return callback(null, [{ address: hostname, family }]);
        }

        lookupFn(hostname, opts, (err, addresses) => {
          if (err) return callback(err);
          if (!addresses || addresses.length === 0) {
            return callback(new SsrfPolicyError(`Blocked at connection time: host "${hostname}" could not be resolved.`));
          }

          if (!options.allowPrivateIps) {
            for (const addr of addresses) {
              if (isForbiddenIp(addr.address)) {
                return callback(
                  new SsrfPolicyError(`Blocked at connection time: DNS for "${hostname}" resolved to forbidden address "${addr.address}".`)
                );
              }
            }
          }

          // Pin connection to vetted addresses
          return callback(null, addresses);
        });
      },
    },
  });
}
