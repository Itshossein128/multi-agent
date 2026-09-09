import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { assertNoCredentials, migrateToolRecord, validateTool, type ToolRecord } from "@multi-agent/types";
import { toolExecutorFactory, UnsupportedToolCategoryError } from "../../../../src/tools";

export interface ToolTestRequest {
  tool: ToolRecord;
  input: Record<string, unknown>;
}

export function createToolsRouter() {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Tool request is too large." }, 413) }));
  app.post("/test", async (c) => {
    try {
      const body = await c.req.json<ToolTestRequest>();
      if (!body.tool || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) return c.json({ error: "tool and sample input object are required" }, 400);
      assertNoCredentials(body.tool);
      const tool = migrateToolRecord(body.tool);
      const errors = validateTool(tool);
      if (errors.length) return c.json({ error: errors.join(" ") }, 400);
      if (tool.enabled === false) return c.json({ error: "Tool is disabled." }, 400);
      const output = await toolExecutorFactory.create(tool.category).execute({ tool, input: body.input });
      return c.json({ output });
    } catch (error) {
      if (error instanceof UnsupportedToolCategoryError) return c.json({ error: error.message }, 400);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  return app;
}
