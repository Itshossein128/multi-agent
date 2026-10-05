import { nowIso } from "@multi-agent/types";
import { fetch as undiciFetch } from "undici";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";
import {
  assertSafeDestinationUrl,
  createPinnedSsrfDispatcher,
  webhookPolicyFromEnvironment,
  type WebhookPolicyConfig,
  type TransportDnsLookupFn,
} from "./ssrfProtection";
import type { CredentialGateway, CredentialLease, CredentialGatewayRequest } from "../../security/credentialGateway";
import dns from "node:dns/promises";

export class WebhookAgentExecutor implements AgentExecutor {
  private readonly dispatcher: unknown;

  constructor(
    private readonly credentialGateway?: CredentialGateway,
    private readonly policy: WebhookPolicyConfig = webhookPolicyFromEnvironment(),
    private readonly fetchImpl: typeof fetch = undiciFetch as unknown as typeof fetch,
    private readonly lookupFn: typeof dns.lookup = dns.lookup,
    transportLookupFn?: TransportDnsLookupFn,
  ) {
    this.dispatcher = createPinnedSsrfDispatcher(this.policy, transportLookupFn);
  }

  getDispatcher(): unknown {
    return this.dispatcher;
  }

  async close(): Promise<void> {
    if (this.dispatcher && typeof (this.dispatcher as any).close === "function") {
      await (this.dispatcher as any).close().catch(() => {});
    }
  }

  async destroy(): Promise<void> {
    if (this.dispatcher && typeof (this.dispatcher as any).destroy === "function") {
      await (this.dispatcher as any).destroy().catch(() => {});
    }
  }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    let completedSuccessfully = false;

