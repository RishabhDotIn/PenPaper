import type { Page } from "@playwright/test";

/**
 * Arms any tool the way a person does.
 *
 * Geometry lives behind one dock button, so a raw `[data-tool="rectangle"]`
 * selector no longer exists; every test goes through the same two taps the UI
 * asks for.
 */
export async function pickTool(page: Page, tool: string): Promise<void> {
  if (SHAPES.has(tool)) {
    await page.getByTestId("tool-shapes").click();
    await page.getByTestId(`shape-${tool}`).click();
    return;
  }

  await page.locator(`[data-tool='${tool}']`).click();
}

/** The tools that live behind the shapes button. */
const SHAPES: ReadonlySet<string> = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "triangle",
  "hexagon",
  "star",
]);
