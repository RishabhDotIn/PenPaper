import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

/**
 * Development is the default because it is fast and every interaction test
 * works there. `E2E_PRODUCTION=1` builds and serves the real production
 * bundle, which is the only place the service worker's offline shell and the
 * bundle's actual chunk names are meaningful (the dev HMR client is rehashed
 * between server starts and cannot be cached).
 */
const production = process.env.E2E_PRODUCTION === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: production ? "pnpm build && pnpm start" : "pnpm dev",
    url: baseURL,
    reuseExistingServer: !production && !process.env.CI,
    timeout: 300_000,
    // Tests run without a Google client id on purpose: the local-only app is the
    // default, and Drive cannot be exercised without a real account anyway.
    env: {
      PORT: String(PORT),
      ...(production ? { NEXT_PUBLIC_E2E: "1" } : {}),
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "",
    },
  },
});
