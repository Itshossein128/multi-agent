"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validVector = validVector;
exports.sameEmbedding = sameEmbedding;
exports.embedSafely = embedSafely;
function validVector(vector, dimensions) {
    return Array.isArray(vector) && dimensions > 0 && vector.length === dimensions && vector.every(Number.isFinite) && vector.some(n => n !== 0);
}
function sameEmbedding(a, b) {
    return !!a && a.provider === b.provider && a.model === b.model && a.version === b.version && a.dimensions === b.dimensions;
}
/** A failed or slow embedding service never disables lexical memory. */
async function embedSafely(provider, text, timeoutMs) {
    if (!provider)
        return undefined;
    let timer;
    try {
        const vector = await Promise.race([Promise.resolve().then(() => provider.embed(text)), new Promise(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); })]);
        return vector && validVector(vector, provider.metadata.dimensions) ? vector : undefined;
    }
    catch {
        return undefined;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=embedding.js.map