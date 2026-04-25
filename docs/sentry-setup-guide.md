# Sentry setup — 5-min onboarding

> Wave 11 / Agent DB. Wires Sentry error tracking into the web frontend
> (`@sentry/nextjs`) and the Python worker (`sentry-sdk[asyncio]`).
> Free tier = 5 000 events/mo + 100 000 perf events/mo per project,
> enough for the KC pilot + early LoLTok V0/V1.

This guide assumes you (the operator) have ZERO Sentry experience.
Total time : 5 minutes once you've signed up.

---

## 1. Sign up (1 min)

1. Go to https://sentry.io
2. Click **Get Started for Free** → sign up with GitHub / Google / email.
3. Pick the **Developer (Free)** plan — no credit card needed.
4. When asked for an org name, use something memorable like `kckills` or
   your handle. The slug becomes part of every URL : note it down,
   you'll paste it into env vars later.

---

## 2. Create the two projects (2 min)

We use **two separate projects** so a runaway worker error doesn't burn
the web error quota (and vice-versa).

### Project A : `kckills-web`
1. Click **+ Create Project** (top right).
2. Platform : **Next.js** (search if needed — Sentry has 100+ platforms).
3. Alert frequency : **Alert me on every new issue** (you can dial it
   back later).
4. Project name : `kckills-web`.
5. Click **Create Project**.
6. Sentry shows you a setup wizard with a DSN that looks like
   `https://abc123@oNNNN.ingest.sentry.io/PPPP`. **Copy this DSN**.
7. SKIP the wizard's install/code instructions — DB has already wired
   the SDK. We only need the DSN.

### Project B : `kckills-worker`
1. Repeat the steps above with platform = **Python**.
2. Project name : `kckills-worker`.
3. Copy the **second DSN**.

---

## 3. Paste the DSNs (1 min)

### Web (`web/.env.local`)
```bash
NEXT_PUBLIC_SENTRY_DSN=https://abc123@oNNNN.ingest.sentry.io/PPPP   # Project A
SENTRY_ENV=production
# Optional but recommended : source maps in Sentry stack traces
SENTRY_AUTH_TOKEN=                                                   # see step 4
SENTRY_ORG=kckills                                                   # your org slug
SENTRY_PROJECT=kckills-web
```

In Vercel : **Project → Settings → Environment Variables**, add the same
values for the `Production` environment (and `Preview` if you want
preview deploys traced — usually not worth the quota).

### Worker (`worker/.env`)
```bash
KCKILLS_SENTRY_DSN_WORKER=https://xyz789@oNNNN.ingest.sentry.io/QQQQ   # Project B
KCKILLS_ENV=production
KCKILLS_RELEASE=dev   # or `git rev-parse --short HEAD` if you want SHA-tagged events
```

Restart the worker (Task Scheduler / `start_daemon.bat`) for the new env to load.

---

## 4. (Optional) Source maps for readable stack traces

Without this step, Sentry shows minified JS in stack traces (`a.b.c is
not a function`). With it, you see your actual source file + line.

1. Go to https://sentry.io/settings/account/api/auth-tokens/
2. Click **Create New Token**.
3. Scopes : check `project:releases` and `org:read`.
4. Copy the token. **It's shown ONLY ONCE.**
5. Paste into `web/.env.local` :
   ```bash
   SENTRY_AUTH_TOKEN=sntrys_eyJ...
   ```
6. Add to Vercel env vars too (Production scope).

Source maps now upload automatically on every `next build` / Vercel deploy.
If the upload fails, the build still succeeds — you just don't get the
nicer stack traces on those events.

---

## 5. Verify it works (1 min)

### Web — test from browser
1. Deploy to Vercel (or run `pnpm build && pnpm start` locally with
   `NODE_ENV=production`).
2. Open DevTools console on a page :
   ```js
   throw new Error("Sentry test from kckills-web")
   ```
3. Within ~30 seconds, the error appears in the Sentry dashboard
   (Issues tab of project `kckills-web`).

