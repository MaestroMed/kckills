// Capture du labo : console + image fixe + rafale d'images pendant un rayon.
// Usage : node scripts/lab-shot.mjs <url> <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , url, out] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on("console", (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/lab_idle.png` });
const btn = page.getByRole("button", { name: "Rayon" });
await btn.click();
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${out}/lab_ray_${i}.png` });
}
await browser.close();
