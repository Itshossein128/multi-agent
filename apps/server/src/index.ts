import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRunsRouter } from "./api/runs";

const app = new Hono();
app.use("/*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", process.env.WEB_ORIGIN ?? "http://localhost:3000");
  c.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
});
app.options("/*", (c) => c.body(null, 204));
app.get("/health", (c) => c.json({ ok: true }));
app.route("/runs", createRunsRouter().app);

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));

export { app };