### Worker — test from Python
```bash
cd worker
python -c "
from services.observability_sentry import init_sentry, is_initialized
init_sentry()
print('initialized:', is_initialized())

import sentry_sdk
sentry_sdk.capture_message('Sentry test from kckills-worker')
import time; time.sleep(2)
"
```

The message appears in the `kckills-worker` project's Issues tab.

### Both no-op when DSN unset
Confirm the wiring doesn't break when env is missing :
```bash
# Web
unset NEXT_PUBLIC_SENTRY_DSN && pnpm build   # should succeed, no Sentry init
# Worker
unset KCKILLS_SENTRY_DSN_WORKER && python main.py heartbeat   # runs as before
```

---

## 6. (Optional) Set up alerts

Sentry's defaults send an email to the project creator on every new
issue. To route to Discord / Slack instead :

1. **Discord** : `Settings → Integrations → Discord` → install →
   pick the channel (e.g. `#alerts`).
2. **Slack** : same flow with the Slack integration.

Then go to **Alerts → Create Alert Rule** :
- Trigger : "When an event is seen" + "Issue is created OR is unresolved"
- Filter : environment = `production`, level >= `error`
- Action : send to the Discord/Slack channel.

For the KC pilot scale, recommend ONE rule : "any new error in production".
You can refine later when the noise gets annoying.

---

## 7. When to upgrade

| Metric | Free | Team ($26/mo) |
|--------|------|---------------|
| Errors / mo | 5 000 | 50 000 |
| Performance events / mo | 100 000 | 1 000 000 |
| Replay sessions / mo | 50 | 500 |
| Retention | 30 days | 90 days |
| Users | 1 | Unlimited |

**Watch the Usage Stats dashboard once a month.** If errors/mo crosses
~3 000 (60% of quota) for 2 months in a row, upgrade. Likely won't
happen until LoLTok V2+ when you're scaling the timeline beyond KC.

If you hit the quota mid-month, Sentry **drops further events silently**
(it doesn't bill you ; you just lose visibility for the rest of the
month). The on-call playbook in this case : either upgrade or wait for
the monthly reset.

---

## 8. Privacy / GDPR

Both configs strip cookies, auth headers, JWTs, and known API-key
patterns BEFORE events leave the worker / browser :
- Web : `web/sentry.client.config.ts` + `sentry.server.config.ts` →
  `beforeSend` hook scrubs cookies, `Authorization`, `apikey`,
  `x-supabase-auth`, JWT-shaped strings.
- Worker : `worker/services/observability_sentry.py` →
  `_strip_sensitive_data` walks the entire event payload (request,
  breadcrumbs, extras, exception messages) and redacts cookies,
  auth tokens, Discord webhook URLs, Supabase service-role JWTs,
  Gemini / Anthropic / Riot / YouTube API keys, and YouTube cookies.

You can audit what was sent : Sentry's UI shows the raw event JSON
under the **JSON** tab on each issue. If anything sensitive slips
through, add the pattern to `_SENSITIVE_HEADER_KEYS` /
`_SENSITIVE_ENV_KEYS` in `observability_sentry.py` (or the matching
`beforeSend` in the TS configs) and redeploy.

---

## Reference : files DB owns

| File | Role |
|------|------|
| `web/sentry.client.config.ts` | Browser init |
| `web/sentry.server.config.ts` | Node runtime init |
| `web/sentry.edge.config.ts` | Edge runtime init |
| `web/instrumentation.ts` | Next 15 startup hook |
| `web/next.config.ts` | `withSentryConfig` wrap (DSN-conditional) |
| `web/package.json` | `@sentry/nextjs` dep |
| `web/.env.example` | Documents the 5 web Sentry env vars |
| `worker/services/observability_sentry.py` | `init_sentry()` + PII scrubber |
| `worker/main.py` | Calls `init_sentry()` at startup |
| `worker/requirements.txt` | `sentry-sdk[asyncio,httpx]` dep |
| `worker/.env.example` | Documents the 3 worker Sentry env vars |

To remove Sentry entirely : unset every Sentry env var. The init paths
short-circuit, the SDK never loads, and the bundle weight is the only
remaining cost (~30 KB minified for the client, ~2 MB for the worker
venv — both acceptable).
