import { expect, test, type Page } from "@playwright/test";

/**
 * `/` is the front door, not a shelf.
 *
 * A device that has opened a notepad goes straight back to it; a new device asks
 * once, on paper. The hamburger then carries the identity, the account state,
 * and the notepad list — including rename and delete — so housekeeping never
 * leaves the canvas.
 */

async function expectBoard(page: Page): Promise<void> {
  await expect(page.locator("main[data-ready='true']")).toBeVisible();
}

async function openNotepads(page: Page) {
  const list = page.getByTestId("app-menu-notepads");

  // Retried as a whole: creating a notepad navigates, and the chrome can be
  // replaced a beat after `data-ready`. A menu opened on the outgoing tree is
  // detached mid-animation, so "open it" has to survive the swap rather than
  // click a node that is about to disappear.
  await expect(async () => {
    if (!(await list.isVisible())) {
      await page.getByTestId("app-menu-button").click({ timeout: 3_000 });
    }
    if (!(await list.isVisible())) {
      await page.getByTestId("open-notepads").click({ timeout: 3_000 });
    }
    await expect(list).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  return list;
}

test.describe("launcher", () => {
  test("a fresh device asks once, then reopens the notepad it opened", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("launcher")).toBeVisible();
    await expect(page.getByTestId("launch-item-demo")).toContainText("PenPaper demo");

    await page.getByTestId("new-notepad").click();
    await expectBoard(page);
    const id = new URL(page.url()).pathname.split("/").pop();
    expect(id).toBeTruthy();

    // The second visit is not a visit to a catalogue: it lands on the notepad.
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/b/${id}$`));
    await expectBoard(page);
  });

  test("the menu carries the account and the notepad list, with no manage page", async ({
    page,
  }) => {
    await page.goto("/b/demo");
    await expectBoard(page);

    await page.getByTestId("app-menu-button").click();
    const menu = page.getByRole("dialog", { name: "Board menu" });

    // Local-only is the default deployment, but a build can also carry a
    // Google client id. Both are valid: without one the menu has to say so and
    // refuse the click; with one the connect action must actually be live.
    await expect(menu.getByText("On this device")).toBeVisible();
    const connect = menu.getByTestId("menu-connect-drive");
    if (await menu.getByText("Connect to open from Drive").isVisible()) {
      await expect(connect).toBeEnabled();
    } else {
      await expect(menu.getByText("Drive is not set up here")).toBeVisible();
      await expect(connect).toBeDisabled();
    }

    await menu.getByTestId("open-notepads").click();
    const list = menu.getByTestId("app-menu-notepads");
    await expect(list).toBeVisible();
    await expect(list.getByTestId("menu-notepad-demo")).toHaveAttribute("aria-current", "true");

    // Rename and delete are here, in the row itself.
    await expect(list.getByTestId("rename-notepad-demo")).toBeVisible();
    await expect(list.getByTestId("delete-notepad-demo")).toBeVisible();
    await expect(list.getByTestId("menu-manage-notepads")).toHaveCount(0);

    await list.getByTestId("menu-new-notepad").click();
    await expect(page).toHaveURL(/\/b\/[^/]+$/);
    await expectBoard(page);

    // The list contains both notepads and marks the one being edited. The
    // IndexedDB read is fast, but the whole suite runs in parallel and a cold
    // Postgres wake can stretch the first seconds of a board; 5 s is tight.
    const rows = await openNotepads(page);
    await expect(rows.locator(".pp-notepad")).toHaveCount(2, { timeout: 15_000 });
    await expect(rows.locator('.pp-notepad[aria-current="true"]')).toHaveCount(1);
  });

  test("a notepad is renamed from the menu without leaving the board", async ({ page }) => {
    await page.goto("/b/demo");
    await expectBoard(page);

    const list = await openNotepads(page);
    await list.getByTestId("rename-notepad-demo").click();

    const input = page.getByRole("textbox", { name: "Rename PenPaper demo" });
    await expect(input).toBeFocused();
    await input.fill("Ideas for the week");
    await input.press("Enter");

    await expect(page.getByTestId("menu-notepad-demo")).toContainText("Ideas for the week");
    await expect(page).toHaveURL(/\/b\/demo$/);

    // The name is device metadata, so it survives a reload and the board stays.
    await page.reload();
    await expectBoard(page);
    const after = await openNotepads(page);
    await expect(after.getByTestId("menu-notepad-demo")).toContainText("Ideas for the week");
  });

  test("deleting the open notepad asks once, then returns to the chooser", async ({ page }) => {
    await page.goto("/b/demo");
    await expectBoard(page);

    const list = await openNotepads(page);
    await list.getByTestId("delete-notepad-demo").click();

    // One tap arms, the second deletes. Nothing disappears on the first tap.
    const confirm = list.getByTestId("confirm-delete-demo");
    await expect(confirm).toHaveText("Delete");
    await confirm.click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("launcher")).toBeVisible();
    // Nothing left to reopen: the card says so instead of opening a blank board
    // under a deleted id.
    await expect(page.getByTestId("launcher-empty")).toBeVisible();
  });

  test("clicking the notepad you are in keeps its content", async ({ page }) => {
    await page.goto("/b/demo");
    await expectBoard(page);

    const board = page.locator("main[data-ready='true']");
    const before = await board.getAttribute("data-elements");

    const list = await openNotepads(page);
    await list.getByTestId("menu-notepad-demo").click();

    await expect(page).toHaveURL(/\/b\/demo$/);
    await expect(board).toHaveAttribute("data-elements", before ?? "0");
  });
});

test.describe("launcher on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  test("the chooser and the in-menu actions are 44 px targets", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("launcher")).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBe(overflow.client);

    const row = page.getByTestId("launch-item-demo");
    await row.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });

    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const menuRow = await page.getByTestId("new-notepad").boundingBox();
    expect(menuRow!.height).toBeGreaterThanOrEqual(44);

    await page.goto("/b/demo");
    await expectBoard(page);
    const list = await openNotepads(page);

    const rename = await list.getByTestId("rename-notepad-demo").boundingBox();
    expect(rename!.width).toBeGreaterThanOrEqual(44);
    expect(rename!.height).toBeGreaterThanOrEqual(44);

    const remove = await list.getByTestId("delete-notepad-demo").boundingBox();
    expect(remove!.width).toBeGreaterThanOrEqual(44);
    expect(remove!.height).toBeGreaterThanOrEqual(44);

    const menuOverflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(menuOverflow.scroll).toBe(menuOverflow.client);
  });
});
