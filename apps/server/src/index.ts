import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRunsRouter } from "./api/runs";

const app = new Hono();
const webOrigins = (process.env.WEB_ORIGIN ?? (process.env.NODE_ENV === "production" ? "http://localhost:3000" : "http://localhost:3000,http://localhost:3001")).split(",").map((origin) => origin.trim());
app.use("/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && webOrigins.includes(origin)) c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  await next();
});
app.options("/*", (c) => c.body(null, 204));
app.get("/health", (c) => c.json({ ok: true }));
app.route("/runs", createRunsRouter().app);

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));

export { app };
