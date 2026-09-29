import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

const USER_DATA_DIR = path.resolve(
  process.env.BEES_BROWSER_PROFILE ?? "session/browser-profile",
);

export async function createPersistentBrowser(
  headless = false,
): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,

    viewport: {
      width: 1440,
      height: 900,
    },

    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  return context;
}
