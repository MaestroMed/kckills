// Audit du /scroll sur mobile : chargement, swipes tactiles réalistes, vidéo active, erreurs.
// Lecture seule : tracking, impressions, succès, Umami et RPC d'écriture sont interceptés
// (le dev local écrit dans la base de PROD).
// Usage : node scripts/scroll-audit.mjs <outDir> [baseUrl] [swipes]
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, base = "http://localhost:3000", n = "4"] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message.slice(0, 160)}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/speed-insights|doubleclick|ERR_FAILED|403/.test(m.text())) errors.push(`[error] ${m.text().slice(0, 160)}`);
});
await page.route(/\/(api\/(track|send|achievements|kills\/[^/]+\/(react|rate|impression))|rest\/v1\/rpc\/fn_record)/, (r) =>
  r.fulfill({ status: 204, body: "" }),
);
const t0 = Date.now();
await page.goto(`${base}/scroll`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector('[role="feed"]', { timeout: 90_000 });
console.log(`feed monté en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(3000);

// Vidéo active = celle dont le centre est le plus proche du centre de l'écran.
const state = () =>
  page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")];
    let best = null;
    let bestD = Infinity;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      if (r.width === 0) continue;
      const d = Math.abs(r.top + r.height / 2 - innerHeight / 2);
      if (d < bestD) (bestD = d), (best = v);
    }
    return {
      pos: document.querySelector('[role="feed"] [tabindex="0"]')?.getAttribute("aria-posinset") ?? null,
      src: best ? (best.currentSrc || best.src || "").split("/").slice(-3, -2)[0]?.slice(0, 8) : null,
      ready: best?.readyState ?? null,
      playing: best ? !best.paused : null,
      t: best ? +best.currentTime.toFixed(1) : null,
    };
  });

const cdp = await ctx.newCDPSession(page);
const swipe = async (fromY, toY, ms = 280, steps = 14) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: fromY }] });
  for (let s = 1; s <= steps; s++) {
    await new Promise((r) => setTimeout(r, ms / steps));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: fromY + ((toY - fromY) * s) / steps }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};

let s = await state();
console.log("arrivée", JSON.stringify(s));
await page.screenshot({ path: `${out}/0_arrivee.png` });
for (let i = 1; i <= +n; i++) {
  const before = s.pos;
  const ts = Date.now();
  await swipe(700, 250);
  // délai jusqu'à ce que la vidéo du nouvel item joue
  let playMs = null;
  for (let k = 0; k < 40; k++) {
    await page.waitForTimeout(100);
    s = await state();
    if (s.pos !== before && s.playing && s.ready >= 3) {
      playMs = Date.now() - ts;
      break;
    }
  }
  console.log(`swipe ${i}`, JSON.stringify(s), playMs === null ? "⚠ pas de lecture en 4 s" : `lecture après ${playMs} ms`);
  await page.screenshot({ path: `${out}/${i}_swipe.png` });
  await page.waitForTimeout(800);
}
// retour arrière
await swipe(250, 700);
await page.waitForTimeout(1500);
console.log("retour", JSON.stringify(await state()));
console.log(errors.length ? errors.slice(0, 10).join("\n") : "aucune erreur console");
await browser.close();
