import { expect, test } from "@playwright/test";

/**
 * Text is the one tool where the browser, not the canvas, owns focus and the
 * caret. These tests cover the seam: the overlay appears in the right place,
 * stays large enough for iOS, and its value ends up in the scene.
 */
test.describe("text editing", () => {
  test("the overlay is at least 16px and commits to the canvas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/b/text-basic");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator("[data-tool='text']").click();

    const canvas = page.getByRole("application");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.click(box!.x + 200, box!.y + 200);

    const overlay = page.getByTestId("text-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toBeFocused();

    // Safari zooms the page when a focused control is smaller than 16px.
    const fontSize = await overlay.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(fontSize).toBeGreaterThanOrEqual(16);

    await overlay.fill("Hello PenPaper");
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);

    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    // The text survives the debounced autosave and a reload.
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    await page.locator("[data-tool='select']").click();
    await page.mouse.click(box!.x + 220, box!.y + 210);
    await expect(page.locator(".pp-properties-desktop").getByTestId("properties-panel")).toContainText(
      "1 text",
    );
  });

  test("Shift+Enter inserts a line break, Enter commits", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/b/text-newline");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator("[data-tool='text']").click();
    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 180, box!.y + 180);

    const overlay = page.getByTestId("text-overlay");
    await overlay.fill("first");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second");
    await expect(overlay).toHaveValue("first\nsecond");

    await page.keyboard.press("Enter");
    await expect(overlay).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");
  });

  test("leaving the text empty removes the element", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/b/text-empty");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.locator("[data-tool='text']").click();
    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 160, box!.y + 160);

    await expect(page.getByTestId("text-overlay")).toBeVisible();

    // Switching tools blurs the textarea, which commits and sees nothing worth
    // keeping. Clicking the canvas while the text tool is still active would
    // simply create another empty element.
    await page.locator("[data-tool='select']").click();
    await expect(page.getByTestId("text-overlay")).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute("data-elements", "0");
  });
});
