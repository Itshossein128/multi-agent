import fs from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/check-workspace-package.mjs <package.json>");
  process.exit(1);
}

const secretKey =
  /^(?:.*[_-])?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|password|secret|authorization|credentials?|private[_-]?key)$/i;
let found = false;
const visit = (item) => {
  if (typeof item === "string") {
    if (
      /\b(?:sk-|AIza)[a-zA-Z0-9_-]{12,}|Bearer\s+(?!\[redacted\])\S+|-----BEGIN .*PRIVATE KEY-----|(?:api[_-]?key|password|secret|token)\s*[:=]\s*(?!\[redacted\])[^\s"},]+/i.test(
        item,
      )
    ) {
      found = true;
    }
  } else if (Array.isArray(item)) item.forEach(visit);
  else if (item && typeof item === "object") {
    for (const [key, child] of Object.entries(item)) {
      if (
        (secretKey.test(key) ||
          /apiKey|accessToken|refreshToken|clientSecret|authToken|privateKey|password|secret|authorization|credential|^token$|^env$/i.test(
            key,
          )) &&
        child !== undefined
      ) {
        found = true;
      }
      visit(child);
    }
  }
};

const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
visit(pkg);
if (found) {
  console.error("Package appears to contain credentials and must not be committed.");
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      workflows: pkg.workflows?.length ?? 0,
      agents: pkg.agents?.length ?? 0,
      tools: pkg.tools?.length ?? 0,
    },
    null,
    2,
  ),
);
