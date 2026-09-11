"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInternalPrincipalAssertion = createInternalPrincipalAssertion;
exports.verifyInternalPrincipalAssertion = verifyInternalPrincipalAssertion;
const node_crypto_1 = require("node:crypto");
const sign = (body, secret) => (0, node_crypto_1.createHmac)("sha256", secret).update(body).digest("base64url");
function createInternalPrincipalAssertion(principal, secret, now = Date.now()) {
    if (!secret || !principal.userId || !principal.tenantId)
        throw new Error("Internal principal secret and identity are required.");
    const body = Buffer.from(JSON.stringify({ ...principal, exp: now + 60_000, nonce: (0, node_crypto_1.randomUUID)() })).toString("base64url");
    return `${body}.${sign(body, secret)}`;
}
function verifyInternalPrincipalAssertion(value, secret, now = Date.now()) {
    if (!value || !secret)
        return null;
    const [body, signature, extra] = value.split(".");
    if (!body || !signature || extra)
        return null;
    const expected = Buffer.from(sign(body, secret)), received = Buffer.from(signature);
    if (expected.length !== received.length || !(0, node_crypto_1.timingSafeEqual)(expected, received))
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(body, "base64url").toString());
        return typeof parsed.userId === "string" && typeof parsed.tenantId === "string" && typeof parsed.nonce === "string" && parsed.exp > now ? { userId: parsed.userId, tenantId: parsed.tenantId } : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=internalPrincipal.js.map