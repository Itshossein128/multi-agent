"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoopMemoryConsolidator = void 0;
const access_1 = require("./access");
/** Explicit optional boundary. Semantic merging requires a separately selected policy. */
class NoopMemoryConsolidator {
    async consolidate(access, namespace) {
        (0, access_1.requireNamespaces)([namespace], access, true);
        return { merged: 0 };
    }
}
exports.NoopMemoryConsolidator = NoopMemoryConsolidator;
//# sourceMappingURL=memoryConsolidator.js.map