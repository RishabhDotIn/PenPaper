import { expect, test } from "@playwright/test";

/**
 * Installability is a set of boring facts: a valid manifest, icons that load,
 * a worker that activates, and a shell that still opens offline. The service
 * worker is production-only in normal runs, so these tests opt in with `?sw=1`.
 */
test.describe("PWA surface", () => {
  test("the manifest and its icons are valid", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);

    const manifest = (await response.json()) as {
      name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    };

    expect(manifest.name).toContain("PenPaper");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");

    for (const size of ["192", "512"]) {
      const icon = manifest.icons.find((candidate) => candidate.sizes === `${size}x${size}`);
      expect(icon, `missing ${size}px icon`).toBeDefined();

      const iconResponse = await request.get(icon!.src);
      expect(iconResponse.ok(), `${icon!.src} did not load`).toBe(true);
      expect(iconResponse.headers()["content-type"]).toContain("image/png");
    }

    expect(manifest.icons.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);
  });

  test("the service worker activates and the board opens offline", async ({ page, context }) => {
    test.skip(
      process.env.E2E_PRODUCTION !== "1",
      "The offline shell is asserted against a production build; dev HMR chunks are rehashed.",
    );

    await page.goto("/b/offline?sw=1");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    // `ready` can resolve while the worker is still activating; poll the state
    // instead of assuming the two are synchronous.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration("/");
            return registration?.active?.state ?? null;
          }),
        { timeout: 15_000 },
      )
      .toBe("activated");

    // `clients.claim()` runs during activation; the page must be controlled
    // before an offline reload can be served from the cache.
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
        timeout: 15_000,
      })
      .toBe(true);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await expect(page.getByTestId("tool-button").first()).toBeVisible();
  });
});
