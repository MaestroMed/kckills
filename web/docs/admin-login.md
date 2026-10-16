# Connexion admin

1. `https://www.kckills.com/admin/login` → onglet **jeton**.
2. Coller la valeur de `KCKILLS_ADMIN_TOKEN` (Vercel → projet kckills → Settings → Environment Variables).
3. Cookie `kc_admin` (JWT signé, 30 jours). Il ouvre aussi les pages cachées (`lib/hidden-routes`, ex. `/themes`).

La variable est « sensible » : Vercel ne la réaffiche jamais. Pour la changer :
générer une valeur aléatoire, `vercel env rm KCKILLS_ADMIN_TOKEN production`, puis
`vercel env add KCKILLS_ADMIN_TOKEN production --sensitive`, et redéployer (un commit
qui touche `web/` sur `main`). Les cookies déjà émis restent valides (ils dépendent de
`KCKILLS_ADMIN_JWT_SECRET`, pas du jeton).

Dernier changement : 16/10/2026 (l'ancienne valeur était introuvable).
