"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
const langGraphEventAdapter_1 = require("./adapters/langGraphEventAdapter");
/** Compact JSON logger for server/runtime boundaries; never serializes request bodies or secrets. */
exports.log = {
    info(event, context = {}) { write("info", event, context); },
    warn(event, context = {}) { write("warn", event, context); },
    error(event, context = {}) { write("error", event, context); },
};
function write(level, event, context) {
    const safeContext = (0, langGraphEventAdapter_1.redact)(context);
    const record = { timestamp: new Date().toISOString(), level, event, ...safeContext };
    // One line per event keeps local and hosted log collectors machine-readable.
    console[level](JSON.stringify(record));
}
//# sourceMappingURL=logging.js.map