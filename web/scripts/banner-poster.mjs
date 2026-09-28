// Image de repli des étendards du header : capture des deux étendards 3D du labo à la
// taille exacte du header (140×262 CSS, DPR 2), fond transparent, sans rayon.
// Usage : node scripts/banner-poster.mjs <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [, , out] = process.argv;
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:3000/lab?nosweep", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.getByText("Taille réelle, sur le hero").scrollIntoViewIfNeeded();
await p.waitForTimeout(2500);
// les deux étendards de l'aperçu, remis aux dimensions exactes du header
const boxes = p.locator("div[class*=\"top-[52px]\"]");
const n = await boxes.count();
for (let i = 0; i < n; i++) await boxes.nth(i).evaluate((el) => { el.style.width = "140px"; el.style.height = "262px"; });
// tous les étendards du labo partagent un worker : les petits sont prêts en dernier
await p.waitForTimeout(6000);
await p.addStyleTag({ content: "html,body{background:transparent!important} *{visibility:hidden!important;background-image:none!important} canvas{visibility:visible!important;opacity:1!important;transition:none!important}" });
await p.waitForTimeout(400);
const names = ["etendard-gauche", "etendard-droite"];
for (let i = 0; i < n; i++) {
  await boxes.nth(i).locator("canvas").screenshot({ path: `${out}/${names[i]}.png`, omitBackground: true });
}
console.log("captures:", n);
await b.close();
