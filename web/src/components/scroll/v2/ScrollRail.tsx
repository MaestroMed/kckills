"use client";

/**
 * ScrollRail — persistent LEFT navigation rail for the desktop /scroll
 * shell (Wave 36 — TikTok-grade redesign, desktop track).
 *
 * This is the desktop counterpart to the mobile FeedTabBar + ScrollChipBar
 * combo. On <768 those two floating bars stay (they now carry `md:hidden`
 * siblings of this rail) ; from the wide stage up, this rail replaces them
 * with a sticky, full-height column.
 *
 * URL CONTRACT — this rail is the authoritative desktop writer of the
 * same query-param contract the mobile bars use. It must match byte-for-
 * byte how FeedTabBar / ScrollChipBar mutate the URL :
 *   - Feed tab     → `?feed=recent` | `?feed=top-semaine` ; deleted for
 *                    the default "Pour Toi".
 *   - Multi kills  → `?multi=1`
 *   - First bloods → `?fb=1`
 * Every mutation preserves all OTHER params (via URLSearchParams seeded
 * from useSearchParams) and soft-navigates with router.replace(scroll:false)
 * so the server re-orders the feed without a scroll jump.
 *
 * The five NAVIGUER rows are plain page links (next/link).
 *
 * Visual language : reuses the KC hextech system — .glass surface, a gold
 * inset right hairline, the Losange recipe, and the navbar active-nav
 * recipe (bg-elevated + cream text + gold left border). NEVER invents new
 * tokens.
 *
 * Motion : the app is wrapped in <LazyMotion features={domAnimation} strict>
 * so we import `m` (NEVER `motion`) and only ever animate opacity/scale —
 * no `layout`, no AnimatePresence layout (domAnimation excludes them and
 * it crashes the feed). Everything degrades to instant under
 * prefers-reduced-motion.
 */

