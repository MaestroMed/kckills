// Capture du labo logo : planche des pistes + vue 3D de chaque piste demandée.
// Usage : node scripts/logo-lab-shot.mjs <outDir> [lettres…]   (ex. D C2 B)
import { chromium } from "@playwright/test";
const [, , out, ...letters] = process.argv;
const b = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto("http://localhost:3000/lab", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(4000);
await p.getByRole("heading", { name: "Logo" }).scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, 140));
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/logo_board_1.png` });
await p.evaluate(() => window.scrollBy(0, 640));
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/logo_board_2.png` });
for (const l of letters.length ? letters : ["D"]) {
  await p.getByRole("button", { name: new RegExp(`^${l} · `) }).click();
  await p.getByText(/^3D · /).scrollIntoViewIfNeeded();
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `${out}/logo_3d_${l}.png` });
}
await b.close();
