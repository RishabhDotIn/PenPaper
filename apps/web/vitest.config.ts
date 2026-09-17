import { defineConfig } from "vitest/config";

/**
 * Node environment: these cover the storage and store logic that runs before
 * React mounts. Component behaviour is covered by Playwright against a real
 * browser, which is the only place canvas and IndexedDB behave for real.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "store/**/*.test.ts"],
  },
});
