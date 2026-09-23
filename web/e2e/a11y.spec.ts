import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibilité (WCAG 2.1 AA, exigence de la spec §2.4) : audit axe-core des
 * pages publiques clés. Seules les violations « serious » et « critical »
 * font échouer ; le rapport complet s'affiche dans la sortie du test.
 */
const PAGES = ["/", "/scroll", "/clips", "/matches", "/players"];

for (const path of PAGES) {
  test(`a11y ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    for (const v of results.violations) {
      console.log(`[${v.impact}] ${v.id} (${v.nodes.length}) — ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}`);
    }
    expect(blocking.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
  });
}
