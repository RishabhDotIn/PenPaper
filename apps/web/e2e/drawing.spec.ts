import { expect, test, type Page } from "@playwright/test";

/**
 * Live preview, measured in canvas pixels.
 *
 * The regression these tests exist for: the renderer skipped a frame unless
 * something explicitly marked it dirty. A draft element is not selected while
 * it is being dragged, so nothing re-marked the frame and the stroke only
 * appeared when the pointer came up. Counting dark pixels mid-drag is the only
 * way to prove the user sees ink *while* drawing rather than after.
 */
async function darkPixels(page: Page): Promise<number> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 255;
      const g = data[i + 1] ?? 255;
      const b = data[i + 2] ?? 255;
      if (r < 120 && g < 120 && b < 120) dark += 1;
    }
    return dark;
  });
}

test.describe("live preview", () => {
  test("a freedraw stroke is visible while the pointer is still down", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator('[data-tool="freedraw"]').click();

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();

    expect(await darkPixels(page)).toBe(0);

    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.down();
    await page.mouse.move(box!.x + 600, box!.y + 420, { steps: 24 });

    const midStroke = await darkPixels(page);
    expect(midStroke).toBeGreaterThan(50);

    await page.mouse.up();
    expect(await darkPixels(page)).toBeGreaterThan(50);
  });

  test("a rectangle is visible while it is being dragged out", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator('[data-tool="rectangle"]').click();

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();

    expect(await darkPixels(page)).toBe(0);

    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.down();
    await page.mouse.move(box!.x + 640, box!.y + 520, { steps: 20 });

    expect(await darkPixels(page)).toBeGreaterThan(50);
    await page.mouse.up();
  });

  test("erasing removes ink immediately, not on the next gesture", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator('[data-tool="freedraw"]').click();

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.down();
    await page.mouse.move(box!.x + 600, box!.y + 300, { steps: 20 });
    await page.mouse.up();

    const drawn = await darkPixels(page);
    expect(drawn).toBeGreaterThan(50);

    await page.locator('[data-tool="eraser"]').click();
    await page.mouse.move(box!.x + 450, box!.y + 300);
    await page.mouse.down();
    await page.mouse.up();

    const afterErase = await darkPixels(page);
    expect(afterErase).toBeLessThan(drawn);
  });
});

/**
 * The DPR-2 regression. The renderer used to clear `width × height` under an
 * identity transform; on a 2× display that is only the top-left quarter of the
 * backing store, so every previous frame survived outside it. The user-visible
 * result was ghosted strokes and repeated text, and it never appeared in a
 * deviceScaleFactor-1 test.
 */
test.describe("high-DPI canvas", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test("undo leaves no ghost of the removed stroke", async ({ page }) => {
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator('[data-tool="freedraw"]').click();

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();

    // Deliberately the lower-right quadrant: that is the region the old clear
    // never touched.
    await page.mouse.move(box!.x + 250, box!.y + 520);
    await page.mouse.down();
    await page.mouse.move(box!.x + 360, box!.y + 620, { steps: 18 });
    await page.mouse.up();

    expect(await darkPixels(page)).toBeGreaterThan(50);

    await page.keyboard.press("Control+z");

    expect(await darkPixels(page)).toBe(0);
  });
});
