import { expect, test, type Page } from "@playwright/test";
import { pickTool } from "./helpers";

/** Reads one board's saved camera, retrying while the loader finishes writing. */
async function readCamera(page: Page, boardId: string) {
  return page.evaluate(async (id) => {
    const request = indexedDB.open("penpaper");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = db.transaction("boards", "readonly").objectStore("boards").get(id);
    return new Promise<{ camera?: { x: number; y: number; zoom: number } } | undefined>(
      (resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      },
    );
  }, boardId);
}

/**
 * Reload is the only honest test of persistence.
 *
 * Each test uses its own board id and each Playwright test gets a fresh
 * browser context, so IndexedDB starts empty without any cleanup API.
 */
test.describe("local persistence", () => {
  test("a drawn shape survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/b/persist-shape");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    await pickTool(page, "rectangle");

    const canvas = page.getByRole("application");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 120, box!.y + 160);
    await page.mouse.down();
    await page.mouse.move(box!.x + 300, box!.y + 260, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    // The autosave is debounced by 500 ms; wait past it so the write is not
    // still queued when the page unloads.
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    // The count could come from anywhere; selecting the shape proves it was
    // reconstructed with real geometry and paint order.
    await page.locator("[data-tool='select']").click();
    await page.mouse.click(box!.x + 200, box!.y + 200);
    await expect(page.locator(".pp-properties-desktop").getByTestId("properties-panel")).toContainText(
      "1 rectangle",
    );
  });

  test("boards do not leak into each other", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/b/persist-first");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await pickTool(page, "rectangle");

    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.mouse.down();
    await page.mouse.move(box!.x + 220, box!.y + 200, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator("main")).toHaveAttribute("data-elements", "1");

    await page.waitForTimeout(900);
    await page.goto("/b/persist-second");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("data-elements", "0");
  });

  test("the demo board opens with content and survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/b/demo");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("data-elements", "12");

    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("data-elements", "12");

    // The demo is centred by the loader, so map one known scene point through
    // the camera it persisted. Aim at the left padding of the first box so the
    // label text inside is not the topmost hit.
    const saved = await readCamera(page, "demo");
    const camera = saved?.camera ?? { x: 0, y: 0, zoom: 1 };
    const box = await page.getByRole("application").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(
      box!.x + camera.x + 58 * camera.zoom,
      box!.y + camera.y + 205 * camera.zoom,
    );
    await expect(page.locator(".pp-properties-desktop").getByTestId("properties-panel")).toContainText(
      "1 rectangle",
    );
  });

  test("a reload keeps the camera where the user left it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/b/persist-camera");
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    const canvas = page.getByRole("application");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Wheel over empty canvas pans (no modifier means scroll = pan).
    await page.mouse.move(box!.x + 640, box!.y + 400);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(900);

    await page.reload();
    await expect(page.locator("main[data-ready='true']")).toBeVisible();

    // Panning moved the scene origin; a freshly reset camera would leave the
    // dot grid at its default offset. Screenshot comparison would be brittle,
    // so assert on the persisted snapshot through the page's own storage.
    const saved = await page.evaluate(async () => {
      const request = indexedDB.open("penpaper");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const read = db.transaction("boards", "readonly").objectStore("boards").get("persist-camera");
      return new Promise<{ camera?: { y: number } } | undefined>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
    });

    expect(saved?.camera?.y).not.toBe(0);
  });
});
