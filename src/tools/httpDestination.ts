import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface PinnedRequestInit extends RequestInit {
  pinnedAddress?: ResolvedAddress;
}

export type DestinationResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const forbiddenAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  forbiddenAddresses.addSubnet(address, prefix, "ipv4");
}

// Only globally routable unicast IPv6 is eligible. Exclude special-use ranges
// that sit inside 2000::/3 as well.
const globalIpv6Addresses = new BlockList();
globalIpv6Addresses.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  forbiddenAddresses.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !forbiddenAddresses.check(address, "ipv4");
  if (family === 6) {
    return globalIpv6Addresses.check(address, "ipv6") && !forbiddenAddresses.check(address, "ipv6");
  }
  return false;
}

export const resolveDestination: DestinationResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function validateDestination(
  url: URL,
  resolve: DestinationResolver,
): Promise<ResolvedAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HTTP destination only permits http(s) URLs.");
  }
  if (url.username || url.password) {
    throw new Error("HTTP destination credentials are forbidden.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname);

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => !isPublicAddress(address) || isIP(address) !== family)
  ) {
    throw new Error("HTTP destination has a forbidden or unresolved address.");
  }

  return addresses[0];
}

/**
 * Performs the request without another DNS lookup. TLS still verifies the
 * certificate against the original URL hostname.
 */
export function pinnedHttpFetch(input: RequestInfo | URL, init: PinnedRequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const address = init.pinnedAddress;
  if (!address) return Promise.reject(new Error("Validated HTTP address is required."));

  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? undefined,
        agent: false,
        lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        }) as never,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            response.destroy(new Error("HTTP response exceeds size limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
          }
          const status = response.statusCode ?? 500;
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
              headers,
            }),
          );
        });
      },
    );

    request.on("error", reject);
    if (init.body !== undefined && init.body !== null) request.write(init.body);
    request.end();
  });
}
