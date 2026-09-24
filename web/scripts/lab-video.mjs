// Vidéo du labo (étendards) : ~16 s avec un rayon et une rafale déclenchés.
// Usage : node scripts/lab-video.mjs <url> <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , url, out] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  recordVideo: { dir: out, size: { width: 1280, height: 1000 } },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(7000);
await page.getByRole("button", { name: "Rayon" }).click();
await page.waitForTimeout(3500);
await page.getByRole("button", { name: "Rafale" }).click();
await page.waitForTimeout(4500);
await page.getByRole("button", { name: "Rayon" }).click();
await page.waitForTimeout(4000);
const video = page.video();
await ctx.close();
console.log(await video.path());
await browser.close();
