// Parcours de l'arène VS : sélection → intro → clips → vote → manche → vainqueur.
// Usage : node scripts/vs-shot.mjs <outDir> [largeur]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , out, width] = process.argv;
const W = Number(width ?? 1440);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: W, height: 900 } });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error" && !/speed-insights|doubleclick|ERR_FAILED|preload/.test(msg.text())) console.log(`[error] ${msg.text().slice(0, 200)}`);
});
// Le serveur local parle à la base de PROD : le vote est intercepté, jamais
// enregistré (des votes de capture avaient faussé l'ELO le 29/09).
await page.route("**/rest/v1/rpc/fn_record_vs_vote", (route) => {
  const body = JSON.parse(route.request().postData() ?? "{}");
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { kill_a_id: body.p_kill_a, kill_a_elo: 1516, kill_a_battles: 1, kill_a_wins: 1, kill_b_id: body.p_kill_b, kill_b_elo: 1484, kill_b_battles: 1, kill_b_wins: 0, inserted: true },
    ]),
  });
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
await page.goto("http://localhost:3000/vs", { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(4000);
await shot("0_selection");
const cards = page.locator('section[aria-label="Sélection des combattants"] ul button');
console.log("combattants :", await cards.count());
await cards.nth(0).click();
await page.waitForTimeout(700);
await cards.nth(2).click();
await page.waitForTimeout(900);
await shot("1_choisis");
await page.getByRole("button", { name: /Lancer le duel/ }).click();
await page.waitForTimeout(700);
await shot("2_manche");
await page.waitForTimeout(1800);
await shot("3_intro");
await page.waitForTimeout(2600);
await shot("4_clip_bleu");
await page.getByRole("button", { name: /Au tour de/ }).click();
await page.waitForTimeout(1500);
await shot("5_clip_rouge");
await page.getByRole("button", { name: /Voter/ }).click();
await page.waitForTimeout(1500);
await shot("6_vote");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(1800);
await shot("7_manche_gagnee");
await browser.close();
