# Admin Design System — Primitives

**Status:** Wave 12 (Agent EA) — primitives shipped, page migrations in flight.

This is the canonical reference for the admin UI primitives. Every admin page
should be built from these. If a layout need can't be expressed by the
primitives, **don't fork** — open an issue or ping Agent EA so the primitive
is extended.

All primitives live under `web/src/components/admin/ui/` and are re-exported
from the barrel `@/components/admin/ui`.

```ts
import {
  AdminPage,
  AdminSection,
  AdminCard,
  AdminTable,
  AdminBadge,
  AdminEmptyState,
  AdminSkeleton,
  AdminToastProvider,
  useAdminToast,
  AdminBreadcrumbs,
  AdminButton,
  AdminInput,
  AdminTextarea,
  AdminSelect,
  AdminCheckbox,
  AdminSearchBar,
  AdminFilterChips,
} from "@/components/admin/ui";

import {
  relativeTime,
  formatBytes,
  formatCount,
  formatDuration,
  formatLatency,
  formatPercent,
  truncateMiddle,
} from "@/lib/admin/format";
```

CSS vars used everywhere: `--gold`, `--gold-bright`, `--bg-primary`,
`--bg-surface`, `--bg-elevated`, `--border-gold`, `--border-subtle`,
`--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`,
`--green`, `--orange`, `--red`, `--cyan`, `--blue-kc`. See
`web/src/app/globals.css`.

---

## AdminPage

Top-level wrapper for every admin page. Provides breadcrumbs, header, actions,
freshness label, optional toolbar, and consistent vertical rhythm. Mobile:
header collapses on scroll past 80px.

```tsx
<AdminPage
  title="Job Queue"
  subtitle="État + reprise des jobs pipeline"
  breadcrumbs={[
    { label: "Admin", href: "/admin" },
    { label: "Pipeline", href: "/admin/pipeline" },
    { label: "Jobs" },
  ]}
  actions={
    <>
      <AdminButton variant="ghost" iconLeft="↻">Refresh</AdminButton>
      <AdminButton variant="primary">Trigger run</AdminButton>
    </>
  }
  freshness={`il y a ${secondsAgo}s`}
  toolbar={<AdminFilterChips chips={statusChips} value={status} onChange={setStatus} />}
>
  {/* sections */}
</AdminPage>
```

**Use when:** every admin page. **Don't use when:** you're building a sub-component
inside another `AdminPage` — use `AdminSection` instead.

Props:
- `title` *(required)* — `<h1>` content.
- `subtitle` — line under the title.
- `breadcrumbs` — explicit list. **Omit** to derive from `usePathname()`.
- `actions` — right-aligned slot (buttons, dropdowns).
- `freshness` — small "Mis à jour …" caption under the actions.
- `toolbar` — secondary nav slot (chips/tabs/search) below the header.
- `dense`, `disableCollapse`, `hideBreadcrumbs` — escape hatches.

---

## AdminSection

Logical block within a page. Standardised heading + spacing.

```tsx
<AdminSection
  title="Recent failures"
  subtitle="Dernières 24h"
  action={<AdminButton variant="ghost" size="sm">Voir tout</AdminButton>}
>
  <AdminTable rows={failures} columns={cols} />
</AdminSection>
```

**Use when:** a page has more than one logical block. Stack with
`<div className="space-y-8">` or rely on `AdminPage` default rhythm.
**Don't use when:** the entire page is a single block — let `AdminPage` provide
the heading.

---

## AdminCard

Generic chrome (rounded-xl + border + bg-surface). Three padding variants.

```tsx
<AdminCard title="Throughput" titleAction={<AdminBadge variant="info">live</AdminBadge>}>
  <Sparkline data={throughput} />
</AdminCard>

<AdminCard variant="dense">
  <AdminTable ... />
</AdminCard>

<AdminCard variant="compact" tone="warn">
  <p>Quota Gemini: 943 / 1000</p>
</AdminCard>
```

Variants:
- `default` *(p-5)* — most blocks.
- `compact` *(p-3)* — sidebar widgets, summary tiles.
- `dense` *(p-0)* — when the child is a table that already pads rows.

Tones: `neutral` *(default gold border)*, `good`, `warn`, `bad`, `info`.

