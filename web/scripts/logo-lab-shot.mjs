// Capture du logo 3D du labo (L'Ecrin) : images de l'assemblage + planche des declinaisons.
// Usage : node scripts/logo-lab-shot.mjs <outDir>
import { chromium } from "@playwright/test";
const [, , out] = process.argv;
const b = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
p.on("console", (m) => { if (m.type() === "error" && !/speed-insights|Speed Insights/.test(m.text())) console.log("[error]", m.text().slice(0, 300)); });
await p.goto("http://localhost:3000/lab", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(3000);
const hero = p.locator("section:has(h2) canvas").last();
await hero.scrollIntoViewIfNeeded();
await p.waitForTimeout(4000);
await p.getByRole("button", { name: "Assembler" }).click();
let t = 0;
for (const at of [250, 700, 1100, 1300, 1700, 3200]) {
  await p.waitForTimeout(at - t);
  t = at;
  await hero.screenshot({ path: `${out}/ecrin3d_${String(at).padStart(4, "0")}.png` });
}
await b.close();
