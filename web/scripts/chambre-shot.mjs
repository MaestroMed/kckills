// Capture de la Chambre : porte, puis descente (scroll) jusqu'au fond.
// Usage : node scripts/chambre-shot.mjs <outDir> [largeur]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, width] = process.argv;
const W = Number(width ?? 1440);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: W, height: 900 } });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("speed-insights") && !m.text().includes("preload"))
    console.log(`[${m.type()}] ${m.text().slice(0, 240)}`);
});
await page.goto("http://localhost:3000/chambre", { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(5000);
console.log(
  "canvas",
  JSON.stringify(
    await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return c && { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, op: getComputedStyle(c).opacity };
    }),
  ),
);
await page.screenshot({ path: `${out}/0_porte.png` });
await page.getByRole("button", { name: /Descendre/ }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/1_cercle1.png` });
const scroller = "div.fixed.inset-0.overflow-y-auto";
const total = await page.evaluate((s) => document.querySelector(s).scrollHeight, scroller);
for (const [i, f] of [0.12, 0.35, 0.6, 0.85, 0.97].entries()) {
  await page.evaluate(([s, t]) => document.querySelector(s).scrollTo({ top: t }), [scroller, total * f]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}/${i + 2}_descente_${Math.round(f * 100)}.png` });
}
await browser.close();
