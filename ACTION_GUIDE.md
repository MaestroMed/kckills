# KCKILLS — GUIDE D'ACTIONS UTILISATEUR

Ce document liste **TOUT ce que tu dois faire de ton cote**. Claude (moi) ne peut
pas creer de comptes, acheter un domaine, ni saisir de carte bancaire a ta place.

Ordre recommande : fais les taches dans l'ordre, chaque bloc depend du precedent.

---

## 🚦 LEGENDE DES PRIORITES

- 🔴 **CRITIQUE** — sans ca, rien ne peut etre deploye en prod
- 🟠 **IMPORTANT** — necessaire pour le pipeline clips
- 🟡 **RECOMMANDE** — pour le monitoring et la qualite
- 🟢 **OPTIONNEL** — nice to have

Dans chaque bloc : **Gratuit** ou **Payant**, et le temps estime.

---

## BLOC 1 — INFRASTRUCTURE DE BASE (obligatoire pour deployer)

### 1.1 🔴 Supabase — base de donnees + authentification
- **Gratuit** (500 MB DB, 5 GB egress, 50K MAU)
- **Temps : 5 min**

1. Va sur https://supabase.com → clic "Start your project" → Sign up Github
2. "New project" →
   - Nom : `kckills`
   - Password : genere un mot de passe fort, sauvegarde-le dans 1Password/Bitwarden
   - Region : **West EU (Paris)** (le plus proche pour les latences FR)
   - Plan : Free
3. Attends ~2 min le provisioning
4. Va dans **Project Settings → API** :
   - Copie `Project URL` → a mettre dans `.env.local` comme `NEXT_PUBLIC_SUPABASE_URL`
   - Copie `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copie `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**SECRET**, jamais expose cote client)
5. Envoie-moi un message "supabase ready" et je te genere le fichier `supabase/migrations/001_initial_schema.sql` + je t'aide a l'executer dans le SQL Editor.

**Important** : Supabase met le projet en pause apres 7 jours d'inactivite. Le worker
aura un heartbeat qui ping toutes les 6h pour eviter ca.

### 1.2 🔴 Domaine — kckills.com ou kckills.com
- **Payant** : .com ~13 €/an, .gg ~90 €/an, .fr ~8 €/an
- **Temps : 10 min**

Registrar recommandes :
- **Gandi** (FR, support francais) : https://gandi.net
- **Namecheap** (plus mondial) : https://namecheap.com
- **Cloudflare Registrar** (prix coutant, pas de marge) : https://dash.cloudflare.com/?to=/:account/registrar

Recommandation personnelle : si tu veux un nom marquant et as 90€, va sur `.gg`.
Sinon `.com` pour l'universalite.

**Reserve aussi** :
- `www.kckills.com` (CNAME vers le A record)
- `clips.kckills.com` (CNAME vers R2, voir 1.4)
- `api.kckills.com` (optionnel, pour la phase λ)

### 1.3 🔴 Vercel — deploy frontend
- **Gratuit** (hobby tier : 100 GB bandwidth, illimite en builds)
- **Temps : 10 min**

