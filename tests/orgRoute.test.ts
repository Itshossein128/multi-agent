import { executionApiBase, orgPath, setCurrentOrgSlug, getCurrentOrgSlug } from "../apps/web/src/lib/orgRoute";

describe("orgRoute helpers", () => {
  afterEach(() => {
    setCurrentOrgSlug(null);
  });

  it("builds org-scoped paths and execution BFF base", () => {
    expect(orgPath("Acme", "/projects")).toBe("/o/Acme/projects");
    expect(orgPath("acme", "")).toBe("/o/acme");
    expect(executionApiBase()).toBe("/api/execution");
    setCurrentOrgSlug("Acme");
    expect(getCurrentOrgSlug()).toBe("acme");
    expect(executionApiBase()).toBe("/api/o/acme/execution");
    expect(executionApiBase("other")).toBe("/api/o/other/execution");
  });
});

test("the browser URL determines the first request before provider effects run", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/o/beta/projects" } } });
  try {
    setCurrentOrgSlug("acme");
    expect(executionApiBase()).toBe("/api/o/beta/execution");
  } finally { delete (globalThis as { window?: unknown }).window; setCurrentOrgSlug(null); }
});
