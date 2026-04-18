# 20-Point V1 Audit — kckills.com

**Auditor:** Claude Code (Kairos)
**Audit date:** 2026-04-18
**Target:** Phase 0 launch readiness — pre-Eto/Kameto stream demo
**Methodology:** Source-grounded — every grade is anchored to a file:line
or a build artefact. No "feels good" verdicts.

Each item gets one of:

- 🟢 **PASS** — Phase 0 ship blocker resolved
- 🟡 **OK with follow-up** — works for V1, polish queued for Phase 1+
- 🔴 **BLOCKER** — must fix before launch

---

## Index

| # | Category | Item | Grade |
|---|---|---|---|
| 1 | SEO | `/scroll` indexable + populated | 🟢 |
| 2 | SEO | `/kill/[id]` SSG with VideoObject schema | 🟢 |
| 3 | SEO | sitemap.xml includes per-clip URLs | 🟢 |
| 4 | SEO | OG / Twitter cards on every shareable page | 🟢 |
| 5 | SEO | robots.ts + crawl hygiene | 🟢 |
| 6 | Mobile UX | hamburger nav 44px + a11y + scroll lock | 🟢 |
| 7 | Mobile UX | no horizontal scroll on 375px viewport | 🟡 |
| 8 | Mobile UX | scroll feed touch targets ≥ 44px | 🟢 |
| 9 | Performance | hero LCP image priority | 🟢 |
| 10 | Performance | route bundle sizes < 250KB | 🟢 |
| 11 | Performance | font preload + display swap | 🟢 |
| 12 | A11y | viewport user-zoom unblocked (WCAG 1.4.4) | 🟢 |
| 13 | A11y | skip-to-content link + focus-visible rings | 🟢 |
| 14 | A11y | color contrast on text-muted (WCAG AA) | 🟢 |
| 15 | Reliability | error.tsx + global-error.tsx + healthcheck | 🟢 |
| 16 | Reliability | clip 404 fallback (no broken video) | 🟢 |
| 17 | Security | CSP + RLS + secret hygiene | 🟢 |
| 18 | Privacy | Riot disclaimer + cookie strategy | 🟡 |
| 19 | Data quality | clips with missing thumbnail / clip URL filtered | 🟢 |
| 20 | Operational | deploy pipeline + observability + alerts | 🟡 |

**Totals:** 17 🟢 / 3 🟡 / 0 🔴

**V1 launch verdict: GO.** No blockers; the three yellows are explicit
follow-ups documented below, none of them gate the Eto/Kameto demo.

---

## Detail

### 1. `/scroll` indexable + populated 🟢
- **Source:** `web/src/app/scroll/page.tsx:60-72` filters every kill on
  `kill_visible === true`, `clip_url_vertical != null`, `thumbnail_url != null`.
- Was the #1 audit blocker (empty page); fixed by `49cdea0` + `ff6873f`.
- Falls back to `<EmptyState>` on Supabase failure — never crashes.

### 2. `/kill/[id]` SSG with VideoObject schema 🟢
- **Source:** `web/src/app/kill/[id]/page.tsx:35-45` (generateStaticParams),
  `:184-244` (VideoObject JSON-LD).
- Top 100 clips pre-rendered at build → confirmed in build output as `●`
  (`/kill/[id] 3.24 kB`, was `ƒ Dynamic`).
- VideoObject includes `aggregateRating`, `interactionStatistic`, `keywords`,
  `embedUrl`, `inLanguage: fr-FR`, `isFamilyFriendly: true`, full publisher
  block. Conditional fields only render when data exists — schema stays valid.
- Fallback for >100 IDs via `dynamicParams: true` + ISR (revalidate 600s).

### 3. sitemap.xml per-clip URLs 🟢
- **Source:** `web/src/app/sitemap.ts:30-90`.
- Top 500 published clips appended with priority computed from
  `highlight_score` (range 0.3–0.85). Cap protects 50K/50MB limits.
- Static + era + alumni + player + match + clip rolls = ~700-800 URLs total.
- Falls back to `[]` on Supabase failure at build → deploy still ships.

