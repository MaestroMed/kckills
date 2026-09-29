// Audit tactile : chaque page publique se laisse-t-elle défiler au doigt jusqu'en bas ?
// Swipes verticaux réalistes (CDP) à gauche / centre / droite ; un swipe qui ne fait
// rien alors qu'on n'est pas en bas = zone qui bloque (on nomme l'élément touché).
// Lecture seule : écritures interceptées (le dev local écrit dans la base de PROD).
// Usage : node scripts/touch-scroll-audit.mjs [baseUrl] [chemin1,chemin2,...]
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const explicit = process.argv[3]?.split(",").filter(Boolean);
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
await page.route(/\/(api\/(track|send|achievements|kills\/[^/]+\/(react|rate|impression))|rest\/v1\/rpc\/fn_record)/, (r) =>
  r.fulfill({ status: 204, body: "" }),
);
const cdp = await ctx.newCDPSession(page);

const swipeUp = async (x, fromY = 640, dist = 380) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
  for (let s = 1; s <= 12; s++) {
    await new Promise((r) => setTimeout(r, 22));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: fromY - (dist * s) / 12 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(700);
};

const describe = (x, y) =>
  page.evaluate(
    ([x, y]) => {
      let el = document.elementFromPoint(x, y);
      const path = [];
      for (let i = 0; el && i < 6; i++, el = el.parentElement) {
        const ta = getComputedStyle(el).touchAction;
        const cls = (el.getAttribute("class") || "").split(/\s+/).slice(0, 3).join(".");
        path.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${ta !== "auto" ? `[touch-action:${ta}]` : ""}`);
      }
      return path.join(" < ");
    },
    [x, y],
  );

async function auditPage(path) {
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(3500);
  const blocked = [];
  let stuck = 0;
  for (let i = 0; i < 120; i++) {
    const x = [70, 206, 340][i % 3];
    const before = await page.evaluate(() => scrollY);
    const atBottom = await page.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 4);
    if (atBottom) break;
    await swipeUp(x);
    const after = await page.evaluate(() => scrollY);
    if (after <= before + 2) {
      // l'élément sous le doigt AVANT le swipe (on revient à la position de départ)
      await page.evaluate((y) => scrollTo(0, y), before);
      blocked.push({ at: before, x, el: await describe(x, 640) });
      if (++stuck >= 6) break;
    } else stuck = 0;
  }
  const end = await page.evaluate(() => ({
    y: Math.round(scrollY),
    max: document.documentElement.scrollHeight - innerHeight,
  }));
  const reached = end.y >= end.max - 4;
  console.log(`${reached ? "OK " : "BLOQUÉ"} ${path}  (descendu ${end.y}/${end.max}, ${blocked.length} swipe(s) sans effet)`);
  const seen = new Set();
  for (const b of blocked) {
    if (seen.has(b.el)) continue;
    seen.add(b.el);
    console.log(`   ⚠ swipe sans effet à scrollY=${b.at}, x=${b.x} : ${b.el}`);
  }
}

let paths = explicit;
if (!paths) {
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(3000);
  const found = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href").split(/[?#]/)[0]);
    const pick = (re) => hrefs.find((h) => re.test(h));
    return [pick(/^\/kill\/[0-9a-f-]{36}$/), pick(/^\/match\/[^/]+$/), pick(/^\/era\/[^/]+$/)].filter(Boolean);
  });
  paths = ["/", "/top", "/players", "/player/Caliste", "/matches", "/clips", "/week", ...found];
}
for (const p of paths) {
  try {
    await auditPage(p);
  } catch (e) {
    console.log(`ERREUR ${p} : ${e.message.slice(0, 120)}`);
  }
}
await browser.close();
