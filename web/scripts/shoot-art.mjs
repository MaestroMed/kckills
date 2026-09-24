// Rendu PNG d'une page HTML locale de maquette (directions artistiques).
import { chromium } from "@playwright/test";
const [, , url, out] = process.argv;
const b = await chromium.launch({ channel: "msedge" });
const p = await b.newPage({ viewport: { width: 1450, height: 940 }, deviceScaleFactor: 1.5 });
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForSelector("body[data-ready='1']", { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.screenshot({ path: out, fullPage: true });
await b.close();