**Use when:** any non-KPI block needs the standard frame. **Don't use when:**
you need a KPI tile — use the existing `KpiTile` (it has the sparkline +
delta-pill logic baked in).

---

## AdminTable

Wraps a real `<table>` with admin chrome: striped hover, sortable headers,
sticky-left columns, optional sticky header, row-click handler, loading
skeleton, empty state. **Below md, the table collapses to a card stack.**

```tsx
const columns: AdminTableColumn<Job>[] = [
  { id: "id", header: "ID", sticky: true, cell: (j) => <code>{truncateMiddle(j.id)}</code> },
  { id: "status", header: "État", cell: (j) => <StatusPill status={j.status} /> },
  { id: "created", header: "Créé", sortable: true, align: "right",
    cell: (j) => relativeTime(j.created_at) },
];

<AdminTable
  rows={jobs}
  rowKey={(j) => j.id}
  columns={columns}
  sort={sort}
  onSort={setSort}
  onRowClick={(j) => router.push(`/admin/pipeline/jobs/${j.id}`)}
  loading={isLoading}
  emptyState={
    <AdminEmptyState
      title="Aucun job"
      body="La queue est vide. Tout va bien."
    />
  }
  ariaLabel="File de jobs pipeline"
/>
```

Column tips:
- `sticky: true` — sticks left on horizontal scroll. Use on the row identifier.
- `hideOnMobile: true` — column is dropped from the mobile card view.
- `mobileLabel` — overrides the dt label in the mobile card view (defaults to `header`).

**Use when:** any list of homogeneous rows. **Don't use when:** the data is
heterogeneous (use `AdminCard` blocks side by side), or when each row needs
heavy custom layout (a custom card grid is fine — just keep using `AdminBadge`
+ `AdminButton` + tokens).

---

## AdminBadge

Semantic status pill. `success | warn | danger | neutral | info | pending`.

```tsx
<AdminBadge variant="success" icon="✓">Publié</AdminBadge>
<AdminBadge variant="warn">Quota proche</AdminBadge>
<AdminBadge variant="info" pulse>Live</AdminBadge>
```

**Use when:** flagging a high-level state (active / draft / archived). **Don't
use when:** the value is a pipeline-specific status like `clipping`,
`vod_found`, `manual_review` — keep using the existing `<StatusPill>` which
knows the full taxonomy.

---

## AdminEmptyState

Friendly empty state with icon + title + body + optional CTA.

```tsx
<AdminEmptyState
  icon="✓"
  title="Aucun signalement"
  body="Toutes les modérations sont à jour. Bonne journée !"
  action={<AdminButton variant="secondary">Rafraîchir</AdminButton>}
/>

{/* compact = inline / table-cell empty */}
<AdminEmptyState compact title="Aucun résultat" body="Essayez d'élargir les filtres." />
```

**Use when:** any list could legitimately be empty. **Don't use when:** the
emptiness is a loading state — that's `AdminSkeleton`'s job.

---

## AdminSkeleton

Shimmer placeholders. Variants: `text | card | row | circle | block`.

```tsx
<AdminSkeleton variant="text" />                {/* single line */}
<AdminSkeleton variant="text" count={3} />      {/* 3 stacked lines */}
<AdminSkeleton variant="card" />                {/* card-shaped block */}
<AdminSkeleton variant="row" count={5} />       {/* 5 table rows */}
<AdminSkeleton variant="circle" />              {/* avatar */}
<AdminSkeleton variant="block" width="100%" height="16rem" />
```

Reuses the global `skel-hextech` class → respects `prefers-reduced-motion`.

**Use when:** any data is loading. **Don't use when:** you're rendering an
empty list with a known final shape — use `AdminEmptyState`.

---

## AdminToast

Admin-styled toast container. Independent from the public `<ToastProvider>`.

Wrap the admin layout once:

```tsx
// somewhere high up in /admin layout (or per-page if global isn't wired yet)
<AdminToastProvider>
  {children}
</AdminToastProvider>
```

Then in any client component:

```tsx
const toast = useAdminToast();

await retryJob(jobId)
  .then(() => toast.success("Job relancé"))
  .catch((e) => toast.error(`Échec: ${e.message}`));
```

