// Captures du site pour la vidéo de présentation (promo/, Remotion).
//  - interface du scroll en PNG TRANSPARENT (vidéo masquée, fonds pleins
//    rendus transparents) : la vidéo pose le vrai clip dessous ;
//  - pages desktop en pleine hauteur (1440 px) : kill, joueur, accueil.
// Usage : node scripts/capture-promo.mjs <baseUrl> <promo/public/captures>
import { chromium, devices } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const [, , BASE, OUT] = process.argv;
const kills = JSON.parse(readFileSync(`${OUT}/kills.json`, "utf8"));
const browser = await chromium.launch({ channel: "msedge" });

// ── 1. interface du feed (mobile) ─────────────────────────────────────
const mobile = await browser.newContext({
  ...devices["Pixel 7"],
  viewport: { width: 390, height: 830 },
  deviceScaleFactor: 2,
});
const feed = [];
for (const key of ["feed1", "feed2", "feed3"]) {
  const page = await mobile.newPage();
  await page.goto(`${BASE}/scroll?kill=${kills[key].id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(7000);
  // fenêtre d'accueil « choisis tes joueurs favoris » : fermée comme un visiteur
  const later = page.getByRole("button", { name: /plus tard/i });
  if (await later.count()) {
    await later.first().click();
    await page.waitForTimeout(1200);
  }
  const tap = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const style = document.createElement("style");
    style.textContent = `video{visibility:hidden!important} html,body{background:transparent!important}`;
    document.head.appendChild(style);
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      const cover = (Math.min(b.right, vw) - Math.max(b.left, 0)) * (Math.min(b.bottom, vh) - Math.max(b.top, 0));
      if (cover < vw * vh * 0.5) continue;
      if (el.tagName === "IMG" || el.tagName === "PICTURE" || el.tagName === "CANVAS") {
        el.style.visibility = "hidden"; // affiche du clip derrière la vidéo
      } else {
        el.style.setProperty("background-color", "transparent", "important");
        el.style.setProperty("background-image", "none", "important");
      }
    }
    // bouton « Noter » du rail : l'élément dont le texte est exactement « Noter »
    const label = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.textContent?.trim() === "Noter");
    const rate = label?.closest("button, a, [role=button]") ?? label;
    if (!rate) return null;
    const r = rate.getBoundingClientRect();
    return r.width ? { x: (r.left + r.width / 2) / vw, y: (r.top + r.height / 2) / vh } : null;
  });
  await page.screenshot({ path: `${OUT}/${key}_ui.png`, omitBackground: true });
  feed.push({ key, tap });
  console.log(key, "ui ok", tap);
  await page.close();
}
await mobile.close();

// ── 2. pages desktop ──────────────────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const pages = [
  { name: "desk_kill", path: `/kill/${kills.penta_id}`, label: `/kill/${kills.penta_id.slice(0, 8)}…` },
  { name: "desk_player", path: "/player/Caliste", label: "/player/Caliste" },
  { name: "desk_home", path: "/", label: "" },
];
const desktop = [];
for (const p of pages) {
  const page = await desk.newPage();
  await page.goto(BASE + p.path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(6000);
  await page.evaluate(async () => {
    for (let y = 0; y < Math.min(document.body.scrollHeight, 4000); y += 500) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${p.name}.png`, clip: { x: 0, y: 0, width: 1440, height: 2400 }, fullPage: true });
  desktop.push({ image: `captures/${p.name}.png`, label: p.label, height: 2400 });
  console.log(p.name, "ok");
  await page.close();
}
await browser.close();
writeFileSync(`${OUT}/ui.json`, JSON.stringify({ feed, desktop }, null, 1));
