# LoLTok i18n Migration Plan

**Status:** Scaffold complete (Wave 5 — PR-loltok BE). Component migration pending.
**Owner:** Mehdi (Numelite).
**Last update:** 2026-04-25.

---

## 1. Current state

Until this wave, every UI string in `web/src/components/**` and `web/src/app/**`
was hardcoded in French. Two server-side helpers and one client component
already supported per-clip multilingual descriptions :

- `web/src/lib/i18n/lang.ts` — `Lang` type (4 codes : fr, en, ko, es) + meta + Accept-Language parser.
- `web/src/lib/i18n/use-lang.tsx` — `LangProvider` + `useLang()` + `useCurrentLang()`.
- `web/src/lib/i18n/server.ts` — `getServerLang()` reads cookie → header → fallback.
- `web/src/components/i18n/Description.tsx` — picks `ai_description_<lang>` for a kill row.
- `web/src/components/i18n/LangSwitcher.tsx` — header dropdown.
- `web/src/components/settings/LanguageSettings.tsx` — full picker on `/settings`.

What was missing : a translation **dictionary** system for static UI strings
(buttons, nav labels, error messages, form copy, etc). This wave adds the
scaffold ; component migration is per-feature work in subsequent waves.

## 2. Target state

Every visible string in the UI is wrapped in a `t()` call :

```tsx
// BEFORE
<button>Noter</button>

// AFTER (client)
const t = useT();
<button>{t("common.rate")}</button>

// AFTER (server / RSC)
const { t } = await getServerT();
<button>{t("common.rate")}</button>
```

Every key lives in `web/src/lib/i18n/locales/{fr,en,ko,es}.ts`. The FR
file is the canonical reference — its type (`FrDict`) is imported by the
others, so TypeScript will reject any locale file that drifts in shape.

## 3. Lookup + fallback contract

The `useT()` hook walks dotted-path keys :

```
t("feed.mode_live")  →  locales[lang].feed.mode_live
                    →  fallback : locales.fr.feed.mode_live
                    →  fallback : "feed.mode_live" (debug : key as text)
```

Variable interpolation : `t("rating.n_ratings", { n: 42 })` → `"42 notes"`.

This means **adding a key to FR alone does not break the build** — it just
gracefully degrades to FR for other locales. Translators can catch up
asynchronously via a single PR per locale.

## 4. Migration order (priority)

Each entry is `<feature> — <effort> — <impact> — <files-touched-estimate>`.

### Wave 6A — High-impact navigation (1 day)

These hit every page the user sees. Migrate first.

1. **`web/src/components/Header.tsx`** — nav labels, sign-in CTA. ~10 strings.
2. **`web/src/components/MobileNav.tsx`** (bottom tab bar) — ~5 strings.
3. **`web/src/components/Footer.tsx`** — Riot disclaimer, legal links. ~6 strings.
4. **`web/src/components/CommandPalette.tsx`** — placeholder, group labels. ~12 strings.
5. **404 / 500 / loading pages** (`app/not-found.tsx`, `app/error.tsx`, `app/loading.tsx`) — ~6 strings.

Risk : low. These are stateless string swaps. ETA : 4-6 hours.

### Wave 6B — Scroll feed (1.5 days)

The **flagship product surface**. Migrate as one chunk so the live feed
flips fully to the active language at once.

1. **`web/src/components/scroll/ScrollFeed.tsx`** — empty state, loading, "swipe up". ~8 strings.
2. **`web/src/components/scroll/v2/FeedItem.tsx`** — overlay labels, multi-kill badges, rating CTA. ~15 strings.
3. **`web/src/components/scroll/RateBar.tsx`** — rating prompts, sign-in nudge. ~5 strings.
4. **`web/src/components/scroll/LiveBanner.tsx`** — "KC EN LIVE" + variants. ~3 strings.
5. **`app/scroll/page.tsx`** + **`app/scroll-v2/page.tsx`** — page meta, fallback states. ~4 strings.

Risk : moderate. The autoplay timing logic and impression recording must
remain untouched. Scope strictly to string substitution.

ETA : 1-1.5 days.

### Wave 6C — Kill detail + comments (1 day)

1. **`app/kill/[id]/page.tsx`** — meta description, breadcrumb. ~6 strings.
2. **`web/src/components/KillDetail.tsx`** — labels (killer, victim, match, score). ~12 strings.
3. **`web/src/components/CommentSection.tsx`** — placeholder, submit, sign-in, no-comments empty state. ~10 strings.
4. **`web/src/components/RateStars.tsx`** — already small ; ~3 strings.
5. **`web/src/components/ReportDialog.tsx`** — full report flow, all reason labels. ~10 strings.

Risk : moderate. Comments use moderation status enums — make sure the
status → display string mapping uses `t()` and not hardcoded text.

ETA : 1 day.

### Wave 6D — Player + match + leaderboard (0.5 day)

1. **`app/player/[slug]/page.tsx`** + **`PlayerProfile.tsx`** — ~10 strings.
2. **`app/match/[slug]/page.tsx`** + **`MatchTimeline.tsx`** — ~6 strings.
3. **`app/top/page.tsx`** + leaderboard widgets — ~5 strings.
4. **Search page** (`app/search/page.tsx`, `SearchFilters.tsx`) — ~12 strings (filter labels are dense here).

Risk : low. ETA : 4 hours.

