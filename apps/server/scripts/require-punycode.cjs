'use strict';

/**
 * Redirect Node's deprecated builtin `punycode` to the userland package.
 * Triggered by transitive deps (openai → node-fetch@2 → whatwg-url@5 / tr46).
 */
const Module = require('node:module');
const path = require('node:path');

const punycodeEntry = require.resolve('../vendor/punycode/punycode.js');

const originalLoad = Module._load;
Module._load = function loadWithUserlandPunycode(request, parent, isMain) {
  if (request === 'punycode' || request === 'node:punycode') {
    return originalLoad.call(this, punycodeEntry, parent, isMain);
  }
  return originalLoad.apply(this, arguments);
};
