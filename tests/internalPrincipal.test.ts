import { createInternalPrincipalAssertion, verifyInternalPrincipalAssertion } from "../src/auth/internalPrincipal";
import { resolveRequestPrincipal, INTERNAL_PRINCIPAL_HEADER } from "../apps/server/src/auth/principal";

test("execution-side verifier rejects forged, unsigned, and expired assertions", () => {
  const assertion = createInternalPrincipalAssertion({ userId: "user-a", tenantId: "tenant-a" }, "test-secret", 1_000);
  expect(verifyInternalPrincipalAssertion(assertion, "test-secret", 2_000)).toEqual({ userId: "user-a", tenantId: "tenant-a" });
  expect(verifyInternalPrincipalAssertion(assertion, "wrong-secret", 2_000)).toBeNull(); // forged with another secret
  const [body] = assertion.split(".");
  expect(verifyInternalPrincipalAssertion(body, "test-secret", 2_000)).toBeNull(); // unsigned
  expect(verifyInternalPrincipalAssertion(`${assertion}x`, "test-secret", 2_000)).toBeNull();
  expect(verifyInternalPrincipalAssertion(assertion, "test-secret", 62_000)).toBeNull();
});

test("server principal resolver rejects browser-supplied identity and accepts only signed transport", () => {
  expect(resolveRequestPrincipal(new Request("http://x", { headers: { "X-User-Id": "a", "X-Tenant-Id": "b" } }), "secret")).toBeNull();
  const assertion = createInternalPrincipalAssertion({ userId: "a", tenantId: "b" }, "secret");
  expect(resolveRequestPrincipal(new Request("http://x", { headers: { [INTERNAL_PRINCIPAL_HEADER]: assertion } }), "secret")).toEqual({ userId: "a", tenantId: "b" });
});
