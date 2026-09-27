import { expect, test, type Page } from "@playwright/test";

/**
 * The chrome the user asked for: a style panel that is usable *before* drawing,
 * and a hamburger for theme, paper, and board actions. Canvas effects are
 * verified in pixels because a screenshot cannot be asserted on.
 */
async function openBoard(page: Page): Promise<void> {
  await page.goto("/b/local");
  await expect(page.locator("main[data-ready='true']")).toBeVisible();
}

async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

interface CanvasStats {
  /** Pixels that are not pure paper white. */
  marks: number;
  center: [number, number, number];
}

async function canvasStats(page: Page): Promise<CanvasStats> {
  await settled(page);
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return { marks: 0, center: [0, 0, 0] };

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let marks = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 250 || (data[i + 1] ?? 255) < 250 || (data[i + 2] ?? 255) < 250) {
        marks += 1;
      }
    }

    // A cell centre, not the canvas centre: a grid line runs through the exact
    // middle at these viewport sizes and would mask the paper colour.
    const centre = ctx.getImageData(10, 10, 1, 1).data;
    return {
      marks,
      center: [centre[0] ?? 0, centre[1] ?? 0, centre[2] ?? 0],
    };
  });
}

async function drawBox(page: Page): Promise<void> {
  const box = await page.getByRole("application").boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 300, box!.y + 300);
  await page.mouse.down();
  await page.mouse.move(box!.x + 460, box!.y + 400, { steps: 8 });
  await page.mouse.up();
}

async function openMenu(page: Page) {
  await page.getByTestId("app-menu-button").click();
  return page.getByRole("dialog", { name: "Board menu" });
}

