jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/db", () => ({ getDbPool: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }) }), { virtual: true });
import Layout from "../apps/web/src/app/(authenticated)/onboarding/layout";
import { auth } from "../apps/web/src/auth";
import { getDbPool } from "../apps/web/src/lib/db";

const query = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "alice" } });
  (getDbPool as jest.Mock).mockReturnValue({ query });
});

test("signed-out visitors are sent to login before organization setup", async () => {
  (auth as jest.Mock).mockResolvedValue(null);
  await expect(Layout({ children: "wizard" })).rejects.toThrow("REDIRECT:/login?callbackUrl=%2Fonboarding%2Forganization");
});

test("an account that already has an organization skips setup", async () => {
  query.mockResolvedValue({ rows: [{ id: "org-1", slug: "acme" }] });
  await expect(Layout({ children: "wizard" })).rejects.toThrow("REDIRECT:/o/acme/");
});

test("an account with no organization can open setup", async () => {
  query.mockResolvedValue({ rows: [] });
  await expect(Layout({ children: "wizard" })).resolves.toBeTruthy();
});

test("a lookup failure does not open organization setup", async () => {
  query.mockRejectedValue(new Error("password authentication failed"));
  await expect(Layout({ children: "wizard" })).rejects.toThrow("password authentication failed");
});
