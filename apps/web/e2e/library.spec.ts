import { expect, test, type Page } from "@playwright/test";

/**
 * The shelf replaces the old redirect-to-a-board landing page.
 *
 * These tests run without a Google client id, which is the honest default for a
 * local build: the shelf must be fully usable, Drive must be visibly optional,
 * and nothing may wait on a network call to render.
 */

async function openShelf(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("library")).toBeVisible();
}

test.describe("shelf", () => {
  test("a fresh install has a demo to open and can start a notepad", async ({ page }) => {
    await openShelf(page);

    // The demo is seeded once, so a new install is not an empty page.
    await expect(page.getByTestId("library-card-demo")).toBeVisible();
    await expect(page.getByTestId("library-card-demo")).toContainText("PenPaper demo");

    await page.getByTestId("new-notepad").click();

    // A new notepad opens immediately; its id is a real board route.
    await expect(page).toHaveURL(/\/b\/[^/]+$/);
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("library")).toBeVisible();
    await expect(page.locator(".lib-card").filter({ hasText: "Untitled notepad" })).toBeVisible();
  });

  test("a notepad can be renamed from the shelf", async ({ page }) => {
    await openShelf(page);

    await page.getByRole("button", { name: "Rename PenPaper demo" }).click();
    const input = page.getByRole("textbox", { name: "Notepad name" });
    await expect(input).toBeFocused();
    await input.fill("Ideas for the week");
    await input.press("Enter");

    await expect(page.getByTestId("library-card-demo")).toContainText("Ideas for the week");

    // The name is device metadata, so it survives a reload.
    await page.reload();
    await expect(page.getByTestId("library-card-demo")).toContainText("Ideas for the week");
  });

  test("deleting asks once, then removes the notepad", async ({ page }) => {
    await openShelf(page);
    await page.getByTestId("new-notepad").click();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await page.goto("/");

    const card = page.locator(".lib-card").filter({ hasText: "Untitled notepad" });
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Delete Untitled notepad" }).click();
    await expect(card.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.locator(".lib-card").filter({ hasText: "Untitled notepad" })).toHaveCount(0);
  });

  test("Drive is optional and says how to turn it on", async ({ page }) => {
    await openShelf(page);

    // No client id in this build: connecting is disabled, and the shelf says
    // exactly which variable is missing instead of failing on a click.
    await expect(page.getByTestId("connect-drive")).toBeDisabled();
    await expect(page.getByTestId("drive-setup")).toContainText("NEXT_PUBLIC_GOOGLE_CLIENT_ID");

    // Auto-sync is a Drive concept; it is absent until an account is connected.
    await expect(page.getByTestId("auto-sync")).toHaveCount(0);
    // The hint already says Drive is unavailable, so the status line would only
    // repeat it.
    await expect(page.getByTestId("library-status")).toHaveCount(0);
  });

  test("the board menu leads back to the shelf", async ({ page }) => {
    await page.goto("/b/local");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await page.getByTestId("app-menu-button").click();
    const menu = page.getByRole("dialog", { name: "Board menu" });
    await menu.getByRole("button", { name: "All notepads" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("library")).toBeVisible();
  });
});

test.describe("shelf on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  test("cards fit the width and touch targets are 44 px", async ({ page }) => {
    await openShelf(page);

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBe(overflow.client);

    // Wait out the card's spring entrance; a transform mid-flight would make a
    // 44 px target measure a hair under.
    await page.getByTestId("library-card-demo").evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });

    const card = await page.getByTestId("library-card-demo").boundingBox();
    expect(card).not.toBeNull();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(390);

    const rename = await page
      .getByRole("button", { name: "Rename PenPaper demo" })
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
    expect(rename.width).toBeGreaterThanOrEqual(44);
    expect(rename.height).toBeGreaterThanOrEqual(44);
  });
});
