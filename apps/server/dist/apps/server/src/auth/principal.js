"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_PRINCIPAL_HEADER = void 0;
exports.resolveRequestPrincipal = resolveRequestPrincipal;
const internalPrincipal_1 = require("../../../../src/auth/internalPrincipal");
exports.INTERNAL_PRINCIPAL_HEADER = "X-Multi-Agent-Principal";
function resolveRequestPrincipal(request, secret = process.env.INTERNAL_PRINCIPAL_SECRET ?? "") {
    return (0, internalPrincipal_1.verifyInternalPrincipalAssertion)(request.headers.get(exports.INTERNAL_PRINCIPAL_HEADER), secret);
}
__exportStar(require("./authorization"), exports);
//# sourceMappingURL=principal.js.map