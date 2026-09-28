// Capture du labo dans chaque temps (lib/mood) : grand étendard + taille header.
// Usage : node scripts/mood-shot.mjs <outDir> [temps,temps…]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, list] = process.argv;
const moods = (list ?? "gloire,beau,variable,gris,tempete,electrique").split(",");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("KCBanner")) console.log(`[${m.type()}] ${m.text().slice(0, 200)}`);
});
for (const mood of moods) {
  const t0 = Date.now();
  await page.goto(`http://localhost:3000/lab?mood=${mood}&nosweep`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // attend que les trois canvas d'étendard soient visibles (première image peinte)
  await page.waitForFunction(
    () => [...document.querySelectorAll("canvas")].filter((c) => getComputedStyle(c).opacity === "1").length >= 3,
    null,
    { timeout: 90_000 },
  );
  console.log(`${mood}: prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${mood}.png`, clip: { x: 0, y: 150, width: 1440, height: 950 } });
  await page.locator('div[style*="hero-bg"]').screenshot({ path: `${out}/${mood}_header.png` });
}
await browser.close();
