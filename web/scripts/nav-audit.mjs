// Audit des pages du menu : statut, titre, volume de contenu, états vides, capture.
// Usage : node scripts/nav-audit.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const [, , out, base = "http://localhost:3000"] = process.argv;
mkdirSync(out, { recursive: true });
const ROUTES = [
  "/scroll",
  "/clips",
  "/week",
  "/clips?sort=score",
  "/records",
  "/saved",
  "/vs",
  "/vs/leaderboard",
  "/face-off",
  "/bracket",
  "/quotes",
  "/players",
  "/matches",
  "/achievements",
  "/community",
  "/alumni",
  "/hall-of-fame",
  "/chambre",
];
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const rows = [];
for (const r of ROUTES) {
  const errors = [];
  const onErr = (e) => errors.push(e.message.slice(0, 120));
  page.on("pageerror", onErr);
  let status = 0;
  try {
    const resp = await page.goto(base + r, { waitUntil: "domcontentloaded", timeout: 120_000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(4500);
  } catch (e) {
    errors.push(String(e).slice(0, 120));
  }
  const info = await page
    .evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const text = main.innerText || "";
      const empty = (text.match(/aucun[e]?\b|bientôt|coming soon|à venir|vide|pas encore|introuvable|erreur/gi) ?? []).slice(0, 6);
      return {
        h1: document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? "",
        chars: text.length,
        media: main.querySelectorAll("img, video, canvas").length,
        links: main.querySelectorAll("a").length,
        empty,
      };
    })
    .catch(() => ({ h1: "", chars: 0, media: 0, links: 0, empty: [] }));
  const name = r.replace(/[/?=&]+/g, "_").replace(/^_/, "") || "home";
  await page.screenshot({ path: `${out}/${name}.png` }).catch(() => {});
  rows.push({ route: r, status, ...info, errors });
  console.log(JSON.stringify({ route: r, status, ...info, errors }));
  page.off("pageerror", onErr);
}
writeFileSync(`${out}/audit.json`, JSON.stringify(rows, null, 2));
await browser.close();
