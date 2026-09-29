import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

mkdirSync("../../docs/screenshots", { recursive: true });

const browser = await chromium.launch();

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktopPage = await desktop.newPage();
await desktopPage.goto("http://localhost:3000/b/demo");
await desktopPage.waitForSelector("main[data-ready='true']");
await desktopPage.waitForTimeout(700);
await desktopPage.screenshot({ path: "../../docs/screenshots/penpaper-desktop.png" });

// The shelf is the first thing a returning user sees.
const shelfPage = await desktop.newPage();
await shelfPage.goto("http://localhost:3000/");
await shelfPage.waitForSelector("[data-testid='library']");
await shelfPage.waitForTimeout(700);
await shelfPage.screenshot({ path: "../../docs/screenshots/penpaper-shelf.png" });

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const phonePage = await phone.newPage();
await phonePage.goto("http://localhost:3000/b/demo");
await phonePage.waitForSelector("main[data-ready='true']");
await phonePage.waitForTimeout(700);
await phonePage.screenshot({ path: "../../docs/screenshots/penpaper-phone.png" });

await browser.close();
console.log("screenshots written");
