// Images de repli des étendards adverses (thèmes de match, lib/home-themes) :
// pour chaque équipe du Mondial 2026, capture l'étendard de droite du labo
// avec ?theme=mondial-2026-<code>, puis le range dans
// public/images/etendards/teams/<CODE>/etendard-droite.webp.
// Usage (serveur de dev lancé) : node scripts/team-posters.mjs [CODE…]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const src = readFileSync("src/lib/team-brands.ts", "utf8");
const all = [...src.matchAll(/code: "([A-Z0-9]+)"/g)].map((m) => m[1]).filter((c) => c !== "KC");
const codes = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const code of codes) {
  const tmp = `out/posters-${code}`;
  execFileSync("node", ["scripts/banner-poster.mjs", tmp, `mondial-2026-${code.toLowerCase()}`], { stdio: "inherit" });
  const dir = `public/images/etendards/teams/${code}`;
  mkdirSync(dir, { recursive: true });
  execFileSync("python", ["-c", `from PIL import Image; Image.open("${tmp}/etendard-droite.png").save("${dir}/etendard-droite.webp", "WEBP", quality=90, method=6)`]);
  console.log("ok", code);
}