import Link from "next/link";
import {
  useRouter,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/lib/i18n/use-lang";
import { m, useReducedMotion } from "motion/react";
import {
  Home,
  Users,
  Swords,
  Radio,
  Trophy,
  Search,
  Sparkles,
  Clock,
  Zap,
  Flame,
  Droplet,
  type LucideIcon,
} from "lucide-react";

interface ScrollRailProps {
  /** Visible clip count, surfaced in the version pill. Optional — the
   *  pill renders "v2" alone when omitted. */
  clipCount?: number;
  /** Icon-only 72px mode with title tooltips. Defaults to expanded. */
  collapsed?: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Root
// ════════════════════════════════════════════════════════════════════

export function ScrollRail({ clipCount, collapsed = false }: ScrollRailProps) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // ─── Current feed-tab + chip state, derived from the live URL ────
  // Mirrors scroll/page.tsx server parsing so the active highlight is
  // always in sync with what the feed actually rendered.
  const rawFeed = sp.get("feed");
  const feed: "pour-toi" | "recent" | "top-semaine" =
    rawFeed === "recent" || rawFeed === "top-semaine" ? rawFeed : "pour-toi";
  const isTrue = (v: string | null) => v === "1" || v === "true";
  const multiOn = isTrue(sp.get("multi"));
  const fbOn = isTrue(sp.get("fb"));
  // On the /scroll route the feed-lens rows are live ; elsewhere (a deep
  // page reached from a NAVIGUER link) they still write the contract and
  // navigate back to /scroll, but they shouldn't claim "active".
  const onScroll = pathname === "/scroll";

  // ─── URL writer — preserve untouched params, soft-navigate ───────
  const buildHref = (mutations: Record<string, string | null>): string => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(mutations)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/scroll?${qs}` : "/scroll";
  };

  const navigate = (mutations: Record<string, string | null>) => {
    startTransition(() => {
      router.replace(buildHref(mutations), { scroll: false });
    });
  };

  // Feed-tab rows : "Pour Toi" deletes `feed` (default) ; others set it.
  const selectFeed = (next: "pour-toi" | "recent" | "top-semaine") => {
    navigate({ feed: next === "pour-toi" ? null : next });
  };
  // Boolean chip rows : toggle ?multi=1 / ?fb=1.
  const toggleBool = (key: "multi" | "fb", currently: boolean) => {
    navigate({ [key]: currently ? null : "1" });
  };

  // ─── NAVIGUER active state — navbar recipe (exact or sub-route) ──
  const isPageActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const w = collapsed ? "72px" : "var(--rail)";

  return (
    <nav
      role="navigation"
      aria-label={t("p_scroll.rail_nav_aria")}
      data-collapsed={collapsed || undefined}
      className={`scroll-rail-shell sticky top-0 flex h-[100dvh] flex-col overflow-y-auto overflow-x-hidden ${
        isPending ? "opacity-90" : ""
      }`}
      style={{
        width: w,
        // .glass surface + a single 1px gold right hairline (inset shadow,
        // not a border — matches the build-rule recipe).
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        background: "rgba(10,20,40,0.75)",
        boxShadow: "inset -1px 0 0 var(--border-gold)",
        transition: "width 0.28s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {/* ── (1) Brand block ─────────────────────────────────────── */}
      <Link
        href="/"
        className="group flex items-center gap-2.5 px-3 pt-4 pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
        aria-label={t("p_scroll.rail_brand_aria")}
        title={collapsed ? "KCKILLS" : undefined}
      >
        <span className="shrink-0">
          <KCKILLSLogo />
        </span>
        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-base font-black leading-none tracking-[0.1em] drop-shadow-[0_0_8px_rgba(200,170,110,0.35)]">
              KC<span className="text-[var(--gold)]">KILLS</span>
            </span>
            <span className="mt-1.5 inline-flex w-fit items-center rounded-full border border-[var(--border-gold)] bg-[var(--cream-wash)] px-2 py-0.5 font-data text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              v2{typeof clipCount === "number" ? ` · ${t("p_scroll.rail_clip_count", { n: clipCount })}` : ""}
            </span>
          </span>
        )}
      </Link>

      {/* ── (2) divider ─────────────────────────────────────────── */}
      <Divider />

      {/* ── (3) FEED-LENS group ─────────────────────────────────── */}
      <Group eyebrow={t("p_scroll.rail_group_feed")} collapsed={collapsed}>
        <RailButton
          icon={Sparkles}
          label={t("p_scroll.rail_pour_toi")}
          collapsed={collapsed}
          active={onScroll && feed === "pour-toi" && !multiOn && !fbOn}
          onClick={() => selectFeed("pour-toi")}
        />
        <RailButton
          icon={Clock}
          label={t("p_scroll.rail_recent")}
          collapsed={collapsed}
          active={onScroll && feed === "recent"}
          onClick={() => selectFeed("recent")}
        />
        <RailButton
          icon={Trophy}
          label={t("p_scroll.rail_top_7j")}
          collapsed={collapsed}
          active={onScroll && feed === "top-semaine"}
          onClick={() => selectFeed("top-semaine")}
        />
        <RailButton
          icon={Zap}
          label={t("p_scroll.rail_multi")}
          collapsed={collapsed}
          active={onScroll && multiOn}
          dot="var(--orange)"
          onClick={() => toggleBool("multi", multiOn)}
        />
        <RailButton
          icon={Droplet}
          label={t("p_scroll.rail_first_blood")}
          collapsed={collapsed}
          active={onScroll && fbOn}
          dot="var(--red)"
          onClick={() => toggleBool("fb", fbOn)}
        />
      </Group>

      {/* ── (4) divider ─────────────────────────────────────────── */}
      <Divider />

      {/* ── (5) NAVIGUER group ──────────────────────────────────── */}
      <Group eyebrow={t("p_scroll.rail_group_navigate")} collapsed={collapsed}>
        <RailLink
          icon={Users}
          label={t("p_scroll.rail_players")}
          href="/players"
          collapsed={collapsed}
          active={isPageActive("/players")}
        />
        <RailLink
          icon={Flame}
          label={t("p_scroll.rail_matches")}
          href="/matches"
          collapsed={collapsed}
          active={isPageActive("/matches")}
        />
        <RailLink
          icon={Swords}
          label={t("p_scroll.rail_vs_roulette")}
          href="/vs"
          collapsed={collapsed}
          active={isPageActive("/vs")}
        />
        <RailLink
          icon={Radio}
          label={t("p_scroll.rail_live")}
          href="/live"
          collapsed={collapsed}
          active={isPageActive("/live")}
          pulseDot
        />
        <RailLink
          icon={Trophy}
          label={t("p_scroll.rail_records")}
          href="/records"
          collapsed={collapsed}
          active={isPageActive("/records")}
        />
      </Group>

      {/* ── (6) divider ─────────────────────────────────────────── */}
      <Divider />

      {/* ── (7) Rechercher ──────────────────────────────────────── */}
      <div className={collapsed ? "px-2 pb-1 pt-1" : "px-2 pb-1 pt-1"}>
        <RailLink
          icon={Search}
          label={t("p_scroll.rail_search")}
          href="/search"
          collapsed={collapsed}
          active={isPageActive("/search")}
        />
      </div>

      {/* ── (8) spacer pushes the CTA + disclaimer to the floor ─── */}
      <div className="mt-auto" />

      {/* ── (9) Submit-a-clip CTA — HIDDEN while /community is a dead
             redirect to the read-only /clips catalog (no submission
             surface exists yet). Re-enable once community_clips submit
             ships. The gold button promised an action it couldn't
             deliver, so we remove it rather than mislead. ───────────── */}

      {/* ── (10) Riot disclaimer ────────────────────────────────── */}
      {!collapsed && (
        <p className="px-3 pb-4 pt-3 text-[9px] leading-relaxed text-white/40">
          KCKILLS was created under Riot Games&apos; &ldquo;Legal Jibber
          Jabber&rdquo; policy using assets owned by Riot Games. Riot Games does
          not endorse or sponsor this project.
        </p>
      )}
      {collapsed && <div className="pb-4" aria-hidden />}
    </nav>
  );
}

// ════════════════════════════════════════════════════════════════════
// Group — eyebrow + losange header, wraps a set of rows
// ════════════════════════════════════════════════════════════════════

function Group({
  eyebrow,
  collapsed,
  children,
}: {
  eyebrow: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2 py-1">
      {!collapsed ? (
        <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
          <Losange />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
            {eyebrow}
          </span>
        </div>
      ) : (
        // Collapsed : a centered losange stands in for the eyebrow so the
        // groups stay visually separated without a text label.
        <div className="flex justify-center py-1.5" aria-hidden>
          <Losange />
        </div>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// RailButton — a feed-lens row (writes the URL contract, not a link)
// ════════════════════════════════════════════════════════════════════

function RailButton({
  icon: Icon,
  label,
  active,
  collapsed,
  dot,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  /** Optional accent indicator dot (e.g. orange for Multi, red for FB). */
  dot?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={rowClass(active, collapsed)}
    >
      <RowInner
        Icon={Icon}
        label={label}
        active={active}
        collapsed={collapsed}
        dot={dot}
      />
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// RailLink — a page-navigation row (next/link)
// ════════════════════════════════════════════════════════════════════

function RailLink({
  icon: Icon,
  label,
  href,
  active,
  collapsed,
  pulseDot,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  active: boolean;
  collapsed: boolean;
  /** Live indicator : a gold dot that pulses (reduced-motion → static). */
  pulseDot?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={rowClass(active, collapsed)}
    >
      <RowInner
        Icon={Icon}
        label={label}
        active={active}
        collapsed={collapsed}
        pulseDot={pulseDot}
      />
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// Shared row visuals
// ════════════════════════════════════════════════════════════════════

/** The shared row chrome. Active = navbar.tsx recipe (bg-elevated +
 *  cream text + 2px gold left border). The left border is transparent
 *  when inactive so the 48px height never shifts on state change. */
function rowClass(active: boolean, collapsed: boolean): string {
  return [
    "group relative flex h-12 items-center rounded-lg border-l-2 transition-colors",
    collapsed ? "justify-center px-0" : "gap-3 pl-3 pr-2",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2",
    active
      ? "border-[var(--gold)] bg-[var(--bg-elevated)] text-[var(--gold-bright)]"
      : "border-transparent text-[var(--text-secondary)] hover:bg-white/[0.03] hover:text-[var(--gold)]",
  ].join(" ");
}

function RowInner({
  Icon,
  label,
  active,
  collapsed,
  dot,
  pulseDot,
}: {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  dot?: string;
  pulseDot?: boolean;
}) {
  return (
    <>
      <span className="relative grid h-6 w-6 shrink-0 place-items-center">
        <Icon
          size={20}
          strokeWidth={active ? 2.4 : 2}
          aria-hidden
          className="transition-transform group-hover:scale-105"
        />
        {/* Collapsed mode keeps the accent / live dot riding the icon so
            the lens state stays visible without a label. */}
        {collapsed && dot ? <AccentDot color={dot} corner /> : null}
        {collapsed && pulseDot ? <PulseDot corner /> : null}
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate text-[15px] leading-none">{label}</span>
          {dot ? <AccentDot color={dot} /> : null}
          {pulseDot ? <PulseDot /> : null}
        </span>
      )}
    </>
  );
}

// ── Static accent dot (Multi = orange, First Blood = red) ───────────
function AccentDot({ color, corner }: { color: string; corner?: boolean }) {
  return (
    <span
      aria-hidden
      className={corner ? "absolute -right-0.5 -top-0.5" : "shrink-0"}
      style={{
        width: 7,
        height: 7,
        borderRadius: "9999px",
        background: color,
        boxShadow: `0 0 8px ${color}`,
      }}
    />
  );
}

// ── Live pulse dot (gold) — breathes unless reduced-motion ──────────
function PulseDot({ corner }: { corner?: boolean }) {
  const reduce = useReducedMotion();
  const base = corner ? "absolute -right-0.5 -top-0.5" : "shrink-0";
  if (reduce) {
    return (
      <span
        aria-hidden
        className={base}
        style={{
          width: 7,
          height: 7,
          borderRadius: "9999px",
          background: "var(--gold)",
          boxShadow: "0 0 8px var(--gold)",
        }}
      />
    );
  }
  return (
    <m.span
      aria-hidden
      className={base}
      style={{
        width: 7,
        height: 7,
        borderRadius: "9999px",
        background: "var(--gold)",
        boxShadow: "0 0 8px var(--gold)",
      }}
      animate={{ opacity: [1, 0.35, 1], scale: [1, 0.82, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// Primitives — Divider + Losange (KC hextech recipe)
// ════════════════════════════════════════════════════════════════════

function Divider() {
  return <div aria-hidden className="gold-line mx-3 my-1.5 opacity-60" />;
}

function Losange() {
  return (
    <span
      aria-hidden
      className="inline-block"
      style={{
        width: 8,
        height: 8,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 10px rgba(200,170,110,0.5)",
      }}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// Brand mark — copied verbatim from navbar.tsx (ids namespaced to avoid
// SVG <defs> collisions when both the navbar and the rail mount).
// ════════════════════════════════════════════════════════════════════

function KCKILLSLogo() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="transition-transform group-hover:scale-105"
      aria-label="KCKILLS logo"
    >
      <defs>
        <linearGradient id="rail-kckills-logo-gradient" x1="0" y1="0" x2="34" y2="34">
          <stop stopColor="#F0E6D2" />
          <stop offset="0.5" stopColor="#C8AA6E" />
          <stop offset="1" stopColor="#785A28" />
        </linearGradient>
        <filter id="rail-kckills-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M17 2 L30 9 L30 25 L17 32 L4 25 L4 9 Z"
        fill="url(#rail-kckills-logo-gradient)"
      />
      <path d="M17 5 L27 10.5 L27 23.5 L17 29 L7 23.5 L7 10.5 Z" fill="#010A13" />

      <g filter="url(#rail-kckills-glow)">
        <path
          d="M10 10 L12.5 10 L12.5 15.5 L16 10 L18.8 10 L14.6 16 L18.8 24 L16 24 L12.7 18 L12.5 18.3 L12.5 24 L10 24 Z"
          fill="#C8AA6E"
        />
        <path
          d="M24 12 Q24 10 22 10 L20.5 10 Q18.5 10 18.5 12 L18.5 22 Q18.5 24 20.5 24 L22 24 Q24 24 24 22 L24 20.5 L22 20.5 L22 21.5 Q22 22 21.5 22 L21 22 Q20.5 22 20.5 21.5 L20.5 12.5 Q20.5 12 21 12 L21.5 12 Q22 12 22 12.5 L22 13.5 L24 13.5 Z"
          fill="#C8AA6E"
        />
      </g>

      <circle cx="30" cy="9" r="1.5" fill="#F0E6D2" />
      <circle cx="4" cy="25" r="1.5" fill="#F0E6D2" />
    </svg>
  );
}
