"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryAccessResolver = createMemoryAccessResolver;
exports.memoryAccessResolverFromEnvironment = memoryAccessResolverFromEnvironment;
const node_crypto_1 = require("node:crypto");
const types_1 = require("@multi-agent/types");
const digest = (value) => (0, node_crypto_1.createHash)("sha256").update(value).digest();
/** Tokens and grants are provisioned on the server; request IDs never create grants. */
function createMemoryAccessResolver(principals) {
    const configured = principals.map(({ token, ...access }) => {
        if (typeof token !== "string" || token.length < 24 || !access.principalId || !access.tenantId
            || !Array.isArray(access.readableNamespaces) || !Array.isArray(access.writableNamespaces)
            || access.readableNamespaces.length > 100 || access.writableNamespaces.length > 100
            || !access.readableNamespaces.every(types_1.isMemoryNamespace) || !access.writableNamespaces.every(types_1.isMemoryNamespace)) {
            throw new Error("Invalid server memory principal configuration.");
        }
        return { tokenHash: digest(token), access: structuredClone(access) };
    });
    return async (request) => {
        const authorization = request.headers.get("Authorization");
        if (!authorization?.startsWith("Bearer "))
            return null;
        const hash = digest(authorization.slice(7));
        const match = configured.find((principal) => (0, node_crypto_1.timingSafeEqual)(principal.tokenHash, hash));
        return match ? structuredClone(match.access) : null;
    };
}
function memoryAccessResolverFromEnvironment() {
    const raw = process.env.MEMORY_PRINCIPALS;
    if (!raw)
        return async () => null;
    try {
        const principals = JSON.parse(raw);
        if (!Array.isArray(principals) || principals.length > 100)
            throw new Error();
        return createMemoryAccessResolver(principals);
    }
    catch {
        throw new Error("MEMORY_PRINCIPALS must contain valid server-owned principal/grant configuration.");
    }
}
//# sourceMappingURL=access.js.map