"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
require("dotenv/config");
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const runs_1 = require("./api/runs");
const app = new hono_1.Hono();
exports.app = app;
app.use("/*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", process.env.WEB_ORIGIN ?? "http://localhost:3000");
    c.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
    c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
});
app.options("/*", (c) => c.body(null, 204));
app.get("/health", (c) => c.json({ ok: true }));
app.route("/runs", (0, runs_1.createRunsRouter)().app);
const port = Number(process.env.PORT ?? 4000);
(0, node_server_1.serve)({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));
//# sourceMappingURL=index.js.map