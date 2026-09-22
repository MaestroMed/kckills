// ESLint 9 flat config — gabarit officiel create-next-app 16 (Core Web Vitals + TypeScript).
// `next lint` a été retiré de Next 16 : le lint tourne avec `eslint` directement.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // babel-plugin-react-compiler est actif : ces règles signalent les composants
    // que le compilateur saute (setState synchrone dans un effet, ref lue au
    // rendu, rendu impur). 198 occurrences au premier lint (23/09/2026) : dette
    // SUIVIE en warning, corrigée composant par composant — pas masquée.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", "docs/**"]),
]);
