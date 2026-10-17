import type { Hono } from "hono";
import type { PrincipalVariables } from "../shared/http";
import type { OrganizationProfileService } from "./organizationProfileService";

export function registerOrganizationProfileRoutes(
  app: Hono<{ Variables: PrincipalVariables }>,
  profiles: OrganizationProfileService,
) {
  app.get("/organizations/current", async (c) => c.json(await profiles.getCurrent(c.get("principal"))));
  app.get("/organizations/current/members", async (c) =>
    c.json(await profiles.listMembers(c.get("principal"))),
  );
  app.get("/me/organizations", async (c) => c.json(await profiles.listMine(c.get("principal"))));
  app.post("/organizations", async (c) =>
    c.json(await profiles.create(await c.req.json().catch(() => ({})), c.get("principal")), 201),
  );
  app.patch("/organizations/current", async (c) =>
    c.json(await profiles.updateCurrent(await c.req.json().catch(() => ({})), c.get("principal"))),
  );
  app.delete("/organizations/current", async (c) => {
    const result = await profiles.deleteCurrent(await c.req.json().catch(() => ({})), c.get("principal"));
    return c.json(result, result.status === "pending" ? 202 : 200);
  });
}
