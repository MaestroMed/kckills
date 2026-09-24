import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de fumée end-to-end (pnpm e2e).
 *
 * - Local : lance `next start` sur E2E_PORT (défaut 3100) — faire `pnpm build`
 *   avant. Navigateur = Microsoft Edge installé (channel "msedge") : aucun
 *   téléchargement de Chromium nécessaire sous Windows.
 * - Production : `E2E_BASE_URL=https://www.kckills.com pnpm e2e` (aucun
 *   serveur local, mêmes tests en lecture seule).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // `next start` à froid sert mal 12 pages lourdes en même temps (délais
  // dépassés au 1er passage) : 4 workers suffisent (~40 s la suite).
  workers: 4,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "msedge" } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm start --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