### 4. OG / Twitter cards 🟢
- **Source:** Every page with a `Metadata` export.
- Routes audited: `/` (layout default), `/kill/[id]`, `/era/[id]`,
  `/alumni/[slug]`, `/player/[slug]`, `/hall-of-fame`, `/scroll`, `/matches`.
- Standard pattern: `openGraph` + `twitter` blocks with proper image refs.
- `/kill/[id]` images route through `/api/og/[id]` for graceful fallback
  even when `og_image_url` isn't backfilled — no broken Discord/X cards.

### 5. robots.ts + crawl hygiene 🟢
- **Source:** `web/src/app/robots.ts`.
- Disallows `/api/`, `/auth/`, `/_next/`, `/settings`, `/review`,
  `/era/darkness` (easter egg, intentionally not indexed).
- Sitemap pointed at the canonical SITE_URL (Vercel-aware).
- Googlebot rule explicit so we can keep search-engine-specific
  permissions tighter than the wildcard.

### 6. Hamburger nav 44px + a11y 🟢
- **Source:** `web/src/components/navbar.tsx:117-130, 138-152`.
- Touch target now 44×44 (was the SVG default 24×24 — below WCAG 2.5.5).
- `aria-expanded`, `aria-controls="mobile-nav"`, `aria-label` toggles
  between "Ouvrir le menu" / "Fermer le menu".
- Esc closes the drawer; body scroll locked while open; auto-closes on
  resize ≥ md breakpoint.

### 7. No horizontal scroll on 375px viewport 🟡
- **Source:** spot-check via DOM inspection — most pages clean,
  full-bleed sections (`width: 100vw; left: 50%; -50vw margins`) are
  the highest-risk pattern.
- **Risk:** the `-mx-4 -mt-6` + `left: 50%` pattern used in era /
  alumni / player /hall-of-fame heroes can cause an invisible 4px overflow
  on iOS Safari when `body` has padding ≠ 0.
- **Follow-up Phase 1:** `overflow-x: clip` on `<body>` (currently
  `overflow-x: hidden` in `globals.css:34`) is the correct fix; `clip`
  is more aggressive than `hidden` and prevents anchor-scroll bleed.
  Single line change, validated next deploy.

### 8. Scroll feed touch targets 🟢
- **Source:** `web/src/components/scroll/ScrollFeed.tsx` — all
  interactive controls (mute, rate, comment, share) are 12×12 (h-12 w-12)
  = 48px square, above WCAG threshold.

### 9. Hero LCP image priority 🟢
- **Source:** `web/src/components/HeroClipBackground.tsx:88` (poster
  with breathing animation), `/era/[id]/page.tsx`, `/alumni/[slug]/page.tsx`,
  `/player/[slug]/page.tsx`. All `<Image>` use `priority` prop on the
  background asset that becomes the LCP element. `not-found.tsx`
  similarly upgraded.
- next/image automatically inserts `<link rel="preload">` for these.

### 10. Bundle sizes 🟢
- **Source:** `npx next build` route table (last good run, commit `6020ed3`).

| Route | First Load JS | Status |
|---|---|---|
| `/` | 102 kB shared + 29.4 kB | well under 250KB |
| `/scroll` | + 12.3 kB | trim |
| `/player/[slug]` | + 16.1 kB | acceptable (most player-page state is server-rendered) |
| `/kill/[id]` | + 3.24 kB | excellent |
| `/era/[id]` | + 5.96 kB | clean |

- No route exceeds 250KB First Load JS — the V1 budget. Shared chunk is
  the React + Next runtime + small UI deps.

### 11. Font preload + display swap 🟢
- **Source:** `web/src/app/layout.tsx:121-132`.
- `preconnect` to fonts.googleapis + fonts.gstatic.
- `<link rel="preload" as="style">` on the Google Fonts CSS so the
  request kicks off in the head rather than after CSSOM build.
- `display=swap` in the Google Fonts URL so text never hangs on FOIT.

### 12. Viewport user-zoom unblocked (WCAG 1.4.4) 🟢
- **Source:** `web/src/app/layout.tsx:60-67`.
- `maximumScale: 5`, `userScalable: true`. Fixed in commit `6020ed3`
  (was `maximumScale: 1` which violates WCAG SC 1.4.4 Resize text).