### Wave 6E — Settings + community + auth (0.5 day)

1. **`app/settings/page.tsx`** + **`LanguageSettings.tsx`** + **`NotificationSettings.tsx`** + **`DeleteAccountDialog.tsx`** — ~20 strings.
2. **`app/community/page.tsx`** + **`SubmitClipDialog.tsx`** — ~10 strings.
3. **`app/login/page.tsx`** + **`AuthCallbackHandler.tsx`** — ~6 strings.

Risk : low. ETA : 4 hours.

### Wave 6F — Admin (LOWEST priority — defer)

The admin backoffice (`/admin/*`) is an internal tool used by 1-2 people
(Mehdi + Eto). It can stay French-only for now. **Skip until after launch.**

If/when admin is migrated : ~80 strings spread across moderation queue,
kill editor, BGM uploader, scheduling tools, audit logs.

## 5. Translation QA process — Korean

Korean is the highest-risk locale because :

- LCK community has specific terminology (퍼블 vs 퍼스트 블러드, 원딜 vs 봇)
- Polite vs casual register matters (highlight clips want 반말 / casual)
- The translator's first pass (this wave's `ko.ts`) is best-effort

**Before launch**, a fluent Korean speaker (ideally an LCK fan) must :

1. Read every entry in `web/src/lib/i18n/locales/ko.ts`
2. Especially review entries marked `// TODO ko` in the source
3. Test the live UI at `?kc_lang=ko` (or via the LangSwitcher) on these critical surfaces :
   - `/scroll` — overlay readability under autoplay
   - `/kill/<id>` — comments + rating flow
   - `/settings` — account deletion confirmation tone
4. Open a single PR with corrections. Do NOT change keys — only translated values.

Suggested QA contact : reach out via the Karmine Discord's Korean-speaking
fans (Canna and Kyeahoo's communities have active KR-fluent supporters).

## 6. Translation QA process — English & Spanish

Lower risk than Korean (the base translations are already idiomatic) but
still benefit from a sanity pass :

- **EN** : a quick pass for tone (we lean American — "color" not "colour", "Sign in" not "Sign-in").
- **ES** : LATAM-friendly phrasing (avoid Castilian "vosotros", prefer "tú").

Volunteer translators in the Discord can each take one locale ; the FR
canonical means there's no ambiguity about what each key means.

## 7. Tooling helpers (optional, deferred)

If the dictionary grows past 500 keys, consider :

- A Node script `scripts/check-i18n-keys.ts` that walks all four locale
  files, asserts they share the same key set, and lists divergence.
  Can run in CI as a hard gate.
- An ESLint rule banning string literals in JSX (only flagging on
  `web/src/components/**` migrated files via overrides).
- A `t()`-extraction script that scans `**/*.tsx` for `t("...")` calls
  and reports keys referenced but not defined in FR.

These are nice-to-haves — don't build them until pain is felt.

## 8. Out-of-scope for this wave

Explicitly NOT done in this wave (PR-loltok BE) :

- URL-based locale routing (`/en/scroll`, `/ko/scroll`). Would require
  rewriting every `Link` href + the sitemap + adjusting the middleware
  matcher logic. Defer until post-launch when SEO data justifies it.
- Right-to-left (RTL) support. Not needed for FR/EN/KO/ES.
- Pluralization rules beyond the simple `n_ratings` / `one_rating` split.
  CLDR-grade plurals via `Intl.PluralRules` can be added later if needed.
- Date/number formatting via `Intl.*`. Most timestamps in the UI are
  already locale-agnostic ("12:34"). When migration touches dates, use
  `new Intl.DateTimeFormat(LANG_META[lang].htmlLang, ...)`.
- Translating per-clip `ai_description` text. That's a worker-side
  concern — the worker already generates `ai_description_<lang>`
  columns ; this scaffold only handles static UI strings.

## 9. Estimated total effort

| Wave   | Surface                  | ETA       |
| ------ | ------------------------ | --------- |
| 6A     | Navigation               | 0.5 day   |
| 6B     | Scroll feed              | 1.5 days  |
| 6C     | Kill detail + comments   | 1 day     |
| 6D     | Player + match + search  | 0.5 day   |
| 6E     | Settings + community     | 0.5 day   |
| 6F     | Admin (deferred)         | 1.5 days  |
| **Σ**  | **Public surface only**  | **~4 days** |
| **Σ+** | **Including admin**      | **~5.5 days** |

Plus ~1 day for KO QA + ~0.5 day for EN/ES QA = **~5-6 days for full launch-ready i18n**.

## 10. Reference — adding a new key

```bash
# 1. Open the canonical FR file
$EDITOR web/src/lib/i18n/locales/fr.ts
#    Add :  feed: { ..., new_thing: "Nouvelle chose" }

# 2. Open each other locale and mirror
$EDITOR web/src/lib/i18n/locales/en.ts  # add new_thing: "New thing"
$EDITOR web/src/lib/i18n/locales/ko.ts  # add new_thing: "새로운 것"
$EDITOR web/src/lib/i18n/locales/es.ts  # add new_thing: "Cosa nueva"

# 3. Use it
const t = useT();
return <p>{t("feed.new_thing")}</p>;

# 4. TypeScript will error if any locale file diverges from FR.
pnpm tsc --noEmit
```

---

*Wave 5 (PR-loltok BE) shipped the scaffold. Wave 6 ships the migration.*
