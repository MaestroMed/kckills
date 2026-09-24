// Capture du header de l accueil (etendards) + fps approximatif + etat apres scroll.
// Usage : node scripts/header-shot.mjs <outDir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const browser = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.text().includes("KCBanner") || m.type() === "error") console.log(`[${m.type()}] ${m.text().slice(0, 160)}`); });
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(11000);
await page.screenshot({ path: `${out}/home_top.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } });
// fps approximatif sur 3 s
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
console.log("fps", fps);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/home_scrolled.png`, clip: { x: 0, y: 0, width: 1440, height: 300 } });
await browser.close();
