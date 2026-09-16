import http from "node:http";

const host = process.env.DETERMINISTIC_MODEL_HOST ?? "::1";
const port = Number(process.env.DETERMINISTIC_MODEL_PORT ?? "1234");

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { status: "ok" });
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    return json(response, 404, { error: { message: "Not found" } });
  }

  try {
    const body = await readJson(request);
    const prompt = Array.isArray(body.messages)
      ? body.messages.map((message) => String(message?.content ?? "")).join("\n")
      : "";
    const content = prompt.includes("AFTER_APPROVAL_OK")
      ? "AFTER_APPROVAL_OK"
      : prompt.includes("BEFORE_APPROVAL_OK")
        ? "BEFORE_APPROVAL_OK"
        : "DETERMINISTIC_MODEL_NO_MARKER";

    return json(response, 200, {
      id: `deterministic-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: String(body.model ?? "deterministic-e2e"),
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  } catch (error) {
    return json(response, 400, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(port, host, () => {
  console.log(`deterministic model server listening at http://${host}:${port}`);
});

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy(new Error("Request body is too large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function json(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
