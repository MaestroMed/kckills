// Capture de l'écran visible (pas la page entière) en mobile + desktop.
// Usage : node scripts/shoot-viewport.mjs <baseUrl> <outDir> <path> [path…]
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
    await page.goto(base + p, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const slug = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    await page.screenshot({ path: `${out}/vp_${name}_${slug}.png` });
    console.log(`${name} ${p} ok`);
  }
  await ctx.close();
}
await browser.close();
