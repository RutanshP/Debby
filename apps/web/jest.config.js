const nextJest = require("next/jest.js");

const createJestConfig = nextJest({ dir: "./" });

module.exports = createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/test-utils/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // react-markdown and its remark/rehype dep tree ship pure ESM; mocking
    // it for tests avoids a swc transform pass on a deep graph of packages.
    "^react-markdown$": "<rootDir>/__mocks__/react-markdown.tsx",
  },
});
