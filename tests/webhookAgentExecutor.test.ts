import type { AgentRecord } from "@multi-agent/types";
import { WebhookAgentExecutor } from "../src/agents/runtime/webhookAgentExecutor";
import type { CredentialGateway, CredentialGatewayRequest, CredentialLease } from "../src/security/credentialGateway";
import { AgentExecutionFailedError } from "../src/agents/runtime/errors";

describe("WebhookAgentExecutor", () => {
  const baseAgent: AgentRecord = {
    id: "agent-webhook-1",
    name: "Webhook Reviewer",
    description: "External review webhook",
    backend: {
      type: "webhook",
      url: "https://api.partner.org/webhook",
      method: "POST",
    },
    systemPrompt: "You are an external review agent.",
    tools: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const enabledPolicy = {
    enabled: true,
    allowedHosts: ["api.partner.org"],
    allowPrivateIps: false,
    maxResponseBytes: 1024 * 1024,
    defaultTimeoutMs: 5000,
  };

  const mockLookup = jest.fn().mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);

  it("fails closed when webhook execution is disabled on the server", async () => {
    const executor = new WebhookAgentExecutor(
      undefined,
      { ...enabledPolicy, enabled: false },
      jest.fn() as any,
      mockLookup as any
    );

    const input = {
      agent: baseAgent,
      input: { query: "hello" },
      runId: "run-1",
      nodeId: "node-1",
    };

    const events: any[] = [];
    await expect(async () => {
      for await (const event of executor.execute(input)) {
        events.push(event);
      }
    }).rejects.toThrow(AgentExecutionFailedError);

    expect(events.some((e) => e.type === "agent.failed")).toBe(true);
  });

  it("blocks SSRF targets resolving to private networks", async () => {
    const evilLookup = jest.fn().mockResolvedValue([
      { address: "192.168.1.1", family: 4 },
    ]);
    const executor = new WebhookAgentExecutor(
      undefined,
      { ...enabledPolicy, allowedHosts: ["evil.internal.corp"] },
      jest.fn() as any,
      evilLookup as any
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: { type: "webhook" as const, url: "https://evil.internal.corp/hook" },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {
        // drain
      }
    }).rejects.toThrow(/forbidden IP "192.168.1.1"/);
  });

  it("fails closed when credentialAlias is configured but credentialGateway is absent", async () => {
    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      jest.fn() as any,
      mockLookup as any
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "webhook" as const,
          url: "https://api.partner.org/webhook",
          credentialAlias: "partner-creds",
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/requires a credential gateway when credentialAlias is configured/);
  });

  it("refuses to transmit leased credential token over unencrypted HTTP", async () => {
    const mockGateway: CredentialGateway = {
      issue: jest.fn().mockResolvedValue({ leaseId: "lease-123", expiresAt: Date.now() + 30000 }),
      consume: jest.fn().mockResolvedValue("secret-token"),
    };

    const executor = new WebhookAgentExecutor(
      mockGateway,
      { ...enabledPolicy, allowedHosts: ["insecure.partner.org"] },
      jest.fn() as any,
      mockLookup as any
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "webhook" as const,
          url: "http://insecure.partner.org/webhook",
          credentialAlias: "partner-token",
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
      credentialPrincipal: {
        tenantId: "tenant-a",
        principalId: "user-1",
      },
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/Refusing to transmit leased credential token over unencrypted HTTP/);
  });

  it("strips Authorization header on cross-origin redirects", async () => {
    const mockGateway: CredentialGateway = {
      issue: jest.fn().mockResolvedValue({ leaseId: "lease-123", expiresAt: Date.now() + 30000 }),
      consume: jest.fn().mockResolvedValue("leased-secret-token"),
    };

    let secondRequestHeaders: any;
    const mockFetch = jest.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://redirect.partner.org/final-webhook" },
        })
      )
      .mockImplementationOnce(async (_url, init) => {
        secondRequestHeaders = init.headers;
        return new Response(JSON.stringify({ output: "Redirected output" }), { status: 200 });
      });

    const executor = new WebhookAgentExecutor(
      mockGateway,
      { ...enabledPolicy, allowedHosts: ["api.partner.org", "redirect.partner.org"] },
      mockFetch as any,
      mockLookup as any
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "webhook" as const,
          url: "https://api.partner.org/webhook",
          credentialAlias: "partner-auth",
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
      credentialPrincipal: {
        tenantId: "tenant-a",
        principalId: "user-1",
      },
    };

    const events: any[] = [];
    for await (const event of executor.execute(input)) {
      events.push(event);
    }

    expect(secondRequestHeaders?.Authorization).toBeUndefined();
    const completed = events.find((e) => e.type === "agent.completed");
    expect((completed?.payload as any).content).toBe("Redirected output");
  });

  it("leases and consumes credentials through credential broker", async () => {
    const mockGateway: CredentialGateway = {
      issue: jest.fn().mockResolvedValue({ leaseId: "lease-123", expiresAt: Date.now() + 30000 }),
      consume: jest.fn().mockResolvedValue("leased-secret-token"),
    };

    let sentHeaders: HeadersInit | undefined;
    let sentBody: string | undefined;

    const mockFetch = jest.fn().mockImplementation(async (url, init) => {
      sentHeaders = init.headers;
      sentBody = init.body;
      return new Response(JSON.stringify({ output: "Webhook response content" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const agentWithCreds: AgentRecord = {
      ...baseAgent,
      backend: {
        type: "webhook",
        url: "https://api.partner.org/webhook",
        credentialAlias: "partner-auth",
      },
    };

    const executor = new WebhookAgentExecutor(
      mockGateway,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const input = {
      agent: agentWithCreds,
      input: { task: "evaluate" },
      runId: "run-1",
      nodeId: "node-1",
      credentialPrincipal: {
        tenantId: "tenant-a",
        principalId: "user-1",
      },
    };

    const events: any[] = [];
    for await (const event of executor.execute(input)) {
      events.push(event);
    }

    expect(mockGateway.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "webhook",
        alias: "partner-auth",
        tenantId: "tenant-a",
        runId: "run-1",
      })
    );
    expect(mockGateway.consume).toHaveBeenCalled();
    expect((sentHeaders as any)["Authorization"]).toBe("Bearer leased-secret-token");

    const completed = events.find((e) => e.type === "agent.completed");
    expect(completed).toBeDefined();
    expect((completed?.payload as any).content).toBe("Webhook response content");
  });

  it("revokes lease and redacts secrets when webhook execution fails", async () => {
    const revokeMock = jest.fn().mockResolvedValue(undefined);
    const mockGateway = {
      issue: jest.fn().mockResolvedValue({ leaseId: "lease-999", expiresAt: Date.now() + 30000 }),
      consume: jest.fn().mockResolvedValue("super-secret-token-xyz"),
      revoke: revokeMock,
    };

    const mockFetch = jest.fn().mockRejectedValue(new Error("Connection error with token super-secret-token-xyz"));

    const executor = new WebhookAgentExecutor(
      mockGateway as any,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "webhook" as const,
          url: "https://api.partner.org/webhook",
          credentialAlias: "secret-alias",
        },
      },
      input: "test",
      runId: "run-1",
      nodeId: "node-1",
      credentialPrincipal: {
        tenantId: "tenant-a",
        principalId: "user-1",
      },
    };

    let caughtError: any;
    try {
      for await (const _ of executor.execute(input)) {}
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message).not.toContain("super-secret-token-xyz");
    expect(caughtError.message).toContain("[REDACTED]");
    expect(revokeMock).toHaveBeenCalledWith(
      { leaseId: "lease-999", expiresAt: expect.any(Number) },
      expect.objectContaining({ alias: "secret-alias" })
    );
  });

  it("times out during stalled response body stream", async () => {
    // Response stream that hangs without completing or sending data
    const hangingStream = new ReadableStream({
      start() {
        // intentionally do nothing
      },
    });

    const mockFetch = jest.fn().mockResolvedValue(
      new Response(hangingStream, { status: 200 })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      { ...enabledPolicy, defaultTimeoutMs: 100 }, // 100ms timeout
      mockFetch as any,
      mockLookup as any
    );

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          type: "webhook" as const,
          url: "https://api.partner.org/webhook",
          timeoutMs: 100,
        },
      },
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/timed out after 100ms/);
  });

  it("enforces maximum response byte limits", async () => {
    const oversizedBody = "A".repeat(2000);
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(oversizedBody, { status: 200 })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      { ...enabledPolicy, maxResponseBytes: 500 }, // only 500 bytes allowed
      mockFetch as any,
      mockLookup as any
    );

    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {
        // drain
      }
    }).rejects.toThrow(/exceeded the 500-byte server limit/);
  });

  it("blocks redirects targeting private networks or forbidden addresses", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data" },
      })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      { ...enabledPolicy, allowedHosts: ["api.partner.org", "169.254.169.254"] },
      mockFetch as any,
      mockLookup as any
    );

    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/private or forbidden network destination/);
  });

  it("cleans up resources cleanly via close and destroy", async () => {
    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      jest.fn() as any,
      mockLookup as any
    );

    await expect(executor.close()).resolves.toBeUndefined();
    await expect(executor.destroy()).resolves.toBeUndefined();
  });

  it("automatically closes dispatcher on successful execution without manual cleanup", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "complete" }), { status: 200 })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const dispatcher = executor.getDispatcher() as any;
    expect(dispatcher.closed).toBe(false);

    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    for await (const _ of executor.execute(input)) {
      // exhaust
    }

    expect(dispatcher.closed).toBe(true);
  });

  it("automatically destroys dispatcher on execution failure", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const dispatcher = executor.getDispatcher() as any;
    expect(dispatcher.destroyed).toBe(false);

    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(AgentExecutionFailedError);

    expect(dispatcher.destroyed).toBe(true);
  });

  it("automatically destroys dispatcher immediately when parent AbortSignal is cancelled", async () => {
    const abortController = new AbortController();
    const mockFetch = jest.fn().mockImplementation(async (_url, options) => {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(options.signal.reason);
        });
      });
    });

    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const dispatcher = executor.getDispatcher() as any;
    expect(dispatcher.destroyed).toBe(false);

    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
      signal: abortController.signal,
    };

    const runPromise = (async () => {
      for await (const _ of executor.execute(input)) {}
    })();

    // Abort from parent while in flight
    setTimeout(() => {
      abortController.abort(new Error("parent aborted"));
    }, 10);

    await expect(runPromise).rejects.toThrow();
    expect(dispatcher.destroyed).toBe(true);
  });

  it("automatically destroys dispatcher promptly on request timeout", async () => {
    const mockFetch = jest.fn().mockImplementation(async (_url, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(options.signal.reason);
        });
      });
    });

    const executor = new WebhookAgentExecutor(
      undefined,
      { ...enabledPolicy, defaultTimeoutMs: 50 },
      mockFetch as any,
      mockLookup as any
    );

    const dispatcher = executor.getDispatcher() as any;
    expect(dispatcher.destroyed).toBe(false);

    const input = {
      agent: {
        ...baseAgent,
        backend: {
          ...baseAgent.backend,
          timeoutMs: 50,
        },
      },
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    await expect(async () => {
      for await (const _ of executor.execute(input)) {}
    }).rejects.toThrow(/timed out after 50ms/);

    expect(dispatcher.destroyed).toBe(true);
  });

  it("automatically destroys dispatcher when consumer breaks out of generator early", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "complete" }), { status: 200 })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const dispatcher = executor.getDispatcher() as any;
    expect(dispatcher.destroyed).toBe(false);

    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
    };

    for await (const _ of executor.execute(input)) {
      // Break out early without exhausting generator
      break;
    }

    expect(dispatcher.destroyed).toBe(true);
  });

  it("aborts streaming response and promptly destroys dispatcher when cancelled", async () => {
    let streamCancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("part 1"));
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const abortController = new AbortController();
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(stream, { status: 200 })
    );

    const executor = new WebhookAgentExecutor(
      undefined,
      enabledPolicy,
      mockFetch as any,
      mockLookup as any
    );

    const dispatcher = executor.getDispatcher() as any;
    const input = {
      agent: baseAgent,
      input: "ping",
      runId: "run-1",
      nodeId: "node-1",
      signal: abortController.signal,
    };

    const executePromise = (async () => {
      for await (const _ of executor.execute(input)) {}
    })();

    // Abort after execution starts
    setTimeout(() => {
      abortController.abort(new Error("User aborted stream"));
    }, 10);

    await expect(executePromise).rejects.toThrow();
    expect(dispatcher.destroyed).toBe(true);
  });
});
