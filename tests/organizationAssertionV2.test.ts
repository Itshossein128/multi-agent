import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
} from "../src/auth/internalPrincipal";
import { resolveRequestPrincipal, INTERNAL_PRINCIPAL_HEADER } from "../apps/server/src/auth/principal";

describe("principal assertion v2", () => {
  it("signs and verifies { userId, organizationId, exp, nonce, v: 2 }", () => {
    const assertion = createInternalPrincipalAssertion(
      { userId: "user-a", organizationId: "org-a" },
      "test-secret",
      1_000,
    );
    const verified = verifyInternalPrincipalAssertion(assertion, "test-secret", 2_000);
    expect(verified).toEqual({
      userId: "user-a",
      tenantId: "org-a",
      organizationId: "org-a",
      principalKind: "user",
    });

    const [body] = assertion.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    expect(payload.v).toBe(2);
    expect(payload.organizationId).toBe("org-a");
    expect(payload.tenantId).toBeUndefined();
    expect(typeof payload.nonce).toBe("string");
    expect(payload.exp).toBe(1_000 + 60_000);
  });

  it("rejects legacy v1 assertions lacking v: 2 or organizationId", () => {
    const { createHmac } = require("node:crypto");
    const legacyPayload = {
      userId: "user-b",
      tenantId: "tenant-b",
      nonce: "legacy-nonce-123",
      exp: 100_000,
    };
    const body = Buffer.from(JSON.stringify(legacyPayload)).toString("base64url");
    const sig = createHmac("sha256", "test-secret").update(body).digest("base64url");
    const legacyAssertion = `${body}.${sig}`;
    expect(verifyInternalPrincipalAssertion(legacyAssertion, "test-secret", 2_000)).toBeNull();
  });

  it("rejects assertion replay when nonce is reused within validity window", () => {
    const assertion = createInternalPrincipalAssertion(
      { userId: "user-replay", organizationId: "org-replay" },
      "test-secret",
      1_000,
    );
    const verified = verifyInternalPrincipalAssertion(assertion, "test-secret", 2_000);
    expect(verified).not.toBeNull();
    expect(verified?.organizationId).toBe("org-replay");

    // Replay with identical nonce fails
    const replayed = verifyInternalPrincipalAssertion(assertion, "test-secret", 2_001);
    expect(replayed).toBeNull();

    // Fresh assertion with distinct nonce succeeds
    const fresh = createInternalPrincipalAssertion(
      { userId: "user-replay", organizationId: "org-replay" },
      "test-secret",
      1_000,
    );
    const verifiedFresh = verifyInternalPrincipalAssertion(fresh, "test-secret", 2_002);
    expect(verifiedFresh).not.toBeNull();
  });

  it("rejects forged, unsigned, and expired v2 assertions", () => {
    const assertion = createInternalPrincipalAssertion(
      { userId: "user-a", organizationId: "org-a" },
      "test-secret",
      1_000,
    );
    expect(verifyInternalPrincipalAssertion(assertion, "wrong-secret", 2_000)).toBeNull();
    const [body] = assertion.split(".");
    expect(verifyInternalPrincipalAssertion(body, "test-secret", 2_000)).toBeNull();
    expect(verifyInternalPrincipalAssertion(assertion, "test-secret", 62_000)).toBeNull();
  });

  it("server resolver accepts signed v2 transport only", () => {
    expect(
      resolveRequestPrincipal(
        new Request("http://x", { headers: { "X-User-Id": "a", "X-Organization-Id": "b" } }),
        "secret",
      ),
    ).toBeNull();
    const assertion = createInternalPrincipalAssertion({ userId: "a", organizationId: "b" }, "secret");
    expect(
      resolveRequestPrincipal(new Request("http://x", { headers: { [INTERNAL_PRINCIPAL_HEADER]: assertion } }), "secret"),
    ).toEqual({ userId: "a", tenantId: "b", organizationId: "b", principalKind: "user" });
  });
});
