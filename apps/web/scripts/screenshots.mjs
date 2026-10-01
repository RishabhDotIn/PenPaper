import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

mkdirSync("../../docs/screenshots", { recursive: true });

const browser = await chromium.launch();
const base = "http://localhost:3000";

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktopPage = await desktop.newPage();
await desktopPage.goto(`${base}/b/demo`);
await desktopPage.waitForSelector("main[data-ready='true']");
await desktopPage.waitForTimeout(700);
await desktopPage.screenshot({ path: "../../docs/screenshots/penpaper-desktop.png" });

// `/` on a device that has not opened a notepad yet: the one-time chooser.
const firstRun = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const launchPage = await firstRun.newPage();
await launchPage.goto(`${base}/`);
await launchPage.waitForSelector("[data-testid='launcher']");
await launchPage.waitForTimeout(700);
await launchPage.screenshot({ path: "../../docs/screenshots/penpaper-launcher.png" });

// The hamburger: identity, Drive state, and the in-menu notepad list, where a
// notepad can be opened, renamed, deleted, or synced without a separate page.
const menuPage = await desktop.newPage();
await menuPage.goto(`${base}/b/demo`);
await menuPage.waitForSelector("main[data-ready='true']");
await menuPage.waitForTimeout(500);
await menuPage.getByTestId("app-menu-button").click();
await menuPage.waitForTimeout(500);
await menuPage.screenshot({ path: "../../docs/screenshots/penpaper-menu.png" });
await menuPage.getByTestId("open-notepads").click();
await menuPage.waitForTimeout(400);
await menuPage.screenshot({ path: "../../docs/screenshots/penpaper-menu-notepads.png" });

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const phonePage = await phone.newPage();
await phonePage.goto(`${base}/b/demo`);
await phonePage.waitForSelector("main[data-ready='true']");
await phonePage.waitForTimeout(700);
await phonePage.screenshot({ path: "../../docs/screenshots/penpaper-phone.png" });

await phonePage.getByTestId("app-menu-button").click();
await phonePage.waitForTimeout(500);
await phonePage.screenshot({ path: "../../docs/screenshots/penpaper-phone-menu.png" });

await browser.close();
console.log("screenshots written");