test.describe("style before drawing", () => {
  test("a colour chosen in the panel is used by the next shape", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    await page.locator('[data-tool="rectangle"]').click();

    const panel = page.locator(".pp-properties-desktop");
    await expect(panel).toContainText("Style");

    const red = panel.getByRole("button", { name: "Stroke #e03131" });
    await red.click();
    await expect(red).toHaveAttribute("aria-pressed", "true");

    await drawBox(page);

    // Selection now targets the shape, not the defaults, and the shape carries
    // the colour that was picked while no element existed yet.
    await expect(panel).toContainText("1 rectangle");
    await expect(panel.getByRole("button", { name: "Stroke #e03131" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a pen stroke is not wrapped in a selection box", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    await page.locator('[data-tool="freedraw"]').click();

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 200, box!.y + 220);
    await page.mouse.down();
    await page.mouse.move(box!.x + 300, box!.y + 300, { steps: 6 });
    await page.mouse.move(box!.x + 240, box!.y + 380, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    // Ink is not a transform target. Leaving it unselected keeps the panel on
    // the next stroke's style and keeps resize handles off fresh writing.
    const panel = page.locator(".pp-properties-desktop");
    await expect(panel).toContainText("Style");
    await expect(panel).not.toContainText("1 freedraw");
  });

  test("the choice survives a reload and applies to the next board", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    await page.locator('[data-tool="ellipse"]').click();
    await page
      .locator(".pp-properties-desktop")
      .getByRole("button", { name: "Stroke #1971c2" })
      .click();

    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await page.locator('[data-tool="ellipse"]').click();

    await expect(
      page.locator(".pp-properties-desktop").getByRole("button", { name: "Stroke #1971c2" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("hamburger menu", () => {
  test("theme switches the chrome and the canvas, and persists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const light = await canvasStats(page);
    expect(light.center).toEqual([255, 255, 255]);

    let menu = await openMenu(page);
    await menu.getByRole("button", { name: "Dark" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await canvasStats(page);
    expect(dark.center).toEqual([18, 18, 18]);

    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    menu = await openMenu(page);
    await expect(menu.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("canvas layout switches between plain, dotted, and box paper", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    const boxed = await canvasStats(page);
    expect(boxed.marks).toBeGreaterThan(1000);

    let menu = await openMenu(page);
    await menu.getByRole("button", { name: "Plain" }).click();
    const plain = await canvasStats(page);
    expect(plain.marks).toBe(0);

    await menu.getByRole("button", { name: "Dotted" }).click();
    const dotted = await canvasStats(page);
    expect(dotted.marks).toBeGreaterThan(0);
    expect(dotted.marks).toBeLessThan(boxed.marks);

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    menu = await openMenu(page);
    await expect(menu.getByRole("button", { name: "Dotted" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const reloaded = await canvasStats(page);
    expect(reloaded.marks).toBe(dotted.marks);
  });

  test("a paper colour repaints the board and persists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    const menu = await openMenu(page);
    await menu.getByRole("button", { name: "Cream paper" }).click();

    const cream = await canvasStats(page);
    expect(cream.center).toEqual([255, 249, 219]);

    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    const reloaded = await canvasStats(page);
    expect(reloaded.center).toEqual([255, 249, 219]);
  });

  test("the theme default is a word chip and restores the theme paper", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    const menu = await openMenu(page);
    // The old half-black circle is gone.
    await expect(menu.locator(".pp-menu-swatch-theme")).toHaveCount(0);
    const auto = menu.getByRole("button", { name: "Theme default" });
    await expect(auto).toHaveText("Auto");
    await expect(auto).toHaveAttribute("aria-pressed", "true");

    await menu.getByRole("button", { name: "Blue paper" }).click();
    expect((await canvasStats(page)).center).toEqual([231, 245, 255]);
    await expect(auto).toHaveAttribute("aria-pressed", "false");

    await auto.click();
    expect((await canvasStats(page)).center).toEqual([255, 255, 255]);
    await expect(auto).toHaveAttribute("aria-pressed", "true");
  });

  test("reset clears the board in two taps and undo brings it back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    await page.locator('[data-tool="rectangle"]').click();
    await drawBox(page);
    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    const menu = await openMenu(page);
    await menu.getByRole("button", { name: "Reset canvas" }).click();
    await expect(menu.getByRole("button", { name: "Tap again to clear" })).toBeVisible();
    await menu.getByRole("button", { name: "Tap again to clear" }).click();

    await expect(page.locator("main")).toHaveAttribute("data-elements", "0");

    await page.keyboard.press("Control+z");
    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");
  });

  test("export downloads the painted board as a PNG", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page);

    await page.locator('[data-tool="rectangle"]').click();
    await drawBox(page);

    const menu = await openMenu(page);
    const download = page.waitForEvent("download");
    await menu.getByRole("button", { name: "Export PNG" }).click();

    expect((await download).suggestedFilename()).toBe("penpaper-local.png");
  });
});

test.describe("style popover", () => {
  test("drops from the palette button, sized to its content", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 700 });
    await openBoard(page);
    await page.getByTestId("open-styles").click();

    const popover = page.locator(".pp-popover");
    await expect(popover).toBeVisible();

    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    // It starts under the palette button, not at the bottom of the screen.
    expect(Math.abs(box!.x - 12)).toBeLessThan(2);
    expect(Math.abs(box!.y - 64)).toBeLessThan(3);
    expect(box!.width).toBeLessThanOrEqual(340);
    expect(box!.height).toBeLessThan(560);

    // The card is complete: the old fixed-height sheet clipped its last section.
    await expect(popover).toContainText("Opacity");
  });

  test("a tap anywhere else dismisses the popover", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 700 });
    await openBoard(page);

    await page.getByTestId("open-styles").click();
    const popover = page.locator(".pp-popover");
    await expect(popover).toBeVisible();

    await page.locator("main").click({ position: { x: 580, y: 640 } });
    await expect(popover).toHaveCount(0);

    // Escape closes it too.
    await page.getByTestId("open-styles").click();
    await expect(popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });

  test("a tablet-width window toggles the right panel with the arrow", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openBoard(page);
    await page.locator('[data-tool="rectangle"]').click();

    const panel = page.locator(".pp-properties-desktop");
    const toggle = page.getByTestId("toggle-panel");
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await toggle.click();
    await expect(panel).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Show styles");

    // The handle stays on the screen edge while the panel is away.
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(900 - (box!.x + box!.width)).toBeLessThan(12);

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", "Hide styles");
    await expect(page.getByTestId("open-styles")).toBeHidden();
  });

  test.describe("360 px phone", () => {
    test.use({
      viewport: { width: 360, height: 780 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test("the dock fits and the popover keeps its swatches on one row", async ({ page }) => {
      await openBoard(page);

      const dock = await page.locator(".pp-dock").boundingBox();
      expect(dock).not.toBeNull();
      expect(dock!.x).toBeGreaterThanOrEqual(0);
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(360);

      await page.getByTestId("open-styles").click();
      const popover = page.locator(".pp-popover");
      await expect(popover).toBeVisible();

      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);

      // Seven 40 px swatches in a 312 px content box: one row, no tall card.
      const wrap = await page.evaluate(() => {
        const group = document.querySelector(".pp-popover .pp-swatches");
        return group ? group.getBoundingClientRect().height : 0;
      });
      expect(wrap).toBeLessThan(60);

      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBe(overflow.client);
    });
  });
});

test.describe("phone chrome", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  test("the style card opens from the top bar and edits the next stroke", async ({ page }) => {
    await openBoard(page);

    // The persistent colour bar is gone: the bottom edge is only the dock.
    await expect(page.getByTestId("quick-properties")).toHaveCount(0);
    const dock = await page.locator(".pp-dock").boundingBox();
    expect(dock).not.toBeNull();
    expect(dock!.y + dock!.height).toBeGreaterThanOrEqual(836);
    expect(844 - dock!.y).toBeLessThan(112);

    await page.getByTestId("open-styles").click();
    const popover = page.locator(".pp-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Stroke");

    // It hangs from the palette button, not from the bottom edge.
    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 12)).toBeLessThan(2);
    expect(Math.abs(box!.y - 64)).toBeLessThan(3);
    expect(box!.y + box!.height).toBeLessThan(700);

    const red = popover.getByRole("button", { name: "Stroke #e03131" });
    await red.click();
    await expect(red).toHaveAttribute("aria-pressed", "true");

    // Tapping the board itself closes it.
    await page.locator("main").click({ position: { x: 195, y: 680 } });
    await expect(popover).toHaveCount(0);
  });

  test("the menu fits the screen and stays reachable", async ({ page }) => {
    await openBoard(page);
    const menu = await openMenu(page);

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);

    await expect(menu.getByRole("button", { name: "Export PNG" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Reset canvas" })).toBeVisible();
  });
});
