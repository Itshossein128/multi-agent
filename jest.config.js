require("dotenv").config({ path: ".env" });

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Generated .js siblings can be stale; tests must exercise the TypeScript source.
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.ts", "**/*.spec.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { baseUrl: ".", paths: { "@/*": ["apps/web/src/*"] }, jsx: "react-jsx" } }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/apps/web/src/$1",
    "^@multi-agent/types$": "<rootDir>/packages/types/src/index.ts",
    // pnpm keeps app-only dependencies in the workspace package. Map them
    // explicitly so root-level integration tests can resolve the web auth code.
    "^next-auth$": "<rootDir>/apps/web/node_modules/next-auth",
    "^next-auth/(.*)$": "<rootDir>/apps/web/node_modules/next-auth/$1",
  },
};
