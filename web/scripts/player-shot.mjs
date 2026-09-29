// Pages joueur : l'affiche puis l'ADN, desktop et mobile.
// Usage : node scripts/player-shot.mjs <outDir> Caliste,Canna,Saken
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, list] = process.argv;
const names = (list ?? "Caliste").split(",");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
for (const [label, vp] of [
  ["desk", { width: 1440, height: 900 }],
  ["mob", { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport: vp });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  for (const n of names) {
    const t0 = Date.now();
    const resp = await page.goto(`http://localhost:3000/player/${encodeURIComponent(n)}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForTimeout(4500);
    console.log(`${label} ${n}: ${resp?.status()} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.screenshot({ path: `${out}/${label}_${n}_1_affiche.png` });
    const dna = page.locator("#dna-title");
    if (await dna.count()) {
      await dna.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, label === "desk" ? 260 : 140);
      await page.waitForTimeout(3200);
      await page.screenshot({ path: `${out}/${label}_${n}_2_adn.png` });
    } else console.log(`${label} ${n}: pas d'ADN`);
  }
  await page.close();
}
await browser.close();