    // Hook parent abort signal immediately to destroy dispatcher promptly on cancellation
    const onParentAbortPrompt = () => {
      void this.destroy();
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onParentAbortPrompt();
      } else {
        input.signal.addEventListener("abort", onParentAbortPrompt, { once: true });
      }
    }

    try {
      if (input.agent.backend.type !== "webhook") {
        throw new AgentExecutionFailedError("WebhookAgentExecutor requires a webhook backend.");
      }
      const backend = input.agent.backend;

      if (!this.policy.enabled) {
        const msg = "Webhook agent execution is disabled on this server. Set WEBHOOK_AGENT_ENABLED=true and configure server allowlists.";
        yield event("agent.failed", input, { error: msg });
        throw new AgentExecutionFailedError(msg);
      }

      // Fail closed if credentialAlias is set but credentialGateway is absent
      if (backend.credentialAlias && !this.credentialGateway) {
        const msg = "Webhook agent requires a credential gateway when credentialAlias is configured.";
        yield event("agent.failed", input, { error: msg });
        throw new AgentExecutionFailedError(msg);
      }

      yield event("agent.started", input, {
        url: backend.url,
        method: backend.method ?? "POST",
      });

      const startedAt = Date.now();
      yield event("llm.started", input, { provider: "webhook", url: backend.url });

      let activeLease: CredentialLease | undefined;
      let leaseReq: CredentialGatewayRequest | undefined;
      let leaseToken: string | undefined;

      try {
        input.signal?.throwIfAborted();

        // 1. Assert destination URL is safe from SSRF & DNS rebinding (empty allowlist fails closed)
        let currentUrl = await assertSafeDestinationUrl(
          backend.url,
          {
            allowedHosts: this.policy.allowedHosts,
            allowPrivateIps: this.policy.allowPrivateIps,
          },
          this.lookupFn,
        );

        input.signal?.throwIfAborted();

        // 2. Resolve credentials through broker if alias specified
        if (backend.credentialAlias && this.credentialGateway) {
          if (!input.credentialPrincipal) {
            throw new Error("Webhook agent with credentialAlias requires trusted credential principal.");
          }
          leaseReq = {
            provider: "webhook" as const,
            alias: backend.credentialAlias,
            tenantId: input.credentialPrincipal.tenantId,
            principalId: input.credentialPrincipal.principalId,
            runId: input.runId,
            agentId: input.agent.id,
            purpose: "agent",
          };
          activeLease = await this.credentialGateway.issue(leaseReq);
          leaseToken = await this.credentialGateway.consume(activeLease, leaseReq);
        }

        input.signal?.throwIfAborted();

        // 3. Prepare headers and payload
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain",
        };

        if (leaseToken) {
          if (currentUrl.protocol !== "https:") {
            throw new Error("Refusing to transmit leased credential token over unencrypted HTTP.");
          }
          headers.Authorization = `Bearer ${leaseToken}`;
        }

        if (backend.headers) {
          for (const [key, value] of Object.entries(backend.headers)) {
            if (!/^authorization$/i.test(key) && !/^host$/i.test(key)) {
              headers[key] = value;
            }
          }
        }

        const payload = JSON.stringify({
          agentId: input.agent.id,
          runId: input.runId,
          nodeId: input.nodeId,
          workflowId: input.workflowId,
          systemPrompt: input.agent.systemPrompt,
          input: input.input,
          context: input.context,
        });

        const payloadBytes = Buffer.byteLength(payload, "utf8");
        const maxPayloadBytes = 1024 * 1024;
        if (payloadBytes > maxPayloadBytes) {
          throw new Error(`Webhook request payload exceeded maximum allowed size of ${maxPayloadBytes} bytes.`);
        }

        const timeoutMs = backend.timeoutMs ?? this.policy.defaultTimeoutMs;
        const abortController = new AbortController();

        const onParentAbort = () => {
          void this.destroy();
          abortController.abort(input.signal?.reason ?? new Error("Execution cancelled"));
        };
        if (input.signal?.aborted) {
          onParentAbort();
        } else {
          input.signal?.addEventListener("abort", onParentAbort, { once: true });
        }

        const timeoutTimer = setTimeout(() => {
          void this.destroy();
          abortController.abort(new Error(`Webhook request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        let content = "";
        try {
          let response: Response;
          let redirectHops = 0;
          const maxRedirects = 3;

          while (true) {
            response = await this.fetchImpl(currentUrl, {
              method: backend.method ?? "POST",
              headers,
              body: payload,
              signal: abortController.signal,
              redirect: "manual",
              dispatcher: this.dispatcher,
            } as any);

            // Check for redirect (301, 302, 303, 307, 308)
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              redirectHops += 1;
              if (redirectHops > maxRedirects) {
                throw new Error("Too many redirects from webhook agent endpoint.");
              }
              const location = response.headers.get("location");
              if (!location) {
                throw new Error("Redirect response missing Location header.");
              }
              const nextUrl = new URL(location, currentUrl);

              // Strip Authorization header if redirect changes origin
              if (nextUrl.origin !== currentUrl.origin) {
                delete headers.Authorization;
              }

              // Validate the redirect target against SSRF policy
              currentUrl = await assertSafeDestinationUrl(
                nextUrl.toString(),
                {
                  allowedHosts: this.policy.allowedHosts,
                  allowPrivateIps: this.policy.allowPrivateIps,
                },
                this.lookupFn,
              );
              continue;
            }

            break;
          }

          if (!response.ok) {
            throw new Error(`Webhook endpoint returned status ${response.status} ${response.statusText}`);
          }

          // 4. Bounded response reading while timeout and abort listeners remain active
          content = await readBoundedResponse(response, this.policy.maxResponseBytes, abortController.signal);
        } finally {
          clearTimeout(timeoutTimer);
          input.signal?.removeEventListener("abort", onParentAbort);
        }

        yield event("llm.completed", input, {
          provider: "webhook",
          url: backend.url,
          durationMs: Date.now() - startedAt,
        });

        yield event("agent.output", input, { content });
        yield event("agent.completed", input, { content });

        completedSuccessfully = true;
      } catch (error) {
        // Lease revocation cleanup if error occurred
        if (activeLease && leaseReq && this.credentialGateway && "revoke" in this.credentialGateway) {
          await (this.credentialGateway as any).revoke(activeLease, leaseReq).catch(() => {});
        }

        let rawMessage = error instanceof Error ? error.message : String(error);
        if (error && typeof error === "object" && "cause" in error && (error as any).cause instanceof Error) {
          rawMessage += `: ${(error as any).cause.message}`;
        }
        const message = redactSecret(rawMessage, leaseToken);
        yield event("llm.failed", input, { provider: "webhook", error: message.slice(0, 500) });
        yield event("agent.failed", input, { error: message });
        throw new AgentExecutionFailedError(message);
      }
    } finally {
      input.signal?.removeEventListener("abort", onParentAbortPrompt);
      if (!completedSuccessfully || input.signal?.aborted) {
        await this.destroy();
      } else {
        await this.close();
      }
    }
  }
}

async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    return extractOutputText(text);
  }

  signal?.throwIfAborted();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal) {
      onAbort = () => {
        reader.cancel().catch(() => {});
        reject(signal.reason ?? new Error("Response read aborted"));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });

  try {
    while (true) {
      const readResult = await Promise.race([reader.read(), abortPromise]);
      const { done, value } = readResult;
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(`Webhook response exceeded the ${maxBytes}-byte server limit.`);
        }
        chunks.push(value);
      }
    }
  } finally {
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }

  const totalBuffer = Buffer.concat(chunks);
  const text = totalBuffer.toString("utf8");
  return extractOutputText(text);
}

function extractOutputText(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.output === "string") return obj.output;
      if (typeof obj.content === "string") return obj.content;
      if (typeof obj.response === "string") return obj.response;
      if (typeof obj.result === "string") return obj.result;
      if (typeof obj.message === "string") return obj.message;
      return JSON.stringify(obj);
    }
  } catch {
    // raw text response
  }
  return rawText;
}

function redactSecret(message: string, secret?: string): string {
  if (!secret) return message;
  return message.split(secret).join("[REDACTED]");
}

function event(type: AgentExecutionEvent["type"], input: AgentExecutionInput, payload: unknown): AgentExecutionEvent {
  return {
    type,
    timestamp: nowIso(),
    agentId: input.agent.id,
    nodeId: input.nodeId,
    runId: input.runId,
    payload,
  };
}
