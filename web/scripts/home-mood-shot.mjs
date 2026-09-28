// Capture de l'accueil dans chaque temps (étendards + ciel du hero), avec un
// éclair déclenché à la main quand le temps en a.
// Usage : node scripts/home-mood-shot.mjs <outDir> [temps,temps…] [largeur]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, list, width] = process.argv;
const moods = (list ?? "gloire,variable,tempete").split(",");
const W = Number(width ?? 1440);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  const t = m.text();
  if ((m.type() === "error" && !t.includes("speed-insights")) || t.includes("HeroWeather") || t.includes("KCBanner"))
    console.log(`[${m.type()}] ${t.slice(0, 200)}`);
});
for (const mood of moods) {
  const t0 = Date.now();
  await page.goto(`http://localhost:3000/?mood=${mood}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("section canvas")].some((c) => getComputedStyle(c).opacity === "1"),
    null,
    { timeout: 90_000 },
  );
  console.log(`${mood}: ciel prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(W >= 1024 ? 9000 : 3000);
  await page.screenshot({ path: `${out}/home_${mood}.png` });
  if (mood === "tempete" || mood === "electrique") {
    await page.evaluate(() => window.__kcSky?.emitStrike(1));
    await page.waitForTimeout(70);
    await page.screenshot({ path: `${out}/home_${mood}_eclair.png` });
  }
}
await browser.close();
