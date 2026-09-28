// Filme le chargement d'une page (images toutes les 150 ms) pour voir les sauts et les remplacements.
// Usage : node scripts/load-film.mjs <url> <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [, , url, out] = process.argv;
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const t0 = Date.now();
const nav = p.goto(url, { waitUntil: "load", timeout: 120000 });
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${out}/f_${String(i).padStart(2, "0")}.png`, clip: { x: 0, y: 0, width: 1440, height: 320 } }).catch(() => {});
}
await nav.catch(() => {});
console.log("done", Date.now() - t0, "ms");
await b.close();