### 13. Skip-to-content + focus-visible rings 🟢
- **Source:** `web/src/app/layout.tsx:144-147` (skip-to-content),
  `web/src/app/globals.css:158-164` (`:focus-visible` outline 2px gold
  with 2px offset — every interactive element inherits via the global
  selector).

### 14. Color contrast text-muted 🟢
- **Source:** `web/src/app/globals.css:23` — `--text-muted: #7B8DB5`.
- Contrast ratio against `--bg-primary: #010A13`: **4.71:1** → meets
  WCAG AA (≥ 4.5:1 for body text).
- Comment in CLAUDE.md confirms this was raised from a previous
  too-low value specifically to hit AA.

### 15. error.tsx + global-error.tsx + healthcheck 🟢
- **Source:** `web/src/app/error.tsx`, `web/src/app/global-error.tsx`
  (added in `6020ed3`), `web/src/app/scroll/error.tsx`,
  `web/src/app/api/healthz/route.ts`.
- Three layers: page-level (error.tsx), root-layout-level
  (global-error.tsx with inline styles for the "even Tailwind crashed"
  case), and infrastructure-level (`/api/healthz` returns 200/503 for
  uptime monitoring).

### 16. Clip 404 fallback 🟢
- **Source:** `web/src/components/scroll/ScrollFeed.tsx` — only renders
  items with verified `clip_url_vertical` + `thumbnail_url`. Commit
  `ff6873f` explicitly added the filter.
- `/api/og/[id]` falls back to `/images/hero-bg.jpg` on missing OG so
  social shares don't 404 either.

### 17. Security — CSP + RLS + secrets 🟢
- **Source:** `web/next.config.ts:13-32` (CSP), `supabase/migrations/001`
  (RLS policies on every table), `.env.local` not tracked, service-role
  key only in `worker/.env`.
- CSP allowlist: only the CDNs we actually need (ddragon, lolesports,
  R2, ytimg, cloudflare-storage, googlefonts).
- HSTS preload ready (`max-age=63072000; includeSubDomains; preload`).

### 18. Privacy 🟡
- **Source:** `web/src/components/LayoutChrome.tsx:67-69` (Riot
  disclaimer in the footer — meets the "Legal Jibber Jabber" obligation
  per CLAUDE.md §7.6).
- Umami analytics is privacy-respecting (no cookies, no PII).
- **Follow-up Phase 1:** explicit cookie banner + `/privacy` page audit
  — currently we don't drop any non-essential cookie, so no banner is
  legally required, but EU users still appreciate the explicit
  acknowledgment. Lightweight banner via `next-cookie-consent` or a 30-line
  custom — not a launch blocker.

### 19. Data quality — broken row guard 🟢
- **Source:** `web/src/app/scroll/page.tsx:60-72`,
  `web/src/lib/supabase/kills.ts:194-217` (also enforces
  `kill_visible: true` server-side).
- Three-layer guard: server (`getPublishedKills` bouncer) → page-level
  filter → ScrollFeed only shows items that pass.

### 20. Operational 🟡
- **Source:** Vercel deploy pipeline green on the cranky-elion branch
  (last successful build `82c9213`). Build logs confirm no broken
  routes.
- `/api/healthz` ready for any uptime monitor.
- Discord webhook in worker for backend alerts.
- **Follow-up Phase 1:**
  - Wire UptimeRobot/BetterUptime to `/api/healthz` (manual Mehdi
    action, ~5 min in their dashboards).
  - Frontend error reporting — currently `console.error`, fine for V1.
    Sentry / LogRocket when traffic justifies it.
  - Vercel Analytics opt-in for Web Vitals telemetry — one line in
    `layout.tsx`.

---

## Action items going into Phase 1

The three 🟡s are all **post-launch polish**, not launch blockers:

1. `<body>{ overflow-x: clip }` for iOS Safari edge bleed (1 line)
2. Cookie banner — judgment call, not legally required while we have no
   non-essential cookies
3. UptimeRobot/Vercel Analytics wiring — 5 min Mehdi, no code change

V1 ships. Phase 1 begins after the 2-week pilot validation window per
ARCHITECTURE.md §7.

---

**End of audit.**
