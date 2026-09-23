import { expect, test, type Page } from "@playwright/test";

/**
 * Parcours critiques du site, en lecture seule (aucune écriture en base) :
 * accueil + frise, feed vertical, page d'un kill tiré du sitemap, sitemap,
 * API de la frise, 404. Toute erreur JS non rattrapée fait échouer le test.
 */

// Bruit connu, sans rapport avec le code du site.
const IGNORED_CONSOLE = [
  /va\.vercel-scripts\.com/, // analytics Vercel en local (CSP)
  /_vercel\/(insights|speed-insights)\/script\.js/, // n'existent qu'une fois déployé
  /Failed to load resource: the server responded with a status of 404/, // idem (même requête)
  // CONNU, en attente de Mehdi : le bucket R2 n'envoie pas d'en-têtes CORS
  // (règle à poser dans le dashboard Cloudflare R2 -> kckills-clips ->
  // Settings -> CORS). Le préchargement fetch() des clips échoue, la lecture
  // <video> fonctionne. Retirer ces deux lignes une fois la règle posée.
  /clips\.kckills\.com.*blocked by CORS policy/,
  /Failed to load resource: net::ERR_FAILED/,
  /Failed to load resource.*(favicon|umami)/i,
  /Download the React DevTools/i,
];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function firstKillPath(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.get("/sitemap.xml");
  expect(res.ok()).toBeTruthy();
  const xml = await res.text();
  const m = xml.match(/<loc>https?:\/\/[^<]+?(\/kill\/[0-9a-f-]{36})<\/loc>/);
  expect(m, "au moins un kill dans le sitemap").not.toBeNull();
  return m![1];
}

test("accueil : titre, frise des ères, aucune erreur JS", async ({ page }) => {
  const errors = watchErrors(page);
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/KCKILLS/);
  await expect(page.getByText("Worlds 2026").first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(errors, errors.join("\n")).toEqual([]);
});

test("feed vertical : au moins une vidéo", async ({ page }) => {
  const errors = watchErrors(page);
  const res = await page.goto("/scroll");
  expect(res?.status()).toBe(200);
  await expect(page.locator("video").first()).toBeAttached({ timeout: 20_000 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("page d'un kill : titre « tueur → victime » et clip", async ({ page, request }) => {
  const errors = watchErrors(page);
  const path = await firstKillPath(request);
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/→/);
  await expect(page.locator("video, img[src*='thumb'], img[alt*='élimine']").first()).toBeAttached();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("sitemap : XML valide et catalogue complet", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("xml");
  const xml = await res.text();
  expect(xml.startsWith("<?xml")).toBeTruthy();
  expect((xml.match(/<url>/g) ?? []).length).toBeGreaterThan(1000);
  // aucun caractère de contrôle (un \x03 dans une description avait cassé le XML)
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBeFalsy();
});

test("API de la frise : kills d'une ère", async ({ request }) => {
  const res = await request.get("/api/kills/by-era?eraId=lec-2026-summer&limit=5");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.era?.id).toBe("lec-2026-summer");
  expect(Array.isArray(body.kills)).toBeTruthy();
});

test("kill inconnu : page 404 non indexable", async ({ page }) => {
  // La page de kill a un loading.tsx : Next envoie les en-têtes (200) avant de
  // savoir que le kill manque, puis ajoute <meta name="robots" content="noindex">
  // — comportement documenté du streaming. On vérifie ce que voient l'humain
  // (la page 404) et le robot (noindex).
  await page.goto("/kill/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("404").first()).toBeVisible();
  expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
});
