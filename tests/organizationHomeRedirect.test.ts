jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/db", () => ({ getDbPool: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }) }), { virtual: true });
import Home from "../apps/web/src/app/(authenticated)/page";
import { auth } from "../apps/web/src/auth";
import { getDbPool } from "../apps/web/src/lib/db";
const query = jest.fn();
beforeEach(() => { jest.clearAllMocks(); (auth as jest.Mock).mockResolvedValue({ user: { id: "alice" } }); (getDbPool as jest.Mock).mockReturnValue({ query }); });
test("last active membership redirects to its organization", async () => {
  query.mockResolvedValueOnce({ rows: [{ slug: "acme" }] });
  await expect(Home()).rejects.toThrow("REDIRECT:/o/acme/");
});
test("stale last organization falls back to first active membership", async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ slug: "beta" }] });
  await expect(Home()).rejects.toThrow("REDIRECT:/o/beta/");
});
test("zero memberships redirects to creation", async () => {
  query.mockResolvedValue({ rows: [] });
  await expect(Home()).rejects.toThrow("REDIRECT:/onboarding/organization");
});
