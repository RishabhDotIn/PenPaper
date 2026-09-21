import { expect, test } from "@playwright/test";

/**
 * The fifth non-negotiable in the design doc: a 1,000-element board must not
 * collapse the frame rate. The measured value is the renderer's own frame body
 * (cull + layout + paint commands), because requestAnimationFrame intervals are
 * pinned to the display refresh rate and say nothing about headroom.
 */
test.describe("performance", () => {
  test("1,000 elements render within the frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/perf");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.waitForFunction(() => typeof window.__seedPerfBoard === "function");
    const median = await page.evaluate(() => {
      const seed = window.__seedPerfBoard;
      if (!seed) throw new Error("perf hook missing");
      return seed(1000);
    });

    await expect(page.locator("main")).toHaveAttribute("data-elements", "1000");
    console.log(`median frame body: ${median.toFixed(2)} ms at 1,000 elements`);
    test.info().annotations.push({
      type: "perf",
      description: `median frame body ${median.toFixed(2)} ms at 1,000 elements`,
    });

    expect(median).toBeGreaterThan(0);
    expect(median).toBeLessThanOrEqual(16);
  });
});
