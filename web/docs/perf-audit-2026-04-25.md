# Perf audit — 2026-04-25 (Wave 7, Agent AE)

## Methodology

PageSpeed Insights API (mobile strategy) was rate-limited at 0/day for the
shared Google Cloud project — `RESOURCE_EXHAUSTED` on every call to
`pagespeedonline.googleapis.com` and `chromeuxreport.googleapis.com`
(403, no API key). Switched to direct production fetches via `curl` against
`https://www.kckills.com/{route}` plus static-asset HEAD probes to derive
TTFB, payload size, cache headers, and the JS chunk waterfall. Numbers below
are real network measurements taken from a `cdg1` Vercel edge POP, not
synthetic Lighthouse runs.

A retry against PSI from a different IP / authenticated key is the only way
to get the official Lighthouse score numbers. The ratios + raw payload
sizes captured here are sufficient to identify the highest-impact wins.

## Per-page raw measurements

| Route | TTFB | HTML size | First-load JS | Total first-load |
|-------|------|-----------|---------------|------------------|
| `/scroll` | 339 ms (apex→www 307) | **3 289 KB** | 1 680 KB | **~4.97 MB** |
| `/` | 198 ms | 348 KB | 1 680 KB (shared) | ~2.0 MB |
| `/kill/[id]` | 331 ms | 73 KB | 1 680 KB (shared) | ~1.75 MB |
| `/search?q=Caliste` | 187 ms | **404** (production not yet rebuilt with the SearchBar Suspense fix from 950feab) | — | — |

### Critical: /scroll is shipping 307 video items in the SSR HTML

`grep -c 'kind\\":\\"video\\"' /tmp/scroll.html → 307`. Each item carries
~10 KB of JSON (clip URLs ×4 quality levels + 4 lang descriptions + tags +
match meta). At 5 visible items max in the viewport, **>95% of the SSR
payload is dead weight on first paint** — driving LCP, TBT and total-byte
penalties.

### Critical: apex domain redirects to www

`https://kckills.com/scroll` → `307 https://www.kckills.com/scroll`. Costs
~250 ms of TTFB before the real response starts. Most users typing the
short URL pay this every cold load.

## Top-5 actionable diagnostics

### 1. /scroll HTML payload (3.3 MB → target <500 KB)
**Impact:** ~2.8 MB of bytes on the wire = +5-8s of LCP on a 3G connection,
+1500 ms TBT from the React reconciliation of 307 client tree nodes.
**Fix:** SSR-render the first 20 items, defer the rest to a client-side
`useEffect` chunked-fetch (or push the long tail through `/api/feed?cursor=…`).
The infinite scroll already exists; the SSR slice just needs to be bounded.
*[Out of scope for this PR — touches ScrollFeed loader logic, deserves its
own ticket. Filed as follow-up below.]*

### 2. R2 CDN preconnect missing (clips.kckills.com)
**Impact:** First poster image triggers a fresh DNS+TLS handshake to
`clips.kckills.com` only after the HTML stream completes parsing the
`<Image>` tag. ~120-150 ms saved on FCP/LCP for mobile clients on 4G.
**Fix:** add `<link rel="preconnect" href="https://clips.kckills.com">`
in the root layout `<head>`. **SHIPPED in this PR.**

### 3. ddragon.leagueoflegends.com preconnect missing
**Impact:** Champion icons on `/`, `/kill/[id]`, `/player/[slug]` come from
`ddragon.leagueoflegends.com`. Same ~120 ms penalty. **Fix:** preconnect.
**SHIPPED in this PR.**

### 4. Render-blocking Google Fonts: duplicate preload + non-async stylesheet
**Impact:** Current layout has BOTH a `<link rel="preload" as="style">` AND
a `<link rel="stylesheet">` for the same Google Fonts URL. The stylesheet
form is render-blocking until the fonts CSS resolves. The preload form is
the standard non-blocking path — the `<link rel=stylesheet>` should use
`media="print" onLoad="this.media='all'"` to not block, OR drop the
duplicate and rely on the preload + a small inline `<style>` fallback.
**Fix:** convert the stylesheet to non-blocking `media="print"` + onLoad
swap. **SHIPPED in this PR.**

### 5. Apex → www 307 redirect on every cold load
**Impact:** ~250 ms TTFB tax on `kckills.com/*` (vs direct hit on
`www.kckills.com/*`). **Fix:** Vercel project domain config — set apex
as the primary, or redirect at the DNS level. *[Out of scope for code
change — needs Vercel dashboard tweak. Filed as follow-up.]*

## Fixes shipped in this PR

| # | Fix | Expected delta |
|---|-----|----------------|
| 1 | Preconnect `clips.kckills.com` (R2 video CDN) | LCP −120 ms |
| 2 | Preconnect `ddragon.leagueoflegends.com` (champion icons) | LCP −80 ms on home/kill/player pages |
| 3 | Preconnect `*.r2.cloudflarestorage.com` (legacy R2 path) | LCP −60 ms when used |
| 4 | Make Google Fonts stylesheet non-blocking (`media=print` swap) | FCP −150 ms (eliminates render-blocking CSS) |
| 5 | Drop the duplicate `<link rel=preload as=style>` (now redundant) | Tiny (~5 KB HTML payload) but cleaner |

Net expected mobile delta on `/`: **+8 to +12 Lighthouse perf points** (FCP
and LCP each move ~200 ms on a 4G profile).

## Follow-ups (not shipped — bigger surgery)

- **/scroll SSR slice cap** — paginate the items prop to 20 and stream the
  rest. Estimated +20 perf points on /scroll mobile but requires touching
  ScrollFeedV2 + plumbing a cursor-based loader.
- **Apex domain Vercel config** — make `kckills.com` the canonical, drop
  the 307 redirect.
- **`/_next/image` long cache TTL** — Vercel currently emits
  `public, max-age=31536000, must-revalidate`. R2 origin already serves
  `immutable`. Could swap `must-revalidate` for `immutable` via Vercel
  image config (small, but free win).
- **next/script Umami strategy** — currently `afterInteractive` + `defer`.
  Could move to `lazyOnload` to defer past LCP.
- **PR12.1 candidate**: lazy-load `framer-motion` via dynamic import on
  `template.tsx` (route transition) — saves ~21 KB on every route's first
  load JS. The LazyMotion+domAnimation in Providers.tsx already shaves
  21 KB; we can shave another ~10 KB by deferring the `m.div` mount.

## Constraint compliance

- TypeScript strict: `pnpm tsc --noEmit` exits 0 (verified)
- Mobile-first: all fixes target the mobile critical path (FCP/LCP)
- Did NOT touch: `worker/`, `web/src/app/settings/*`,
  `web/src/components/community/*`, `supabase/migrations/038_*`,
  service-worker code
- Did NOT bump Next.js or React versions