1. Va sur https://vercel.com → Sign up avec Github
2. "Add New → Project" → import `Karmine_Stats` repo
3. Framework preset : **Next.js**
4. **Root Directory** : `web` (TRES important, sinon ca build pas)
5. Build command : `next build`
6. Environment Variables : on les ajoutera ensemble quand tu auras toutes les cles
7. Deploy (va echouer la premiere fois car pas de variables → c'est OK)

Plus tard :
- Settings → Domains → Add `kckills.com` et `www.kckills.com`
- Vercel te donnera 2 records DNS a ajouter chez ton registrar

### 1.4 🔴 Cloudflare R2 — stockage clips
- **Gratuit** (10 GB storage, egress ILLIMITE gratuit)
- **Temps : 10 min**

1. Sign up https://dash.cloudflare.com (Workers & Pages est sur le meme compte)
2. Sidebar → **R2 Object Storage** → "Enable R2" (demande une CB mais ne facture rien sous les free limits)
3. "Create bucket" → nom `kckills-clips` → Location auto
4. **Settings du bucket** → "Public access" → Custom Domains → ajouter `clips.kckills.com`
5. Cloudflare va demander de verifier le domaine (tu dois l'avoir achete en 1.2 ou le gerer chez Cloudflare)
6. Retour au dashboard R2 → **Manage R2 API Tokens** → "Create API Token"
   - Permissions : Object Read & Write sur `kckills-clips` uniquement
   - TTL : no expiry
7. Copie :
   - `Access Key ID` → `R2_ACCESS_KEY_ID`
   - `Secret Access Key` → `R2_SECRET_ACCESS_KEY`
   - `Endpoint URL` (forme `https://<accountid>.r2.cloudflarestorage.com`) → `R2_ENDPOINT`
   - `R2_BUCKET=kckills-clips`

**Commande CLI de test :**
```bash
# Install aws cli
aws configure set aws_access_key_id YOUR_KEY --profile r2
aws configure set aws_secret_access_key YOUR_SECRET --profile r2
aws --profile r2 --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com s3 ls s3://kckills-clips
```

---

## BLOC 2 — AUTHENTIFICATION (Discord OAuth)

### 2.1 🔴 Discord Developer Portal
- **Gratuit**
- **Temps : 5 min**

1. Va sur https://discord.com/developers/applications → "New Application"
2. Nom : `KCKILLS`
3. Onglet **OAuth2** :
   - Copie `CLIENT ID` → `DISCORD_CLIENT_ID`
   - "Reset Secret" → copie `CLIENT SECRET` → `DISCORD_CLIENT_SECRET` (**SECRET**)
   - **Redirects** → Add Redirect :
     - `https://VOTRE_SUPABASE_URL.supabase.co/auth/v1/callback` (recupere l'URL exacte dans Supabase → Authentication → Providers → Discord)
     - Aussi `http://localhost:3000/auth/callback` pour le dev local
4. Scopes : `identify` et `email` (pas de guilds ou autres, respect vie privee)

### 2.2 🔴 Brancher Discord dans Supabase
1. Supabase → **Authentication → Providers → Discord** → Enable
2. Colle `CLIENT ID` et `CLIENT SECRET` de 2.1
3. Sauvegarde
4. Dans Site URL : `https://kckills.com` (ou localhost en dev)
5. Redirect URLs : `https://kckills.com/**`

---

## BLOC 3 — IA POUR LE PIPELINE CLIPS

### 3.1 🟠 Google Gemini AI Studio — analyse des clips
- **Gratuit** (1000 requests/jour sur 2.5 Flash-Lite)
- **Temps : 2 min**

1. Va sur https://aistudio.google.com/apikey
2. Clic "Create API Key" → choisis un projet Google Cloud (ou cree-en un : `kckills`)
3. Copie la cle → `GEMINI_API_KEY`

⚠️ **Attention data privacy** : en free tier, Google peut utiliser tes prompts pour
entrainer ses modeles. Pour KCKILLS ce n'est pas grave car on n'envoie que des clips
publics de matches LEC, mais **JAMAIS envoyer de donnees users** (comments, emails) a
Gemini. On utilise Claude Haiku pour ca (cf 3.2).

### 3.2 🟠 Anthropic API — moderation commentaires
- **Payant** : $1/M input tokens, $5/M output tokens → **~4 €/mois** pour 500 comments/jour
- **Temps : 5 min**

1. Va sur https://console.anthropic.com → Sign up
2. Settings → **API Keys** → "Create Key" → nom `kckills-prod`
3. Copie la cle → `ANTHROPIC_API_KEY` (**SECRET**)
4. **Billing → Add Credit** → 10 € minimum (couvre ~2 mois)
5. Settings → **Usage Limits** → Set monthly limit a 15 € (par securite)

### 3.3 🟠 YouTube Data API v3 — fallback VOD discovery
- **Gratuit** (10 000 quota units/jour ≈ 100 recherches/jour)
- **Temps : 5 min**

1. Va sur https://console.cloud.google.com
2. "New Project" → nom `kckills`
3. **APIs & Services → Library** → cherche "YouTube Data API v3" → **Enable**
4. **Credentials → Create Credentials → API Key**
5. **Restrict Key** :
   - Application restrictions : None (pour le worker serveur)
   - API restrictions : "Restrict key" → cocher "YouTube Data API v3"
6. Copie → `YOUTUBE_API_KEY`

### 3.4 🟢 Groq API (optionnel, ultra-rapide, gratuit)
- **Gratuit** (rate limit 30 req/min)
- **Temps : 2 min**

Si tu veux un fallback pour l'analyse des clips quand Gemini est quota-out :
1. https://console.groq.com → Sign up
2. API Keys → Create → `GROQ_API_KEY`

---

## BLOC 4 — NOTIFICATIONS & COMMUNAUTE

### 4.1 🟡 Discord Webhook — logs du worker
- **Gratuit**
- **Temps : 2 min**

1. Cree (ou utilise) un serveur Discord perso, par exemple `KCKILLS-DEV`
2. Channel `#worker-logs` → ⚙️ → **Integrations → Webhooks → New Webhook**
3. Copie l'URL → `DISCORD_WEBHOOK_URL`

### 4.2 🟡 Discord Bot (pour poster les kills auto)
- **Gratuit**
- **Temps : 5 min**

1. Retour dans https://discord.com/developers/applications → ton app `KCKILLS` (celle de 2.1)
2. Sidebar → **Bot** → "Reset Token" → copie → `DISCORD_BOT_TOKEN` (**SECRET**)
3. Intents : `MESSAGE CONTENT` + `SERVER MEMBERS` → Save
4. **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Permissions : `Send Messages`, `Embed Links`, `Attach Files`
   - Copie l'URL generee → ouvre-la dans un navigateur → invite le bot sur ton serveur KC

### 4.3 🟡 VAPID Keys — Push Notifications PWA
- **Gratuit**
- **Temps : 2 min**

Depuis ton terminal local :
```bash
cd C:/Users/Matter1/Karmine_Stats/web
npx web-push generate-vapid-keys
```

Tu obtiens :
```
=======================================
Public Key:
BM... (long string)

Private Key:
XX... (shorter string)
=======================================
```

- `Public Key` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `Private Key` → `VAPID_PRIVATE_KEY` (**SECRET**)
- `VAPID_SUBJECT` = `mailto:toi@kckills.com`

---

## BLOC 5 — MONITORING & ANALYTICS

### 5.1 🟡 Sentry — error tracking
- **Gratuit** (5000 errors/month)
- **Temps : 5 min**

1. https://sentry.io → Sign up Github
2. "Create project" → Platform **Next.js** → Alert frequency : On every new issue
3. Tu obtiens un DSN de la forme `https://xyz@o123.ingest.sentry.io/456`
4. Copie → `SENTRY_DSN` et `NEXT_PUBLIC_SENTRY_DSN`
5. Settings → Projects → kckills → "Client Keys" → note le DSN pour plus tard

### 5.2 🟡 Vercel Analytics
- **Gratuit** (partiellement, 2500 events/mois en hobby)
- Active directement dans le dashboard Vercel → Analytics → Enable

### 5.3 🟢 Plausible self-hosted (alternative privacy-friendly)
- Optionnel, remplace Vercel Analytics
- **Temps : 30 min + VPS a ~5 €/mois**

Si tu veux un analytics totalement prive et non-tracking :
1. Loue un VPS Hetzner/DigitalOcean a 5€/mois
2. Docker install Plausible : https://plausible.io/docs/self-hosting
3. DNS `stats.kckills.com` → IP du VPS
4. Dans Next.js : `<script defer data-domain="kckills.com" src="https://stats.kckills.com/js/script.js"></script>`

### 5.4 🟢 Upstash Redis — rate limiting
- **Gratuit** (10 000 commands/day)
- **Temps : 3 min**

1. https://upstash.com → Sign up
2. Create Redis DB → Region `EU-WEST-1` → Free tier
3. Copie :
   - `UPSTASH_REDIS_REST_URL` 
   - `UPSTASH_REDIS_REST_TOKEN`

---

## BLOC 6 — DOMAINE & DNS (apres avoir achete le domaine)

Quand tu as ton domaine et ton Vercel project, tu dois configurer DNS. Exemple pour Gandi :

### Records a creer
```
A     @                 76.76.21.21              (IP Vercel)
CNAME www               cname.vercel-dns.com
CNAME clips             <ton-bucket>.r2.cloudflarestorage.com
TXT   @                 <valeur de verification Vercel>
```

Vercel te donnera les valeurs exactes dans **Settings → Domains** apres avoir ajoute
le domaine. Compte ~1h pour la propagation DNS.

### Verifier le setup
```bash
dig kckills.com
dig www.kckills.com
dig clips.kckills.com
```

---

## BLOC 7 — SERVICE MANAGEMENT LOCAL (worker 24/7)

### 7.1 🟡 Windows Task Scheduler
- **Gratuit**
- **Temps : 10 min**

Pour que le worker Python redemarre auto au boot de ton PC :

1. Ouvre "Planificateur de taches" (Task Scheduler)
2. Action → **Creer une tache** (pas "basique")
3. Onglet **General** :
   - Nom : `KCKILLS Worker`
   - "Executer que l'utilisateur soit connecte ou non"
   - "Executer avec les privileges les plus eleves"
4. Onglet **Declencheurs** → Nouveau :
   - Au demarrage (au demarrage du systeme)
5. Onglet **Actions** → Nouveau :
   - Action : Demarrer un programme
   - Programme : `C:\Python312\python.exe` (ou ton chemin Python)
   - Arguments : `C:\Users\Matter1\Karmine_Stats\worker\main.py`
   - Commencer dans : `C:\Users\Matter1\Karmine_Stats\worker`
6. Onglet **Parametres** :
   - "Si la tache echoue, redemarrer toutes les" : 1 minute
   - "Tentative de redemarrage" : 999

### 7.2 🟢 Alternative : Docker Desktop + docker-compose
Si tu prefere Docker :
1. Install https://www.docker.com/products/docker-desktop/
2. Dans `worker/` il y a un `Dockerfile` (a creer si absent)
3. `docker-compose up -d` → tourne en background, auto-restart

---

## 📋 CHECKLIST GLOBALE — Ce que tu dois cocher

### Bloc 1 — Infrastructure
- [ ] Compte Supabase cree + projet `kckills` provisionne
- [ ] Cles Supabase copiees dans 1Password
- [ ] Domaine achete chez Gandi/Namecheap/Cloudflare
- [ ] Compte Vercel cree et repo Github importe
- [ ] Compte Cloudflare + bucket R2 `kckills-clips` + API token

### Bloc 2 — Auth
- [ ] App Discord cree avec Client ID/Secret
- [ ] Discord provider active dans Supabase

### Bloc 3 — IA
- [ ] Gemini API key cree
- [ ] Anthropic API key + 10 € de credit
- [ ] YouTube Data API v3 key cree

### Bloc 4 — Social
- [ ] Discord webhook pour logs worker
- [ ] Discord bot token (si post auto voulu)
- [ ] VAPID keys generees

### Bloc 5 — Monitoring
- [ ] Sentry project cree avec DSN
- [ ] (Optionnel) Upstash Redis

### Bloc 6 — Domaine
- [ ] DNS configure
- [ ] Domaine ajoute dans Vercel et verifie
- [ ] https://kckills.com repond

### Bloc 7 — Worker
- [ ] Task Scheduler configure (ou docker-compose)

---

## 🔐 OU SAUVEGARDER TOUTES CES CLES

**Strictement recommande** : un gestionnaire de mots de passe.

- **1Password** : 3 €/mois, excellent, partage secu avec famille
- **Bitwarden** : gratuit, open-source, self-hostable
- **Apple Keychain / iCloud** : gratuit si tu es apple-only

Cree une section dedie `KCKILLS Production` et stocke chaque cle avec le nom exact de
la variable d'environnement (ex: `NEXT_PUBLIC_SUPABASE_URL`).

**Ne jamais committer ces cles dans Git**. Le fichier `.env.local` doit etre dans
`.gitignore` (il l'est deja).

---

## 📄 FICHIER .env.local FINAL

Quand tu auras tout, ton `web/.env.local` ressemblera a ca :

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Discord OAuth
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=abcdefg...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...
DISCORD_BOT_TOKEN=MTExMTExMTExMTExMTExMTExMQ...

# Cloudflare R2
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://abc123.r2.cloudflarestorage.com
R2_BUCKET=kckills-clips
NEXT_PUBLIC_R2_PUBLIC_URL=https://clips.kckills.com

# VAPID (PWA push)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BM...
VAPID_PRIVATE_KEY=xx...
VAPID_SUBJECT=mailto:toi@kckills.com

# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://xxx@o123.ingest.sentry.io/456
SENTRY_DSN=https://xxx@o123.ingest.sentry.io/456

# Upstash Redis (optionnel)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

Et ton `worker/.env` ressemblera a ca :
```bash
# Supabase (service role pour ecrire sans RLS)
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# R2
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://abc123.r2.cloudflarestorage.com
R2_BUCKET=kckills-clips

# IA
GEMINI_API_KEY=AIzaSy...
ANTHROPIC_API_KEY=sk-ant-...
YOUTUBE_API_KEY=AIzaSy...

# Discord webhook
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...

# LoL Esports API
LOLESPORTS_API_KEY=0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z
```

---

## 💰 COUT MENSUEL ESTIME

| Service | Plan | Cout/mois |
|---------|------|-----------|
| Supabase | Free | 0 € |
| Vercel | Hobby | 0 € |
| Cloudflare R2 | Free (<10GB) | 0 € |
| Gemini 2.5 Flash-Lite | Free tier | 0 € |
| Anthropic Haiku | ~500 comments/jour | ~4 € |
| YouTube Data API | Free | 0 € |
| Sentry | Free tier | 0 € |
| Domaine `.gg` | - | ~8 €/mois (~90€/an) |
| Domaine `.com` | - | ~1 €/mois |
| Electricite PC 24/7 (~60W) | - | ~5 €/mois |
| Upstash Redis | Free | 0 € |
| **TOTAL (avec .com)** | | **~10 €/mois** |
| **TOTAL (avec .gg)** | | **~17 €/mois** |

Premier mois : +10 € credit Anthropic au demarrage. Budget : **25 € pour le launch**.

---

## ⏱️ TEMPS TOTAL ESTIME

Si tu enchaines tout d'un coup sans interruption :

- Bloc 1 : **45 min**
- Bloc 2 : **10 min**
- Bloc 3 : **15 min**
- Bloc 4 : **10 min**
- Bloc 5 : **10 min**
- Bloc 6 : **20 min** (+ 1h propagation DNS)
- Bloc 7 : **15 min**

**Total : ~2h de setup**

Tu peux diviser en 2 sessions de 1h pour pas te cramer. L'ordre critique est :
1. Supabase (1.1)
2. Discord (2.1 + 2.2)
3. Gemini + Anthropic + YouTube (3.1 + 3.2 + 3.3)
4. R2 (1.4)
5. Vercel (1.3) + domaine (1.2 + 6)
6. Le reste au fil de l'eau

---

## 🚨 CE QUE JE PEUX FAIRE PENDANT QUE TU FAIS TOUT CA

Je ne bloque pas sur toi. Pendant que tu crees tes comptes, je peux avancer sur les
phases sans cles API :

- **Phase α** (polish immediat) : loading skeletons, favicons, menu mobile, 404 custom
- **Phase β** (SEO) : robots.txt, sitemap.xml, JSON-LD, canonical, Twitter cards
- **Phase γ** (motion) : Framer Motion entry animations, compteurs animes, GSAP timeline cinematique, Lottie penta explosions
- **Phase δ** (contenu) : stats avancees, graphiques recharts, pages alumni, hall of fame, comparateur joueurs
- **Phase θ** (PWA) : service worker, icons multi-tailles, splash screens
- **Phase ι** (i18n) : version anglaise complete
- **Phase κ** (qualite) : Storybook, tests Playwright, design tokens

Dis-moi simplement **"claude, tu peux bosser sur la phase α et γ pendant que je fais le bloc 1"**
et je lance en parallele. Je te notifie quand c'est fini.

---

## 🎯 LE CHEMIN CRITIQUE VERS "ETO LE MONTRE EN STREAM"

Si ton objectif est de pouvoir le montrer en live chez Eto/Kameto, voici le minimum :

1. Phase α + β + γ + δ partielle → site visuellement impressionnant (Claude, 12 jh)
2. Bloc 1 + Bloc 2 + Bloc 6 → site en prod sur kckills.com (toi, 1.5h + 1 jh Claude)
3. Phase ε → monitoring en place (Claude, 0.5 jh)

**Livrable minimal stream-ready** : ~14 jh Claude + 2h toi + attente DNS.

Pour avoir les vraies clips in-scroll pendant le stream, il faut **aussi** :
4. Bloc 3 → cles IA (toi, 15 min)
5. Phase ζ → pipeline worker (Claude, 10 jh)
6. Backfill 83 matchs → ~674 clips generes (2-3 jours CPU temps reel)

**Livrable stream-ready complet avec clips** : ~24 jh + 2h15 toi + 3j CPU.

---

*La route est longue mais chaque etape est concrete. Ne fais pas tout d'un coup,
prends-le sprint par sprint. Et demande-moi de l'aide a chaque blocage.*
