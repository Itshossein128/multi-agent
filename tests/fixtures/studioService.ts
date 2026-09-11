import { createStudioRouter } from "../../apps/server/src/api/studio";
import { InMemoryStudioStore } from "../../src/studio/infrastructure/in-memory-studio-store";
import { createWorkflowService } from "../../apps/web/src/services/workflowService";
import { createInternalPrincipalAssertion, type AuthenticatedPrincipal } from "../../src/auth/internalPrincipal";
import { resolveRequestPrincipal } from "../../apps/server/src/auth/principal";

const TEST_SECRET = "fixture-test-secret";
const DEFAULT_TEST_PRINCIPAL: AuthenticatedPrincipal = { userId: "test-user", tenantId: "test-tenant" };

export function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    has: (key: string) => values.has(key),
    get: (key: string) => values.get(key),
  };
}

/**
 * A per-test HTTP boundary: the production Studio router and an isolated store
 * are used directly, so these client tests never bind a port or share state.
 */
export function createTestStudioService(
  storage = memoryStorage(),
  store = new InMemoryStudioStore(),
  principal: AuthenticatedPrincipal = DEFAULT_TEST_PRINCIPAL
) {
  const app = createStudioRouter(store, (req) => {
    return resolveRequestPrincipal(req, TEST_SECRET) ?? principal;
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const source = input instanceof Request && init === undefined
      ? input
      : new Request(typeof input === "string" ? input : input.toString(), init);
    const url = new URL(source.url);
    // The production server mounts this router at /studio; the fixture hosts
    // only the router, so adapt the mount point while preserving request data.
    url.pathname = url.pathname.replace(/^\/studio(?=\/|$)/, "") || "/";
    const headers = new Headers(source.headers);
    if (!headers.has("X-Multi-Agent-Principal")) {
      headers.set("X-Multi-Agent-Principal", createInternalPrincipalAssertion(principal, TEST_SECRET));
    }
    const body = source.body;
    const request = new Request(url, {
      method: source.method,
      headers,
      body,
      // @ts-expect-error duplex required for streaming in Node Request
      duplex: "half",
    });
    return app.fetch(request);
  };
  return { store, storage, service: createWorkflowService({ fetch, storage, apiUrl: "http://studio.test" }) };
}
