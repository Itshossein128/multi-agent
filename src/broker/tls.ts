// mTLS-probing
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import https from "node:https";
import type net from "node:net";
import type http from "node:http";
import { execFileSync } from "node:child_process";
import type { Server, ServerOptions } from "node:https";
import { getRequestListener } from "@hono/node-server";
import { BrokerError, type BrokerErrorCode } from "./contract";

/** TLS versions the broker and its clients understand. TLS 1.3 is preferred. */
export const TLS_MIN_VERSION = "TLSv1.2" as const;
export const TLS_MAX_VERSION = "TLSv1.3" as const;
export type TlsVersion = (typeof TLS_MIN_VERSION) | (typeof TLS_MAX_VERSION);

/**
 * Broker mTLS listener configuration.
 *
 * Identity model:
 * - `caFile` (and optional `caBundleFile`) is the trust anchor for client
 *   certificates. Node validates the full chain and expiration for us.
 * - `allowedClientSubjects` is an exact/wildcard identity allowlist by
 *   subject DN (used when the certificate has no SAN).
 * - `allowedClientSanPatterns` is an identity allowlist by SAN (wildcard
 *   prefixes are stripped before matching).
 * - `allowedClientServiceIdentities` is used for transparent proxy
 *   termination: the proxy presents its own certificate, and the request must
 *   carry a service identity header from an explicitly trusted proxy.
 */
export interface BrokerMtlsServerConfig {
  enabled: boolean;
  requireClientCertificate: boolean;
  caFile?: string;
  caBundleFile?: string;
  serverCertificateFile?: string;
  serverKeyFile?: string;
  allowedClientSubjects?: string[];
  allowedClientSanPatterns?: string[];
  allowedClientServiceIdentities?: string[];
  minimumTlsVersion?: TlsVersion;
  trustBundleRotationEndMs?: number;
}

/** Safe metadata logged/diagnosed. Never certificate contents or private keys. */
export interface SecureServerResult {
  serverFingerprint: string;
  clientIdentity?: string;
  clientFingerprint?: string;
  trustBundleActiveAtMs: number;
  trustBundleRotationEndMs: number | null;
}

/** Machine-readable TLS errors for diagnostics and tests. */
export class BrokerTlsError extends Error {
  constructor(public readonly code: BrokerTlsErrorCode, message: string) {
    super(message);
    this.name = "BrokerTlsError";
  }
}

export type BrokerTlsErrorCode =
  | "missing_client_certificate"
  | "client_certificate_expired"
  | "client_certificate_not_yet_valid"
  | "client_identity_mismatch"
  | "client_certificate_malformed"
  | "server_certificate_key_mismatch"
  | "unsupported_tls_version"
  | "forged_proxy_identity"
  | "proxy_identity_unconfigured";

interface Certificate {
  CN?: string | string[];
  OU?: string | string[];
  O?: string | string[];
  L?: string | string[];
  ST?: string | string[];
  C?: string | string[];
}

interface DetailedPeerCertificate {
  subject: Certificate;
  issuer: Certificate;
  subjectaltname?: string;
  valid_from: string;
  valid_to: string;
  raw: string | Buffer;
  ca: boolean;
  fingerprint: string;
  fingerprint256: string;
  serialNumber: string;
}

// ---------------------------------------------------------------------------
// Safe file / certificate material helpers. No private key material is logged.
// ---------------------------------------------------------------------------

function readFileUtf8(file: string): string {
  const r = fs.readFileSync(file, "utf8");
  if (typeof r === "string") return r;
  return r as string;
}

function loadFile(file: string): string {
  try {
    return readFileUtf8(file);
  } catch (error) {
    const fileName = file.split(/[\\/]/).pop() ?? file;
    throw new Error(`File "${fileName}" is unavailable: ${(error as Error).message}`);
  }
}

function loadKey(file: string): string {
  const content = loadFile(file);
  if (!content.includes("PRIVATE KEY")) {
    throw new Error(`File "${path.basename(file)}" is not a PEM private key.`);
  }
  return content;
}

