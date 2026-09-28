import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
p.on("console", (m) => { if (m.type() === "error" && !m.text().includes("speed-insights")) console.log("[error]", m.text().slice(0, 200)); });
await p.goto("http://localhost:3000/lab", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(4000);
const h = p.getByRole("heading", { name: "Logo" });
await h.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -20));
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/logo_board.png` });
await p.evaluate(() => window.scrollBy(0, 760));
for (const [i, name] of [["C", "Cinq éclats"], ["A", "L'Écu"], ["B", "Face-à-face"]]) {
  await p.getByRole("button", { name: new RegExp(`^${i} · `) }).click();
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `${out}/logo_3d_${i}.png` });
}
await b.close();