API: `success(text)`, `error(text)`, `info(text)`, `dismiss(id)`. Outside the
provider, calls are no-ops (won't crash).

**Use when:** confirming a write action or surfacing a non-blocking error.
**Don't use when:** the message needs user input — use `ConfirmDialog`.

---

## AdminBreadcrumbs

Chevron-separated trail. Auto-derives from `usePathname()` if no items prop.

```tsx
{/* explicit */}
<AdminBreadcrumbs items={[
  { label: "Admin", href: "/admin" },
  { label: "Pipeline", href: "/admin/pipeline" },
  { label: "Job 1234" },
]} />

{/* auto from pathname (no prop) */}
<AdminBreadcrumbs />
```

Already rendered by `AdminPage`. **Don't render manually unless** you turned
off the page's breadcrumbs with `hideBreadcrumbs` and want them somewhere
unusual (e.g. inside a drawer header).

---

## AdminButton

Three variants + danger. Loading state with spinner. Icon-only mode.

```tsx
<AdminButton variant="primary">Publier</AdminButton>
<AdminButton variant="secondary" iconLeft="↻">Refresh</AdminButton>
<AdminButton variant="ghost" size="sm">Annuler</AdminButton>
<AdminButton variant="danger" loading={isDeleting}>Supprimer</AdminButton>

{/* icon-only — pass aria-label */}
<AdminButton variant="ghost" iconOnly aria-label="Fermer">✕</AdminButton>
```

Sizes: `sm | md | lg`. Composes refs.

**Use when:** any clickable action button. **Don't use when:** you need a
link (use `next/link` directly + style with the same classes — or wrap with
`<Link><AdminButton>` for visual consistency).

---

## AdminInput / Textarea / Select / Checkbox

Consistent form controls with focus ring, error state, label + hint slots.

```tsx
<AdminInput
  id="user-name"
  label="Nom d'utilisateur"
  placeholder="ex. EtoStark"
  required
  value={name}
  onChange={(e) => setName(e.target.value)}
  error={nameError}
/>

<AdminTextarea label="Notes" hint="Visible par les autres admins." />

<AdminSelect label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
  <option value="all">Tous</option>
  <option value="pending">À traiter</option>
</AdminSelect>

<AdminCheckbox
  id="featured"
  label="Mettre en avant"
  hint="Apparaîtra dans le carousel home."
  checked={featured}
  onChange={(e) => setFeatured(e.target.checked)}
/>
```

Props: standard HTML attributes + `label`, `hint`, `error`, `withField`. Set
`withField={false}` to skip the chrome and render the bare control (useful in
tight toolbars).

---

## AdminSearchBar

Debounced search input with `Cmd/Ctrl+K` global focus + `Esc` to clear.

```tsx
<AdminSearchBar
  placeholder="Rechercher un clip…"
  onSearch={(q) => setQuery(q)}
  debounceMs={300}
  className="max-w-md"
/>
```

Press `Enter` to fire `onSearch` immediately (skip debounce). Press `Esc` to
clear.

**Use when:** any list page benefits from quick filtering (clips, audit, jobs,
moderation). **Don't use when:** you only have ≤10 items — use a regular
`AdminFilterChips` instead.

---

## AdminFilterChips

Horizontal toggle chips. Single-select by default, `multiple` for multi.

```tsx
{/* single-select */}
<AdminFilterChips
  chips={[
    { id: "all", label: "Toutes", count: 142 },
    { id: "pending", label: "À traiter", count: 12 },
    { id: "approved", label: "Approuvées", count: 130 },
  ]}
  value={status}
  onChange={setStatus}
/>

{/* multi-select */}
<AdminFilterChips
  multiple
  chips={tagChips}
  value={selectedTags}
  onChange={setSelectedTags}
/>
```

Generic over the chip id type — `<FilterChip<MyEnum>[]>` flows through.

---

## Format helpers (`@/lib/admin/format`)

Pure utilities. Use them anywhere — they keep wording consistent across pages.

| Helper | Output | When |
|--------|--------|------|
| `relativeTime(date)` | `"il y a 5 min"` / `"hier"` | Any timestamp display |
| `formatBytes(n)` | `"1.2 KB"` / `"3.4 MB"` | Storage, payload sizes |
| `formatCount(n)` | `"1.2K"` / `"1.5M"` | Impression / comment counts |
| `formatDuration(s)` | `"1m 23s"` / `"2h 14m"` | Clip durations, runtimes |
| `formatLatency(ms)` | `{ label: "120ms", tone: "good" }` | API latency cells |
| `formatPercent(0.123)` | `"12.3%"` | Ratios, success rates |
| `truncateMiddle(id)` | `"abc123…ef45"` | Long IDs / hashes |

Tone hints from `formatLatency` map cleanly onto `AdminBadge` variants:

```tsx
const lat = formatLatency(durationMs);
const variant = lat.tone === "good" ? "success" : lat.tone === "warn" ? "warn" : "danger";
<AdminBadge variant={variant}>{lat.label}</AdminBadge>
```

---

## Migrating an existing admin page (step by step)

Take `/admin/pipeline/jobs/page.tsx` as the canonical example.

**1. Wrap the whole page in `AdminPage`.**

```diff
-export default function JobsPage() {
-  return (
-    <div className="space-y-6">
-      <header className="flex items-end justify-between">
-        <h1 className="font-display text-3xl text-[var(--gold)]">Job Queue</h1>
-        <button onClick={refresh}>Refresh</button>
-      </header>
-      ...
-    </div>
-  );
-}
+export default function JobsPage() {
+  return (
+    <AdminPage
+      title="Job Queue"
+      subtitle="État + reprise des jobs pipeline"
+      actions={<AdminButton variant="ghost" iconLeft="↻" onClick={refresh}>Refresh</AdminButton>}
+      freshness={lastUpdatedLabel}
+    >
+      ...
+    </AdminPage>
+  );
+}
```

**2. Replace ad-hoc card chrome with `AdminCard`.**

Hunt for `rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5`
and replace with `<AdminCard>`. If the block has a heading, pass `title`
instead of rendering an inner `<h2>`.

**3. Replace bespoke tables with `AdminTable`.**

Build the `columns` array first. Move pre-existing `<StatusPill>` calls into
the `cell` renderer. Add `sortable: true` to columns that already had click
handlers on the `<th>`. Keep `onRowClick` for the row-→-detail-page pattern.

**4. Swap one-off buttons.**

Every `<button class="rounded-md bg-[var(--gold)]...">` becomes
`<AdminButton variant="primary">`. The "outline" variants become
`variant="secondary"`. The bare links-as-buttons become `variant="ghost"`.

**5. Pluck filter chips out into `AdminFilterChips`.**

If the page had a row of toggle buttons for status filtering, build a
`FilterChip[]` and drop it into the `toolbar` slot of `AdminPage`.

**6. Replace inline search inputs with `AdminSearchBar`.**

You get the `Cmd-K` shortcut + debounce for free.

**7. Replace toast calls.**

If the page used the public `useToast()` from `@/components/Toast`, swap to
`useAdminToast()` for consistent admin styling. Wrap the admin tree once with
`<AdminToastProvider>` (typically at layout level).

**8. Run `pnpm tsc --noEmit` — must exit 0.**

If a primitive is missing a prop you need, **don't fork** — extend the
primitive in a separate PR or ping Agent EA.

---

## What NOT to use these for

- **Public-side pages.** These primitives are tuned for the dense, dark,
  data-first admin context. The public site has its own visual language
  (kill cards, hero, scroll reel) and should stay independent.
- **One-off marketing or legal pages** under `/admin/*`. Those rare static
  pages can use the public components — admin primitives are for the
  dashboards, queues, moderation tools.

---

## Follow-ups (not yet primitivised)

These existing admin components are mature enough that they could become
real primitives in a future wave — flag for Agent EB:

- `KpiTile` (Wave 6) — already used everywhere; could move to `ui/AdminKpi.tsx`
  with the same API.
- `Sparkline` (Wave 6) — could become `ui/AdminSparkline.tsx`.
- `LiveDashboard` (Wave 11) — too page-specific to primitivise as-is, but the
  polling + last-updated logic could become a `useLiveData()` hook.

— Agent EA, Wave 12.
