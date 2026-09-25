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

test.describe("compact style pill", () => {
  test("hugs its content and stays centred on a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openBoard(page);
    await page.locator('[data-tool="freedraw"]').click();

    const pill = page.getByTestId("quick-properties");
    await expect(pill).toBeVisible();

    const box = await pill.boundingBox();
    expect(box).not.toBeNull();
    // Content-width, not the old edge-to-edge band.
    expect(box!.width).toBeLessThan(420);
    expect(Math.abs(box!.x + box!.width / 2 - 450)).toBeLessThan(2);

    const dock = await page.locator(".pp-dock").boundingBox();
    expect(dock).not.toBeNull();
    expect(dock!.y).toBeGreaterThan(box!.y + box!.height);
  });

  test.describe("360 px phone", () => {
    test.use({
      viewport: { width: 360, height: 780 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test("the pill and dock fit without horizontal overflow", async ({ page }) => {
      await openBoard(page);

      const pill = page.getByTestId("quick-properties");
      await expect(pill).toBeVisible();

      const box = await pill.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);

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

  test("the colour bar is usable before the first stroke", async ({ page }) => {
    await openBoard(page);

    // The phone opens with the pen, so the quick style bar is already there.
    const quick = page.getByTestId("quick-properties");
    await expect(quick).toBeVisible();

    const red = quick.getByRole("button", { name: "Stroke #e03131" });
    await red.click();
    await expect(red).toHaveAttribute("aria-pressed", "true");

    await quick.getByRole("button", { name: "Style" }).click();
    await expect(page.locator(".pp-sheet")).toBeVisible();
    await expect(page.locator(".pp-sheet")).toContainText("Style");
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
