// FPS de l'accueil par temps (ciel du hero + étendards), puis capture mobile.
// Usage : node scripts/mood-perf.mjs <outDir> [temps,temps…]
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, list] = process.argv;
const moods = (list ?? "tempete,gloire").split(",");
mkdirSync(out, { recursive: true });
const args = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=d3d11", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ channel: "msedge", args });
const fpsOf = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const ts = [];
        const f = (t) => {
          ts.push(t);
          if (t - ts[0] < 4000) requestAnimationFrame(f);
          else {
            const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b);
            res({ fps: +((ts.length - 1) / ((t - ts[0]) / 1000)).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1) });
          }
        };
        requestAnimationFrame(f);
      }),
  );
const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const mood of moods) {
  await desk.goto(`http://localhost:3000/?mood=${mood}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await desk.waitForFunction(() => [...document.querySelectorAll("section canvas")].some((c) => getComputedStyle(c).opacity === "1"), null, { timeout: 90_000 });
  await desk.waitForTimeout(8000);
  console.log(`desktop ${mood}`, JSON.stringify(await fpsOf(desk)));
  await desk.mouse.wheel(0, 1400);
  await desk.waitForTimeout(1500);
  console.log(`desktop ${mood} (hero hors écran)`, JSON.stringify(await fpsOf(desk)));
}
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const mob = await ctx.newPage();
for (const mood of moods) {
  await mob.goto(`http://localhost:3000/?mood=${mood}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await mob.waitForFunction(() => [...document.querySelectorAll("section canvas")].some((c) => getComputedStyle(c).opacity === "1"), null, { timeout: 90_000 });
  await mob.waitForTimeout(3000);
  console.log(`mobile ${mood}`, JSON.stringify(await fpsOf(mob)));
  await mob.screenshot({ path: `${out}/mobile_${mood}.png` });
}
await browser.close();
