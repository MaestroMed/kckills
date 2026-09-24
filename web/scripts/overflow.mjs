// Débordement horizontal sur mobile : largeur de la page vs viewport, et
// les éléments qui dépassent à droite. Usage : node scripts/overflow.mjs <url> [url…]
import { chromium, devices } from "@playwright/test";

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
for (const url of process.argv.slice(2)) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const culprits = [];
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (b.right > vw + 1 && b.width > 0 && getComputedStyle(el).position !== "fixed") {
        culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(b.right)}`);
      }
    }
    return { vw, sw: document.documentElement.scrollWidth, culprits: culprits.slice(0, 8) };
  });
  console.log(url, JSON.stringify(r, null, 1));
}
await browser.close();