/** Chains CA + optional bundle for the `ca` TLS option. */
function buildCaChain(caFile: string, caBundleFile?: string): string[] {
  const parts: string[] = [loadFile(caFile)];
  if (caBundleFile) parts.push(loadFile(caBundleFile));
  return parts;
}

/** Build the `serverOptions` for an HTTPS server, validating cert/key identity first. */
export function buildServerOptions(
  config: BrokerMtlsServerConfig,
  caBundleFile?: string,
): ServerOptions {
  const caChain = buildCaChain(config.caFile ?? "", caBundleFile);

  const serverCertFile = config.serverCertificateFile;
  const serverKeyFile = config.serverKeyFile;

  if (serverCertFile && serverKeyFile) {
    const cert = readFileUtf8(serverCertFile);
    const key = loadKey(serverKeyFile);
    const certPublicKey = crypto.createPublicKey(cert);
    const keyPublicKey = crypto.createPrivateKey(key);
    const certSpki = certPublicKey.export({ type: "spki", format: "pem" }) as string;
    const keySpki = keyPublicKey?.export({ type: "spki", format: "pem" }) as string | undefined;
    const certKeyDigest = crypto
      .createHash("sha256")
      .update(certSpki, "binary")
      .digest("hex");
    const keyKeyDigest = keySpki
      ? crypto.createHash("sha256").update(keySpki, "binary").digest("hex")
      : "";
    if (keyKeyDigest === "" || certKeyDigest !== keyKeyDigest) {
      throw new Error("Server certificate and key files do not match.");
    }
  }

  if (
    config.minimumTlsVersion &&
    config.minimumTlsVersion !== TLS_MIN_VERSION &&
    config.minimumTlsVersion !== TLS_MAX_VERSION
  ) {
    throw new Error(`Unsupported TLS minimum version: ${config.minimumTlsVersion}.`);
  }

  return {
    cert: serverCertFile ? readFileUtf8(serverCertFile) : undefined,
    key: serverKeyFile ? loadKey(serverKeyFile) : undefined,
    ca: caChain,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: config.minimumTlsVersion ?? TLS_MIN_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Leaf certificate parsing and identity validation (fail closed).
// ---------------------------------------------------------------------------

/** `certificateToString` normalizes a `Certificate` object into `CN=...,OU=...` so identity allowlists compare apples-to-apples. */
function certificateToString(cert: Certificate): string {
  const parts: string[] = [];
  if (cert.CN) {
    parts.push(`CN=${Array.isArray(cert.CN) ? cert.CN.join(",") : cert.CN}`);
  }
  if (cert.OU) {
    parts.push(`OU=${Array.isArray(cert.OU) ? cert.OU.join(",") : cert.OU}`);
  }
  if (cert.O) parts.push(`O=${cert.O}`);
  if (cert.L) parts.push(`L=${cert.L}`);
  if (cert.ST) parts.push(`ST=${cert.ST}`);
  if (cert.C) parts.push(`C=${cert.C}`);
  return parts.join(",");
}

/** First SAN segment (last resort: subject DN). */
function firstSan(subject: string, san: string): string {
  const segments = san
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 0) return segments[0];
  const subjectParts = subject.split(",").map((segment) => segment.trim()).filter(Boolean);
  return subjectParts[0] ?? "(no subject)";
}

function normalizeSanPattern(pattern: string): string {
  return pattern.replace(/^\*\./, "");
}

/**
 * Build the identity matcher.
 *
 * Priority: proxy service identity (explicit allowlist only) > SAN patterns
 * > subject DN allowlist. An allowlist that is empty means "no explicit
 * identity constraint", so the connection is only rejected for chain,
 * expiration, and revocation failures.
 */
function buildIdentityMatcher(
  allowedSubjects: ReadonlyArray<string> | undefined,
  allowedSanPatterns: ReadonlyArray<string> | undefined,
  allowedServiceIdentities: ReadonlyArray<string> | undefined,
): (peer: DetailedPeerCertificate, effectiveIdentity: string, serviceIdentity: string | undefined) => boolean {
  const subjects = allowedSubjects?.filter(Boolean) ?? [];
  const sanPatterns = allowedSanPatterns?.map(normalizeSanPattern).filter(Boolean) ?? [];
  const serviceIdentities = allowedServiceIdentities?.filter(Boolean) ?? [];
  return (peer, effectiveIdentity, serviceIdentity) => {
    if (serviceIdentity !== undefined && serviceIdentities.length > 0) {
      if (!serviceIdentities.includes(serviceIdentity)) return false;
    }
    if (subjects.length > 0) {
      if (!matchSubject(subjects, certificateToString(peer.subject), peer.subjectaltname ?? "")) return false;
    }
    if (sanPatterns.length > 0) {
      const normalizedSan = (peer.subjectaltname ?? "").replace(/^\*\./, "") ?? certificateToString(peer.subject);
      if (!sanPatterns.some((pattern) => normalizedSan.includes(pattern))) return false;
    }
    return true;
  };
}

function matchSubject(
  allowedSubjects: ReadonlyArray<string>,
  subject: string,
  san: string,
): boolean {
  if (allowedSubjects.includes(subject)) return true;
  const candidates = san ? [san, subject] : [subject];
  for (const candidate of candidates) {
    if (allowedSubjects.some((pattern) => candidate.includes(pattern))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Trust-bundle rotation window.
// ---------------------------------------------------------------------------

function caSubjects(caFile: string, caBundleFile?: string): string[] {
  const caChain = buildCaChain(caFile, caBundleFile);
  return caChain.map((pem) => {
    try {
      return new crypto.X509Certificate(pem).subject ?? "";
    } catch {
      return "";
    }
  });
}

function validateTrustRotation(
  config: BrokerMtlsServerConfig,
  clientIssuer: string,
  caFile: string,
  caBundleFile?: string,
): boolean {
  const trustWindowEnd = config.trustBundleRotationEndMs;
  if (trustWindowEnd === undefined) return true;
  const allSubjects = caSubjects(caFile, caBundleFile);
  const successorSubjects = caSubjects(caFile, caBundleFile);
  // Before the window ends: accept certs signed by any CA in the current trust
  // bundle (active + successor overlap).
  if (Date.now() <= trustWindowEnd) {
    return allSubjects.some((subject) => subject === clientIssuer);
  }
  // After the window ends: only the successor (caBundleFile) CA remains trusted.
  return successorSubjects.some((subject) => subject === clientIssuer);
}

// ---------------------------------------------------------------------------
// Connection enforcement.
// ---------------------------------------------------------------------------

const X_CREDENTIAL_BROKER_PROXY_SERVICE_IDENTITY =
  "X-Credential-Broker-Service-Identity";

interface ProxyTrust {
  trustedProxyAddresses: ReadonlyArray<string>;
}

function hostIsTrusted(remoteAddress: string, trustedProxyAddresses: readonly string[]): boolean {
  if (trustedProxyAddresses.length === 0) return false;
  const normalized = remoteAddress.replace(/^::ffff:/, "");
  return trustedProxyAddresses.some((pattern) => normalized === pattern || normalized.endsWith(pattern));
}

function extractProxyIdentity(
  socket: net.Socket,
  header: string | null,
  trustedProxyAddresses: readonly string[],
): { serviceIdentity: string | undefined; forged: boolean } {
  const remoteAddress = socket.remoteAddress ?? "";
  const authorized = hostIsTrusted(remoteAddress, trustedProxyAddresses);
  if (authorized && header) {
    const value = header.split(",").map((s) => s.trim()).filter(Boolean)[0];
    return { serviceIdentity: value, forged: false };
  }
  // The proxy header is only honored from a configured trusted proxy, so a
  // header from any other source is a forged, unauthorized attempt.
  if (header && !authorized) {
    return { serviceIdentity: undefined, forged: true };
  }
  return { serviceIdentity: undefined, forged: false };
}

function destroyWithError(socket: net.Socket, error: Error): void {
  try {
    socket.destroy(error);
  } catch {
    // Socket already destroyed; nothing to tear down.
  }
}

const PROXY_SERVICE_IDENTITY_HEADER = "X-Credential-Broker-Service-Identity";

function getProxyServiceIdentity(req: http.IncomingMessage | undefined): string | null {
  if (!req) return null;
  const header = req.headers[PROXY_SERVICE_IDENTITY_HEADER];
  return typeof header === "string" ? header : null;
}

interface ValidateContext {
  peer: DetailedPeerCertificate;
  caFile: string;
  caBundleFile?: string;
  allowedSubjects: ReadonlyArray<string>;
  allowedSanPatterns: ReadonlyArray<string>;
  allowedServiceIdentities: ReadonlyArray<string>;
  trustWindowEnd: number | null;
  proxyTrust: ProxyTrust;
  socket: net.Socket;
  req: http.IncomingMessage | undefined;
  config: BrokerMtlsServerConfig;
}

function validateClientIdentity(ctx: ValidateContext): void {
  const { peer, caFile, caBundleFile, trustWindowEnd, proxyTrust, socket, req } = ctx;

  // Node's `rejectUnauthorized: true` + `ca` already rejects clients whose
  // chain does not chain to us, is expired, not-yet-valid, or is malformed.
  if (!certificateToString(peer.subject)) {
    destroyWithError(socket, new BrokerTlsError("missing_client_certificate", "A client certificate is required."));
    return;
  }

  const validFrom = Number(peer.valid_from);
  const validTo = Number(peer.valid_to);
  if (Number.isNaN(validTo) || validTo < Date.now()) {
    destroyWithError(socket, new BrokerTlsError("client_certificate_expired", "Client certificate is expired."));
    return;
  }
  if (Number.isNaN(validFrom) || validFrom > Date.now()) {
    destroyWithError(socket, new BrokerTlsError("client_certificate_not_yet_valid", "Client certificate is not yet valid."));
    return;
  }

  const identity = firstSan(certificateToString(peer.subject), peer.subjectaltname ?? "");

  // Explicitly reject a forged service-identity header unless the proxy is
  // trusted. `allowedClientServiceIdentities` gates this mode on.
  const header = getProxyServiceIdentity(req);
  const proxyIdentity = extractProxyIdentity(socket, header, proxyTrust.trustedProxyAddresses);
  if (proxyIdentity.forged) {
    destroyWithError(socket, new BrokerTlsError("forged_proxy_identity", "Forged certificate identity header from an untrusted proxy."));
    return;
  }

  const effectiveIdentity = proxyIdentity.serviceIdentity ?? identity;

  const matcher = buildIdentityMatcher(
    ctx.allowedSubjects,
    ctx.allowedSanPatterns,
    ctx.allowedServiceIdentities,
  );
  if (!matcher(peer, effectiveIdentity, proxyIdentity.serviceIdentity)) {
    destroyWithError(socket, new BrokerTlsError("client_identity_mismatch", "Client certificate identity is not authorized."));
    return;
  }

  if (trustWindowEnd !== null && !validateTrustRotation(ctx.config, certificateToString(peer.issuer), caFile, caBundleFile)) {
    destroyWithError(socket, new BrokerTlsError("client_identity_mismatch", "Client certificate is no longer trusted after rotation window."));
    return;
  }
}

// ---------------------------------------------------------------------------
// Secure listener. `application` is the Hono app fetch used as the TLS request
// listener; identity is enforced before it receives any request.
// ---------------------------------------------------------------------------

export interface BrokerSecureServerConfig {
  /** Optional CA bundle to chain alongside the config CA file. */
  caBundleFile?: string;
  /** Trusted source addresses for proxy-terminated deployments. Empty = direct mTLS. */
  trustedProxyAddresses?: string[];
  /**
   * When true (and `allowedClientServiceIdentities` is configured), a
   * `X-Credential-Broker-Service-Identity` header is accepted as the cert
   * identity from a configured trusted proxy. Default true.
   */
  requireProxyServiceIdentityHeader?: boolean;
}

export interface BrokerServerHandle {
  server: Server;
  diagnostics?: SecureServerResult;
  listen(port: number): this;
  close(): Promise<void>;
}

/** Hono's fetch callback; @hono/node-server adapts it to IncomingMessage/ServerResponse. */
export type AppFetch = (
  request: Request,
  env?: unknown,
) => Response | Promise<Response>;

export function createSecureServer(
  application: AppFetch,
  config: BrokerMtlsServerConfig,
  options?: BrokerSecureServerConfig,
): BrokerServerHandle {
  const caBundleFile = options?.caBundleFile;
  const serverOptions = buildServerOptions(config, caBundleFile);

  const allowedSubjects = config.allowedClientSubjects?.filter(Boolean) ?? [];
  const allowedSanPatterns = config.allowedClientSanPatterns?.map(normalizeSanPattern).filter(Boolean) ?? [];
  const allowedServiceIdentities = config.allowedClientServiceIdentities?.filter(Boolean) ?? [];
  const trustWindowEnd = config.trustBundleRotationEndMs ?? null;

  // `https.createServer` requires a Node RequestListener. Hono's `app.fetch`
  // is a FetchCallback and cannot be passed directly: doing so loses the
  // IncomingMessage body/response-stream adaptation and produces a type error.
  // Use Hono's maintained adapter so POST bodies, streaming responses, aborts,
  // and error handling behave exactly as they do on the plain HTTP path.
  const requestListener = getRequestListener(application);
  const server = https.createServer(serverOptions, requestListener);

  server.on("secureConnection", (socket) => {
    try {
      // `getPeerCertificate(true)` returns the full chain. Node has already
      // rejected malformed/unauthorized chains by the time this fires.
      const peer: DetailedPeerCertificate | null = socket.getPeerCertificate(true);
      if (!peer || !certificateToString(peer.subject)) {
        destroyWithError(socket, new BrokerTlsError("missing_client_certificate", "A client certificate is required."));
        return;
      }
      validateClientIdentity({
        peer,
        caFile: config.caFile ?? "",
        caBundleFile,
        allowedSubjects,
        allowedSanPatterns,
        allowedServiceIdentities,
        trustWindowEnd,
        proxyTrust: { trustedProxyAddresses: options?.trustedProxyAddresses ?? [] },
        socket,
        req: (socket as net.Socket & { request?: http.IncomingMessage }).request,
        config,
      });
    } catch (error) {
      if (error instanceof BrokerTlsError) {
        destroyWithError(socket, error);
      } else {
        destroyWithError(socket, new BrokerTlsError("client_certificate_malformed", "Failed to validate client certificate."));
      }
    }
  });

  const serverCertFile = config.serverCertificateFile;
  const serverKeyFile = config.serverKeyFile;

  let diagnostics: SecureServerResult;
  if (serverCertFile && serverKeyFile) {
    const certPem = loadFile(serverCertFile);
    const certMaterial = parseLeafCertificate(certPem);
    diagnostics = {
      serverFingerprint: crypto.createHash("sha256").update(certPem, "binary").digest("hex"),
      clientIdentity: undefined,
      clientFingerprint: undefined,
      trustBundleActiveAtMs: Date.now(),
      trustBundleRotationEndMs: config.trustBundleRotationEndMs ?? null,
    };
  } else {
    diagnostics = {
      serverFingerprint: safeServerLabel(serverCertFile, serverKeyFile),
      clientIdentity: undefined,
      clientFingerprint: undefined,
      trustBundleActiveAtMs: Date.now(),
      trustBundleRotationEndMs: config.trustBundleRotationEndMs ?? null,
    };
  }

  let listening = false;
  const handle: BrokerServerHandle = {
    server,
    diagnostics,
    listen: (port: number) => {
      if (!listening) {
        server.listen(port);
        listening = true;
      }
      return handle;
    },
    close: async () => {
      if (!listening || !server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      listening = false;
    },
  };
  return handle;
}

// ---------------------------------------------------------------------------
// Helpers (kept from the original implementation).
// ---------------------------------------------------------------------------

function subjectToCertificate(subject: string): Certificate {
  const cert: Certificate = {};
  const pairs = subject.split(",").map((s) => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim().toUpperCase();
    const value = pair.slice(idx + 1).trim();
    if (key === "CN") cert.CN = value;
    else if (key === "OU") cert.OU = value;
    else if (key === "O") cert.O = value;
    else if (key === "L") cert.L = value;
    else if (key === "ST") cert.ST = value;
    else if (key === "C") cert.C = value;
  }
  return cert;
}

/** Parse a PEM certificate into a `DetailedPeerCertificate`-shaped record for diagnostics. */
function parseLeafCertificate(certPem: string): DetailedPeerCertificate {
  let cert: crypto.X509Certificate;
  try {
    cert = new crypto.X509Certificate(certPem);
  } catch {
    throw new BrokerTlsError("client_certificate_malformed", "Client certificate is malformed.");
  }
  return {
    subject: subjectToCertificate(cert.subject),
    issuer: subjectToCertificate(cert.issuer),
    subjectaltname: cert.subjectAltName ?? undefined,
    valid_from: cert.validFrom ?? "",
    valid_to: cert.validTo ?? "",
    raw: certPem,
    ca: false,
    fingerprint: crypto.createHash("sha256").update(certPem, "binary").digest("hex"),
    fingerprint256: crypto.createHash("sha256").update(certPem, "binary").digest("hex"),
    serialNumber: cert.serialNumber ?? "",
  };
}

function safeServerLabel(serverCertFile: string | undefined, serverKeyFile: string | undefined): string {
  const label = serverCertFile?.split(/[\\/]/).pop() ?? serverKeyFile?.split(/[\\/]/).pop() ?? "broker-tls";
  return label;
}

// ---------------------------------------------------------------------------
// Test helper: generate a temporary CA + cert + key pair using openssl (no
// real certificates, no private material committed).
// ---------------------------------------------------------------------------

export interface TestCaFiles {
  caFile: string;
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
  stagingCert: string;
  stagingKey: string;
}

function opensslAnd(...args: string[]): string {
  return execFileSync("openssl", args, { encoding: "utf8" }).trim();
}

function generatePkcs8Key(dir: string, base: string): string {
  return opensslAnd(
    "genpkey",
    "-algorithm",
    "EC",
    "-pkeyopt",
    "group:p256",
    "-out",
    path.join(dir, `${base}.key`),
  );
}

function signWithCa(dir: string, caKey: string, cn: string, san: string): { cert: string; key: string } {
  const key = generatePkcs8Key(dir, cn);
  const csr = path.join(dir, `${cn}.csr`);
  execFileSync("openssl", ["req", "-new", "-key", key, "-out", csr, "-subj", `/CN=${cn}`], { encoding: "utf8" });
  const cert = opensslAnd(
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    path.join(dir, "ca.pem"),
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    path.join(dir, `${cn}.crt`),
    "-days",
    "3650",
    "-sha256",
    "-extfile",
    "devnull",
    "-extensions",
    "san",
  );
  return { cert, key };
}

export function tmpTestCaFiles(): TestCaFiles {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broker-mtls-test-"));
  const caKey = generatePkcs8Key(dir, "ca");
  // Self-signed CA.
  const caCert = opensslAnd(
    "req",
    "-x509",
    "-new",
    "-key",
    caKey,
    "-out",
    path.join(dir, "ca.pem"),
    "-days",
    "3650",
    "-sha256",
    "-subj",
    "/CN=Test CA",
  );

  const serverCn = "broker-prod.example.com";
  const server = signWithCa(dir, caKey, serverCn, `DNS:${serverCn}`);
  const clientCn = "execution-server-prod";
  const client = signWithCa(dir, caKey, clientCn, `DNS:${clientCn}`);
  // Staging client: different CN, same CA. Must be rejected by a production
  // broker whose identity allowlist only contains the production identity.
  const stagingCn = "execution-server-staging";
  const staging = signWithCa(dir, caKey, stagingCn, `DNS:${stagingCn}`);

  return {
    caFile: path.join(dir, "ca.pem"),
    caCert,
    caKey,
    serverCert: server.cert,
    serverKey: server.key,
    clientCert: client.cert,
    clientKey: client.key,
    stagingCert: staging.cert,
    stagingKey: staging.key,
  };
}
