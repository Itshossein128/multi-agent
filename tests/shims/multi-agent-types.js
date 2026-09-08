/** Jest shim � keep types-bundle.js in sync via: pnpm --filter @multi-agent/types build && copy packages/types/dist/index.js tests/shims/types-bundle.js */
module.exports = require('./types-bundle.js');
