// Captures pleine page du site (mobile + desktop) pour relecture visuelle.
// Usage : node scripts/shoot.mjs <baseUrl> <outDir> <path> [path…]
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , base, out, ...paths] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const targets = [
  ["mobile", { ...devices["Pixel 7"] }],
  ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
];
for (const [name, opts] of targets) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(4000);
    // déclenche le chargement paresseux avant la capture pleine page
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1500);
    const slug = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    await page.screenshot({ path: `${out}/${name}_${slug}.png`, fullPage: true });
    console.log(`${name} ${p} ok`);
  }
  await ctx.close();
}
await browser.close();
