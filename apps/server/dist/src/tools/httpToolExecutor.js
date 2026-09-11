"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpToolExecutor = void 0;
/** Executes a configured HTTP endpoint; callers cannot replace its destination through input. */
class HttpToolExecutor {
    fetchImpl;
    constructor(fetchImpl = fetch) {
        this.fetchImpl = fetchImpl;
    }
    async execute({ tool, input, signal }) {
        const rawUrl = tool.configuration.url;
        if (typeof rawUrl !== "string")
            throw new Error(`HTTP tool "${tool.name}" requires a string configuration.url.`);
        let url;
        try {
            url = new URL(rawUrl);
        }
        catch {
            throw new Error(`HTTP tool "${tool.name}" has an invalid configuration.url.`);
        }
        if (url.protocol !== "http:" && url.protocol !== "https:")
            throw new Error(`HTTP tool "${tool.name}" only permits http(s) URLs.`);
        const method = String(tool.configuration.method ?? "GET").toUpperCase();
        if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method))
            throw new Error(`HTTP tool "${tool.name}" has an unsupported HTTP method.`);
        const response = await this.fetchImpl(url, {
            method,
            headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
            body: method === "GET" ? undefined : JSON.stringify(input),
            signal,
        });
        const body = await response.json().catch(async () => await response.text());
        if (!response.ok)
            throw new Error(`HTTP tool "${tool.name}" returned ${response.status}.`);
        return { status: response.status, body };
    }
}
exports.HttpToolExecutor = HttpToolExecutor;
//# sourceMappingURL=httpToolExecutor.js.map