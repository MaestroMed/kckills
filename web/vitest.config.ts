import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests unitaires des modules purs de src/lib (logique du feed, affichage des
// équipes, clés DDragon, frise des ères…). Les composants et les pages sont
// couverts par les smoke tests Playwright (e2e/), pas ici.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
