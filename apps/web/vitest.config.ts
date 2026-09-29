import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Node environment: these cover the storage and store logic that runs before
 * React mounts. Component behaviour is covered by Playwright against a real
 * browser, which is the only place canvas and IndexedDB behave for real.
 *
 * The `@/` alias mirrors tsconfig; Next resolves it in the app, Vitest needs to
 * be told explicitly.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "store/**/*.test.ts"],
  },
});
