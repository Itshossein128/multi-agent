import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { assertNoCredentials, migrateToolRecord, validateTool, type ToolRecord } from "@multi-agent/types";
import { ToolRuntime, UnsupportedToolCategoryError } from "../../../../src/tools";
import type { StudioStore } from "../../../../src/studio/contracts";
import { resolveRequestPrincipal, authorizeToolOrAgent, type PrincipalResolver, type RequestPrincipal } from "../auth/principal";

export interface ToolTestRequest {
  tool?: ToolRecord;
  toolId?: string;
  input: Record<string, unknown>;
}

export function createToolsRouter(
  runtime: Pick<ToolRuntime, "execute"> = new ToolRuntime(),
  studioStore?: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
) {
  const app = new Hono<{ Variables: { principal: RequestPrincipal } }>();

  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Tool request is too large." }, 413) }));

  app.use("*", async (c, next) => {
    const principal = await resolvePrincipal(c.req.raw);
    if (!principal) return c.json({ error: "Authentication required." }, 401);
    c.set("principal", principal);
    await next();
  });

  app.post("/test", async (c) => {
    const principal = c.get("principal");
    try {
      const body = await c.req.json<ToolTestRequest>();
      if ((!body.tool && !body.toolId) || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
        return c.json({ error: "tool and sample input object are required" }, 400);
      }

      let toolToExecute: ToolRecord | null = null;
      const targetId = body.toolId ?? body.tool?.id;

      if (targetId && studioStore) {
        const storedTool = await studioStore.getTool(targetId);
        if (storedTool) {
          if (!authorizeToolOrAgent(principal, storedTool, "execute")) {
            return c.json({ error: "Access denied to tool." }, 404);
          }
          toolToExecute = storedTool;
        }
      }

      if (body.tool) {
        assertNoCredentials(body.tool);
        toolToExecute = migrateToolRecord(body.tool);
      }

      if (!toolToExecute) {
        return c.json({ error: "Tool not found" }, 404);
      }

      const errors = validateTool(toolToExecute);
      if (errors.length) return c.json({ error: errors.join(" ") }, 400);

      const output = await runtime.execute(toolToExecute, body.input);
      return c.json({ output });
    } catch (error) {
      if (error instanceof UnsupportedToolCategoryError) return c.json({ error: error.message }, 400);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  return app;
}
