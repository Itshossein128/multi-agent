import type { Hono } from "hono";
import type { PrincipalVariables } from "../shared/http";
import type { OrganizationProfileService } from "./organizationProfileService";

export function registerOrganizationProfileRoutes(
  app: Hono<{ Variables: PrincipalVariables }>,
  profiles: OrganizationProfileService,
) {
  app.get("/organizations/current", async (c) => c.json(await profiles.getCurrent(c.get("principal"))));
  app.post("/organizations", async (c) =>
    c.json(await profiles.create(await c.req.json().catch(() => ({})), c.get("principal")), 201),
  );
}
