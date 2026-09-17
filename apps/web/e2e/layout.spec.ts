import { expect, test } from "@playwright/test";

/**
 * Chrome layout, not canvas pixels.
 *
 * The canvas itself is verified by the engine's unit tests plus manual device
 * passes; these tests exist because "the toolbar is on the wrong side of the
 * screen" is a class of bug that only a real browser catches.
 */
test.describe("responsive chrome", () => {
  test("dock is horizontal on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/b/local");

    const rect = await page.getByTestId("tool-dock").boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.width).toBeGreaterThan(rect!.height);
  });

  test("dock is vertical on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");

    const rect = await page.getByTestId("tool-dock").boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeGreaterThan(rect!.width);
  });

  test.describe("coarse pointer", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("every dock button is at least 44px", async ({ page }) => {
      await page.goto("/b/local");

      const buttons = page.getByTestId("tool-button");
      await expect(buttons).toHaveCount(10);

      const boxes = await buttons.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().toJSON()),
      );

      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  });

  test("picking a tool marks it pressed and reaches the engine", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");

    // `data-ready` flips once the canvas is sized and the controller exists;
    // clicking before hydration would silently do nothing.
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    const rectangle = page.getByTestId("tool-button").nth(2);
    await rectangle.click();
    await expect(rectangle).toHaveAttribute("aria-pressed", "true");

    // The canvas is live: a drag with the rectangle tool must leave a shape
    // behind, which is only observable through the selection overlay.
    const canvas = page.getByRole("application");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 320, box!.y + 280, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator(".pp-properties-desktop").getByTestId("properties-panel")).toContainText(
      "1 rectangle",
    );
  });

  test("one drag is one undo step", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.getByTestId("tool-button").nth(2).click();

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();

    // Many samples, one gesture. Undo must take the rectangle away entirely
    // rather than rewind the last pointer move.
    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(box!.x + 200 + i * 6, box!.y + 200 + i * 4);
    }
    await page.mouse.up();

    const panel = page.locator(".pp-properties-desktop").getByTestId("properties-panel");
    await expect(panel).toContainText("1 rectangle");

    await page.keyboard.press("Control+z");
    await expect(panel).toContainText("Nothing selected");

    await page.keyboard.press("Control+Shift+z");

    // Redo restores the element but deliberately not the selection, so pick it
    // up again to prove it is actually back on the canvas.
    await page.getByTestId("tool-button").nth(1).click();
    await page.mouse.click(box!.x + 260, box!.y + 240);
    await expect(panel).toContainText("1 rectangle");
  });
});
