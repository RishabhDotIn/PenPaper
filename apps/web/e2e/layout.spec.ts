import { expect, test } from "@playwright/test";
import { pickTool } from "./helpers";

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

      const buttons = page.getByTestId("tool-dock").locator("button");
      await expect(buttons).toHaveCount(9);

      const boxes = await buttons.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().toJSON()),
      );

      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  });

  test("the geometry button opens its menu above the dock on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    const dock = await page.getByTestId("tool-dock").boundingBox();
    await page.getByTestId("tool-shapes").click();

    const menu = page.getByTestId("shape-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button")).toHaveCount(6);

    // Above the dock, not over it and not off-screen.
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(dock!.y);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    // Choosing one arms it, shows it on the dock button, and closes the menu.
    await menu.getByTestId("shape-diamond").click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("tool-shapes")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tool-shapes")).toHaveAttribute("aria-label", "Shapes (Diamond)");
  });

  test("the geometry menu opens beside the dock on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    const dock = await page.getByTestId("tool-dock").boundingBox();
    await page.getByTestId("tool-shapes").click();

    const box = await page.getByTestId("shape-menu").boundingBox();
    expect(box).not.toBeNull();
    // To the right of the vertical dock, vertically inside the viewport.
    expect(box!.x).toBeGreaterThanOrEqual(dock!.x + dock!.width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });

  test("picking a tool marks it pressed and reaches the engine", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");

    // `data-ready` flips once the canvas is sized and the controller exists;
    // clicking before hydration would silently do nothing.
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await pickTool(page, "rectangle");
    await expect(page.getByTestId("tool-shapes")).toHaveAttribute("aria-pressed", "true");

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

  test("a newly added shape is reachable from the same menu", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await pickTool(page, "star");

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 220, box!.y + 220);
    await page.mouse.down();
    await page.mouse.move(box!.x + 340, box!.y + 320, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator(".pp-properties-desktop").getByTestId("properties-panel")).toContainText(
      "1 star",
    );
  });

  test("a handle resizes a freshly drawn shape while the shape tool is still armed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await pickTool(page, "rectangle");
    const canvas = page.getByRole("application");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 220, box!.y + 220);
    await page.mouse.down();
    await page.mouse.move(box!.x + 340, box!.y + 300, { steps: 6 });
    await page.mouse.up();

    const panel = page.locator(".pp-properties-desktop").getByTestId("properties-panel");
    await expect(panel).toContainText("1 rectangle");

    // Grab the south-east corner and drag it further out. If the armed shape
    // tool won this press there would be two rectangles instead of one bigger.
    await page.mouse.move(box!.x + 340, box!.y + 300);
    await page.mouse.down();
    await page.mouse.move(box!.x + 400, box!.y + 340, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");
    // The shape tool is still armed, exactly as it was before the drag.
    await expect(page.getByTestId("tool-shapes")).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toContainText("1 rectangle");
  });

  test("one drag is one undo step", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await pickTool(page, "rectangle");

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
    await expect(page.locator("main")).toHaveAttribute("data-elements", "0");

    await page.keyboard.press("Control+Shift+z");

    // Redo restores the element but deliberately not the selection, so pick it
    // up again to prove it is actually back on the canvas.
    await page.getByTestId("tool-dock").locator('[data-tool="select"]').click();
    await page.mouse.click(box!.x + 260, box!.y + 240);
    await expect(panel).toContainText("1 rectangle");
  });

  test("the laser leaves light, not ink", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    const canvas = page.getByRole("application");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const pixelSnapshot = () =>
      canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());

    const before = await pixelSnapshot();

    await pickTool(page, "laser");
    await expect(page.getByTestId("tool-dock").locator('[data-tool="laser"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 300, box!.y + 260, { steps: 10 });
    await page.mouse.move(box!.x + 380, box!.y + 180, { steps: 10 });
    await page.mouse.up();

    // A frame to paint the trail, then the light is on screen.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const during = await pixelSnapshot();
    expect(during).not.toBe(before);

    // No element, no undo step: waving at the board is not a drawing.
    await expect(page.locator("main")).toHaveAttribute("data-elements", "0");

    // And it clears itself, leaving the board exactly as it was.
    await page.waitForTimeout(1200);
    expect(await pixelSnapshot()).toBe(before);
  });
});
