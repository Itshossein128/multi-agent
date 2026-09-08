module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Generated .js siblings can be stale; tests must exercise the TypeScript source.
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.ts", "**/*.spec.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { baseUrl: ".", paths: { "@/*": ["apps/web/src/*"] } } }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/apps/web/src/$1",
    "^@multi-agent/types$": "<rootDir>/packages/types/src/index.ts",
  },
};
