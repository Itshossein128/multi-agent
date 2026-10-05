if (typeof Symbol.dispose === "undefined") {
  Object.defineProperty(Symbol, "dispose", {
    value: Symbol.for("nodejs.dispose"),
    configurable: true,
  });
}

import {
  isForbiddenIp,
  isForbiddenIpv4,
  isForbiddenIpv6,
  assertSafeDestinationUrl,
  SsrfPolicyError,
  webhookPolicyFromEnvironment,
  createPinnedSsrfDispatcher,
} from "../src/agents/runtime/ssrfProtection";

describe("SSRF Protection", () => {
  describe("IPv4 range filtering", () => {
    it("blocks loopback (127.0.0.1, 127.0.0.2)", () => {
      expect(isForbiddenIpv4("127.0.0.1")).toBe(true);
      expect(isForbiddenIpv4("127.10.20.30")).toBe(true);
    });

    it("blocks private RFC 1918 ranges (10.x, 172.16.x, 192.168.x)", () => {
      expect(isForbiddenIpv4("10.0.0.1")).toBe(true);
      expect(isForbiddenIpv4("10.254.254.254")).toBe(true);
      expect(isForbiddenIpv4("172.16.0.1")).toBe(true);
      expect(isForbiddenIpv4("172.31.255.255")).toBe(true);
      expect(isForbiddenIpv4("192.168.1.1")).toBe(true);
      expect(isForbiddenIpv4("192.168.0.254")).toBe(true);
    });

    it("blocks link-local and cloud metadata (169.254.169.254)", () => {
      expect(isForbiddenIpv4("169.254.169.254")).toBe(true);
      expect(isForbiddenIpv4("169.254.1.1")).toBe(true);
    });

    it("blocks carrier-grade NAT (100.64.0.1)", () => {
      expect(isForbiddenIpv4("100.64.0.1")).toBe(true);
      expect(isForbiddenIpv4("100.127.255.255")).toBe(true);
    });

    it("blocks current network (0.0.0.0)", () => {
      expect(isForbiddenIpv4("0.0.0.0")).toBe(true);
    });

    it("permits public routable IPs", () => {
      expect(isForbiddenIpv4("8.8.8.8")).toBe(false);
      expect(isForbiddenIpv4("1.1.1.1")).toBe(false);
      expect(isForbiddenIpv4("93.184.216.34")).toBe(false);
    });
  });

  describe("IPv6 range filtering", () => {
    it("blocks loopback (::1)", () => {
      expect(isForbiddenIpv6("::1")).toBe(true);
      expect(isForbiddenIpv6("0:0:0:0:0:0:0:1")).toBe(true);
    });

    it("blocks unspecified (::)", () => {
      expect(isForbiddenIpv6("::")).toBe(true);
    });

    it("blocks unique local (fc00::/7)", () => {
      expect(isForbiddenIpv6("fc00::1")).toBe(true);
      expect(isForbiddenIpv6("fd12:3456:789a::1")).toBe(true);
    });

    it("blocks link-local (fe80::/10)", () => {
      expect(isForbiddenIpv6("fe80::1")).toBe(true);
    });

    it("blocks IPv4-mapped private IPv6 addresses", () => {
      expect(isForbiddenIpv6("::ffff:127.0.0.1")).toBe(true);
      expect(isForbiddenIpv6("::ffff:192.168.1.100")).toBe(true);
      expect(isForbiddenIpv6("::ffff:169.254.169.254")).toBe(true);
    });

    it("permits public IPv6", () => {
      expect(isForbiddenIpv6("2606:4700:4700::1111")).toBe(false);
      expect(isForbiddenIpv6("2001:4860:4860::8888")).toBe(false);
    });
  });

  describe("assertSafeDestinationUrl", () => {
    it("rejects non-HTTP protocols", async () => {
      await expect(assertSafeDestinationUrl("ftp://example.com/file")).rejects.toThrow(SsrfPolicyError);
      await expect(assertSafeDestinationUrl("file:///etc/passwd")).rejects.toThrow(SsrfPolicyError);
      await expect(assertSafeDestinationUrl("gopher://127.0.0.1")).rejects.toThrow(SsrfPolicyError);
    });

    it("rejects URLs with embedded credentials", async () => {
      await expect(assertSafeDestinationUrl("https://user:pass@example.com")).rejects.toThrow(
        "Destination URL must not contain embedded authentication credentials."
      );
    });

    it("rejects loopback and private IP literals directly", async () => {
      await expect(assertSafeDestinationUrl("http://127.0.0.1:8080/hook")).rejects.toThrow(SsrfPolicyError);
      await expect(assertSafeDestinationUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(SsrfPolicyError);
      await expect(assertSafeDestinationUrl("http://192.168.1.50/agent")).rejects.toThrow(SsrfPolicyError);
      await expect(assertSafeDestinationUrl("http://[::1]:3000/agent")).rejects.toThrow(SsrfPolicyError);
    });

    it("fails closed when host allowlist is empty", async () => {
      await expect(
        assertSafeDestinationUrl("https://example.com/hook", { allowedHosts: [] })
      ).rejects.toThrow("Webhook execution requires an explicit host allowlist (empty allowlist fails closed).");
    });

    it("rejects domains that resolve to forbidden private IPs (DNS rebinding check)", async () => {
      const mockLookup = jest.fn().mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ]);
      await expect(
        assertSafeDestinationUrl(
          "https://rebound.evil.com/hook",
          { allowedHosts: ["rebound.evil.com"] },
          mockLookup as any
        )
      ).rejects.toThrow(/resolved to forbidden IP "127.0.0.1"/);
    });

    it("rejects domains not matching host allowlist when configured", async () => {
      const mockLookup = jest.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]);
      await expect(
        assertSafeDestinationUrl(
          "https://unapproved.com/agent",
          { allowedHosts: ["approved.com", "*.partner.org"] },
          mockLookup as any
        )
      ).rejects.toThrow(/is not allowed by the server allowlist/);
    });

    it("approves domains matching wildcard or exact host allowlist", async () => {
      const mockLookup = jest.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]);
      const url1 = await assertSafeDestinationUrl(
        "https://api.partner.org/webhook",
        { allowedHosts: ["*.partner.org"] },
        mockLookup as any
      );
      expect(url1.hostname).toBe("api.partner.org");

      const url2 = await assertSafeDestinationUrl(
        "https://approved.com/webhook",
        { allowedHosts: ["approved.com"] },
        mockLookup as any
      );
      expect(url2.hostname).toBe("approved.com");
    });
  });

  describe("createPinnedSsrfDispatcher", () => {
    function getConnectLookup(agent: any) {
      const optionsSymbol = Object.getOwnPropertySymbols(agent).find((s) => s.description === "options");
      return optionsSymbol ? agent[optionsSymbol]?.connect?.lookup : undefined;
    }

    it("pins connection lookup and blocks DNS rebinding at socket connection time", (done) => {
      // Simulate DNS resolving to a private IP at connection time
      const rebindingLookup = (_hostname: string, _opts: any, cb: any) => {
        cb(null, [{ address: "10.0.0.1", family: 4 }]);
      };

      const agent = createPinnedSsrfDispatcher({ allowPrivateIps: false }, rebindingLookup);
      const connectLookup = getConnectLookup(agent);

      expect(typeof connectLookup).toBe("function");

      connectLookup("rebound.evil.com", {}, (err: Error | null) => {
        expect(err).toBeInstanceOf(SsrfPolicyError);
        expect(err?.message).toContain("Blocked at connection time: DNS for \"rebound.evil.com\" resolved to forbidden address \"10.0.0.1\"");
        done();
      });
    });

    it("permits public IPs through connection-time lookup", (done) => {
      const publicLookup = (_hostname: string, _opts: any, cb: any) => {
        cb(null, [{ address: "93.184.216.34", family: 4 }]);
      };

      const agent = createPinnedSsrfDispatcher({ allowPrivateIps: false }, publicLookup);
      const connectLookup = getConnectLookup(agent);

      connectLookup("public.example.com", {}, (err: Error | null, addresses: any) => {
        expect(err).toBeNull();
        expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
        done();
      });
    });

    it("blocks IP literals at connection time if forbidden", (done) => {
      const agent = createPinnedSsrfDispatcher({ allowPrivateIps: false });
      const connectLookup = getConnectLookup(agent);

      connectLookup("169.254.169.254", {}, (err: Error | null) => {
        expect(err).toBeInstanceOf(SsrfPolicyError);
        expect(err?.message).toContain("Blocked at connection time: IP \"169.254.169.254\" is a forbidden address");
        done();
      });
    });

    it("actively blocks undici fetch connection establishment when socket lookup returns private IP", async () => {
      const { fetch: undiciFetch } = await import("undici");
      const dispatcher = createPinnedSsrfDispatcher({ allowPrivateIps: false }, (_hostname, _opts, cb) => {
        cb(null, [{ address: "10.0.0.1", family: 4 }]);
      });
      try {
        let caughtErr: any;
        try {
          await undiciFetch("http://example.com/test", { dispatcher });
        } catch (err) {
          caughtErr = err;
        }
        expect(caughtErr).toBeDefined();
        expect(caughtErr.message || caughtErr.cause?.message).toMatch(/fetch failed|Blocked at connection time/);
      } finally {
        await dispatcher.close();
      }
    });

    it("cleans up dispatcher resources cleanly on close", async () => {
      const dispatcher = createPinnedSsrfDispatcher({ allowPrivateIps: false });
      await expect(dispatcher.close()).resolves.toBeDefined();
    });
  });

  describe("webhookPolicyFromEnvironment", () => {
    it("parses defaults", () => {
      const policy = webhookPolicyFromEnvironment({});
      expect(policy.enabled).toBe(false);
      expect(policy.allowPrivateIps).toBe(false);
      expect(policy.maxResponseBytes).toBe(2 * 1024 * 1024);
      expect(policy.defaultTimeoutMs).toBe(30_000);
    });

    it("parses custom configuration", () => {
      const policy = webhookPolicyFromEnvironment({
        WEBHOOK_AGENT_ENABLED: "true",
        WEBHOOK_AGENT_ALLOWED_HOSTS: "host1.com, host2.com",
        WEBHOOK_AGENT_ALLOW_PRIVATE_IPS: "true",
        WEBHOOK_AGENT_MAX_RESPONSE_BYTES: "5000000",
        WEBHOOK_AGENT_DEFAULT_TIMEOUT_MS: "15000",
      });
      expect(policy.enabled).toBe(true);
      expect(policy.allowedHosts).toEqual(["host1.com", "host2.com"]);
      expect(policy.allowPrivateIps).toBe(true);
      expect(policy.maxResponseBytes).toBe(5000000);
      expect(policy.defaultTimeoutMs).toBe(15000);
    });
  });
});
