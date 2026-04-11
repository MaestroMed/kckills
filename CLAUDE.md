# LOLTOK — CLAUDE.md
# Version Finale — 9 avril 2026
# Le TikTok des kills LoL. Scroll. Rate. React. Share.

Tu es Claude Code. Ce document est ta spec complète pour construire LoLTok.
Lis-le intégralement avant d'écrire une seule ligne de code.
Ce document fait ~2000 lignes. Chaque ligne compte.

---

# PARTIE 1 — VISION & ARCHITECTURE

## 1.1 Vision produit

LoLTok est une PWA mobile-first de clips de kills esport League of Legends.
Pilote V0 centré sur la Karmine Corp, présenté en live par EtoStark (streamer KC).

Deux expériences core :

1. **SCROLL FEED** — TikTok vertical : chaque kill = 1 écran plein, autoplay, swipe, rate
2. **KC TIMELINE** — Frise horizontale scrollable 2021→2026, filtre les kills par ère

Le site affiche CHAQUE kill impliquant KC dans les matchs pro LEC.
Automatiquement détecté, automatiquement clippé, automatiquement analysé par IA.
La communauté note, commente, tague, partage.

V0 : pas de login obligatoire. Le scroll fonctionne sans compte.
Login Discord débloque : noter, commenter.

## 1.2 Architecture globale

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Vercel)                         │
│  Next.js 15 App Router — PWA installable                    │
│  ├── /             Landing + feed + timeline                │
│  ├── /scroll       MODE TIKTOK vertical plein écran         │
│  ├── /kill/[id]    Détail kill + clip + rate + comments     │
│  ├── /player/[slug] Profil joueur + stats + kills           │
│  ├── /top          Leaderboard par rating communautaire     │
│  ├── /match/[slug] Timeline interactive d'un match          │
│  └── /community    Edits YouTube/TikTok soumis par les fans │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase client SDK (anon key, RLS)
┌──────────────────────▼──────────────────────────────────────┐
│                   SUPABASE                                   │
│  PostgreSQL (RLS activé sur toutes les tables)               │
│  Auth (Discord OAuth — zero password)                        │
│  Realtime désactivé (polling adaptatif pour l'egress)        │
└──────────────────────▲──────────────────────────────────────┘
                       │ Service role key (server-side only)
┌──────────────────────┴──────────────────────────────────────┐
│                WORKER PYTHON (PC local 24/7)                 │
│  ├── SENTINEL     → poll schedule LEC, détecte matchs KC    │
│  ├── HARVESTER    → détecte kills par diff de frames         │
│  ├── VOD_HUNTER   → trouve VODs + récupère offsets           │
│  ├── CLIPPER      → yt-dlp + ffmpeg (H 16:9 + V 9:16)      │
│  ├── ANALYZER     → Gemini 2.5 Flash-Lite (score/tags/desc) │
│  ├── MODERATOR    → Claude Haiku (modération commentaires)   │
│  ├── OG_GENERATOR → Pillow (images OG pré-générées)         │
│  └── WATCHDOG     → monitoring + Discord webhooks            │
└──────────────────────┬──────────────────────────────────────┘
                       │ Upload
┌──────────────────────▼──────────────────────────────────────┐
│              CLOUDFLARE R2 + CDN                             │
│  clips.kckills.com — clips MP4 + thumbnails + OG images     │
│  Zéro egress fees, edge-cached mondial                       │
└─────────────────────────────────────────────────────────────┘
```

## 1.3 Structure du monorepo

```
loltok/
├── CLAUDE.md                        ← CE FICHIER
├── worker/
│   ├── main.py                      # Orchestrateur asyncio supervisé
│   ├── config.py                    # .env, constantes, rate limits
│   ├── scheduler.py                 # Rate limiter global centralisé
│   ├── local_cache.py               # SQLite fallback si Supabase down
│   ├── modules/
│   │   ├── sentinel.py              # Poll schedule LEC
│   │   ├── harvester.py             # Kill detection (diff frames)
│   │   ├── vod_hunter.py            # VOD discovery + offset
│   │   ├── clipper.py               # yt-dlp + ffmpeg dual format
│   │   ├── analyzer.py              # Gemini 2.5 Flash-Lite
│   │   ├── moderator.py             # Claude Haiku
│   │   ├── og_generator.py          # Pillow OG images
│   │   └── watchdog.py              # Discord webhooks + monitoring
│   ├── services/
│   │   ├── lolesports_api.py        # Client esports-api.lolesports.com
│   │   ├── livestats_api.py         # Client feed.lolesports.com
│   │   ├── oracles_elixir.py        # Fallback CSV data
│   │   ├── leaguepedia.py           # Fallback Cargo API
│   │   ├── supabase_client.py       # Supabase (service role)
│   │   ├── r2_client.py             # Cloudflare R2 (boto3 S3)
│   │   ├── youtube_dl.py            # yt-dlp wrapper + retry
│   │   ├── ffmpeg_ops.py            # Encoding H + V + low
│   │   ├── gemini_client.py         # google-generativeai
│   │   ├── haiku_client.py          # anthropic SDK
│   │   └── discord_webhook.py       # Notifications
│   ├── models/
│   │   ├── kill_event.py            # Dataclass + state machine
│   │   ├── game.py
│   │   └── match.py
│   ├── fixtures/                    # Mock data pour tests
│   │   ├── lolesports/
│   │   ├── livestats/
│   │   └── clips/
│   ├── tests/
│   │   ├── test_harvester.py
│   │   ├── test_clipper.py
│   │   └── test_scheduler.py
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
│
├── web/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx           # Root: providers, fonts, PWA
│   │   │   ├── page.tsx             # Landing: hero + feed + timeline
│   │   │   ├── scroll/page.tsx      # MODE TIKTOK vertical
│   │   │   ├── kill/[id]/page.tsx   # Kill detail
│   │   │   ├── player/[slug]/page.tsx
│   │   │   ├── top/page.tsx
│   │   │   ├── match/[slug]/page.tsx
│   │   │   ├── community/page.tsx
│   │   │   ├── settings/page.tsx    # Profil, supprimer compte
│   │   │   └── api/og/[id]/route.tsx # Redirect vers R2
│   │   ├── components/
│   │   │   ├── KillCard.tsx
│   │   │   ├── KillScrollItem.tsx
│   │   │   ├── KCTimeline.tsx
│   │   │   ├── StarRating.tsx
│   │   │   ├── MultiKillBadge.tsx
│   │   │   ├── CommentSection.tsx
│   │   │   ├── PlayerCard.tsx
│   │   │   ├── KillDetail.tsx
│   │   │   └── SearchFilters.tsx
│   │   ├── lib/
│   │   │   ├── supabase-browser.ts
│   │   │   ├── supabase-server.ts
│   │   │   ├── feed-algorithm.ts    # Score composite Wilson
│   │   │   └── constants.ts
│   │   └── styles/globals.css
│   ├── public/
│   │   ├── manifest.json
│   │   ├── sw.js                    # Push notifications
│   │   └── icons/
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── package.json
│
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql
```

## 1.4 Stack technique

| Composant | Technologie | Justification |
|-----------|-------------|---------------|
| Frontend | Next.js 15 (App Router, RSC) | SSR pour SEO, ISR pour perf |
| UI | Tailwind CSS + shadcn/ui | Theming LoL, accessible |
| Auth | Supabase Auth (Discord OAuth) | La fanbase KC vit sur Discord |
| DB | Supabase PostgreSQL + RLS | Free tier 500 MB, sécurité by design |
| Clips | Cloudflare R2 | 10 GB free, ZERO egress |
| Worker | Python asyncio supervisé | Daemon local PC Mehdi |
| IA clips | Gemini 2.5 Flash-Lite | Free tier 1000 RPD, vidéo input |
| IA modération | Claude Haiku 4.5 | $1/M input, ~$3.75/mois |
| Video | yt-dlp + ffmpeg | Standard industrie |
| OG images | Pillow (worker) | Pré-générées → R2, 0 compute Vercel |
| Deploy web | Vercel (hobby) | Free, edge, ISR |
| Analytics | Umami self-hosted | Privacy-first |
| Notifs | Discord Webhooks + Web Push (VAPID) | Gratuit |

---

# PARTIE 2 — DESIGN SYSTEM

## 2.1 Palette — League of Legends Hextech

```css
:root {
  --bg-primary: #010A13;
  --bg-surface: #0A1428;
  --bg-elevated: #0F1D36;
  --gold: #C8AA6E;
  --gold-bright: #F0E6D2;
  --gold-dark: #785A28;
  --gold-gradient: linear-gradient(135deg, #C89B3C, #785A28);
  --blue-kc: #0057FF;
  --cyan: #0AC8B9;
  --red: #E84057;
  --green: #00C853;
  --orange: #FF9800;
  --text-primary: #F0E6D2;
  --text-secondary: #A09B8C;
  --text-muted: #7B8DB5;  /* remonté de #5B6A8A pour WCAG AA 4.5:1 */
  --text-disabled: #3D4A63;
  --border-gold: rgba(200,170,110,0.15);
  --border-subtle: rgba(100,140,200,0.1);
}
```

## 2.2 Fonts

`Cinzel` (display/titres, serif, style LoL) + `Fira Sans` (body, sans-serif) + `Space Mono` (données numériques). Google Fonts.

## 2.3 Ornements

Losanges dorés comme séparateurs. Coins dorés sur les cartes (border-top + border-left 2px gold). Lignes gradient or en haut de page. Lueur bleue hextech subtile sur les éléments interactifs.

## 2.4 Accessibilité WCAG 2.1 AA

- Tous textes > 4.5:1 de contraste
- Focus ring visible : outline 2px solid var(--gold)
- Skip to content link pour lecteurs d'écran
- Alt text sur toutes les images : "{killer} ({champion}) élimine {victim}"
- Sous-titres sur les vidéos (description AI comme track caption)
- Navigation clavier complète (scroll : flèches haut/bas)
- `prefers-reduced-motion` : désactiver toutes les animations
- Boutons : aria-label sur chaque action

---

# PARTIE 3 — APIs & RATE LIMITS (VÉRIFIÉ 3-9 AVRIL 2026)

## 3.1 API LoL Esports

```
Base: https://esports-api.lolesports.com/persisted/gw/
Header: x-api-key: 0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z
Endpoints: getSchedule, getEventDetails, getTeams, getLive, getGames
⚠️ API NON OFFICIELLE — peut changer sans préavis
Poll: 1 req/5min (idle), 1 req/30s (live), 1 req/60s (post-match)
```

`getEventDetails` retourne les VODs avec :
- `vod.parameter` = YouTube video ID
- `vod.offset` = secondes dans le VOD où la game commence
- `vod.provider` = "youtube"
- `vod.locale` = "fr-FR" (ou "en-US")

## 3.2 Live Stats Feed

```
Base: https://feed.lolesports.com/livestats/v1/
Endpoints: window/{gameId}, details/{gameId}
Auth: aucune
Donne: frames ~10s avec KDA cumulé par joueur + timestamps RFC3339
⚠️ NON OFFICIEL — peut être down pour les matchs anciens
Poll pendant match live: 1 req/10s
```

## 3.3 Gemini 2.5 Flash-Lite

```
⚠️ GEMINI 2.0 FLASH EST MORT (déprécié mars 2026). Utiliser 2.5 Flash-Lite.
Free tier: 15 RPM, 1000 RPD, 250K TPM
Délai min entre appels: 4 secondes
Reset quotidien: 07:00 UTC (09:00 Paris = minuit Pacific)
⚠️ Free tier = Google peut utiliser les prompts → NE JAMAIS envoyer de données users
```

## 3.4 Claude Haiku 4.5

```
Modèle: claude-haiku-4-5-20251001
Input: $1.00/M tokens, Output: $5.00/M tokens
Rate limit: 50 RPM → délai min 1.5 secondes
Coût modération: ~$3.75/mois pour 500 comments/jour
```

## 3.5 YouTube Data API v3

```
Quota: 10,000 unités/jour
search.list: 100 unités → MAX 100 recherches/jour
videos.list: 1 unité → 10,000 lookups/jour
⚠️ Utiliser getEventDetails.vod.parameter D'ABORD → search seulement si absent
Reset: minuit Pacific
```

## 3.6 yt-dlp

```
Pas de rate limit officiel mais YouTube throttle
Délai min: 10 secondes entre téléchargements
Backoff exponentiel sur 429: 60s → 120s → 240s → 480s → 960s
Max retries: 5
Utiliser --download-sections pour ne télécharger QUE le segment du kill
```

## 3.7 Supabase Free Tier

```
DB: 500 MB
Egress: 5 GB/mois ← BOTTLENECK PRINCIPAL
MAU: 50,000
⚠️ PAUSE après 7 jours d'inactivité → heartbeat obligatoire
⚠️ AUCUN backup automatique → pg_dump hebdomadaire manuel
Budget egress réel estimé: ~3.8 GB/mois (détail dans Partie 8)
```

## 3.8 Cloudflare R2 Free Tier

```
Storage: 10 GB
Class A (writes): 1M/mois
Class B (reads): 10M/mois
Egress: GRATUIT ILLIMITÉ ← le héros du projet
```

## 3.9 Scheduler global

Le worker implémente un scheduler centralisé. TOUS les appels externes passent par lui.

```python
class LoLTokScheduler:
    DELAYS = {
        'gemini': 4.0,            # 15 RPM
        'haiku': 1.5,             # 50 RPM
        'youtube_search': 2.0,
        'ytdlp': 10.0,
        'discord': 2.5,           # 30/60s
        'lolesports_idle': 300,   # 5 min
        'lolesports_live': 30,
        'livestats': 10,
        'ffmpeg_cooldown': 5,     # laisser le CPU respirer
    }
    DAILY_QUOTAS = {
        'gemini': 950,            # marge 5% sur 1000
        'youtube_search': 95,     # marge sur 100
    }
    # Reset: 07:00 UTC (minuit Pacific = 09:00 Paris)
    # Compteurs journaliers pour Gemini et YouTube
    # Délai min entre chaque appel via wait_for()
    # Backoff exponentiel sur erreurs (base × 2^attempt)
```

---

# PARTIE 4 — SCHEMA SQL (Supabase)

Fichier : `supabase/migrations/001_initial_schema.sql`

```sql
-- ═══════════════════════════
-- TABLES ESPORT
-- ═══════════════════════════

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    code TEXT NOT NULL,
    logo_url TEXT,
    region TEXT,
    is_tracked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE,
    team_id UUID REFERENCES teams(id),
    ign TEXT NOT NULL,
    real_name TEXT,
    role TEXT CHECK (role IN ('top','jungle','mid','bottom','support')),
    nationality TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    league_id TEXT,
    year INT,
    split TEXT,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    tournament_id UUID REFERENCES tournaments(id),
    team_blue_id UUID REFERENCES teams(id),
    team_red_id UUID REFERENCES teams(id),
    winner_team_id UUID REFERENCES teams(id),
    format TEXT DEFAULT 'bo1',
    stage TEXT,
    scheduled_at TIMESTAMPTZ,
    state TEXT DEFAULT 'upcoming',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    match_id UUID REFERENCES matches(id),
    game_number INT NOT NULL,
    winner_team_id UUID REFERENCES teams(id),
    duration_seconds INT,
    patch TEXT,
    -- VOD officiel (depuis getEventDetails)
    vod_youtube_id TEXT,
    vod_offset_seconds INT,
    -- VOD alternatif (Kameto, Eto, etc.)
    alt_vod_youtube_id TEXT,
    alt_vod_platform TEXT,
    alt_vod_stream_start_epoch BIGINT,
    alt_vod_delay_seconds INT DEFAULT 12,
    -- Processing
    kills_extracted BOOLEAN DEFAULT FALSE,
    data_source TEXT DEFAULT 'livestats',
    state TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE game_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id),
    player_id UUID REFERENCES players(id),
    team_id UUID REFERENCES teams(id),
    participant_id INT NOT NULL,
    champion TEXT NOT NULL,
    role TEXT,
    side TEXT CHECK (side IN ('blue','red')),
    kills INT DEFAULT 0,
    deaths INT DEFAULT 0,
    assists INT DEFAULT 0,
    UNIQUE(game_id, participant_id)
);

-- VOD multi-source
CREATE TABLE game_vod_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) NOT NULL,
    source_type TEXT CHECK (source_type IN ('official_lec','kameto','etostark','other')),
    platform TEXT CHECK (platform IN ('youtube','twitch')),
    video_id TEXT NOT NULL,
    offset_seconds INT,
    stream_start_epoch BIGINT,
    stream_delay_seconds INT DEFAULT 12,
    sync_validated BOOLEAN DEFAULT FALSE,
    priority INT DEFAULT 0,
    added_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(game_id, source_type)
);

-- ═══════════════════════════
-- TABLE KILLS (COEUR DU PRODUIT)
-- ═══════════════════════════

CREATE TABLE kills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES games(id) NOT NULL,
    -- Timing (epoch-based = pause-proof)
    event_epoch BIGINT NOT NULL,
    game_time_seconds INT,
    -- Kill info
    killer_player_id UUID REFERENCES players(id),
    killer_champion TEXT,
    victim_player_id UUID REFERENCES players(id),
    victim_champion TEXT,
    assistants JSONB DEFAULT '[]',
    -- Confidence du mapping killer→victim
    confidence TEXT DEFAULT 'high' CHECK (confidence IN ('high','medium','low','estimated','verified')),
    -- Team involvement
    tracked_team_involvement TEXT CHECK (tracked_team_involvement IN ('team_killer','team_victim','team_assist')),
    -- Context
    is_first_blood BOOLEAN DEFAULT FALSE,
    multi_kill TEXT,
    shutdown_bounty INT DEFAULT 0,
    -- Clips (3 formats)
    clip_url_horizontal TEXT,
    clip_url_vertical TEXT,
    clip_url_vertical_low TEXT,
    thumbnail_url TEXT,
    og_image_url TEXT,
    clip_source TEXT DEFAULT 'official',
    clip_validated BOOLEAN DEFAULT FALSE,
    -- AI Analysis (Gemini Flash-Lite)
    highlight_score FLOAT,
    ai_tags JSONB DEFAULT '[]',
    ai_description TEXT,
    kill_visible BOOLEAN,
    caster_hype_level INT,
    -- Community
    avg_rating FLOAT,
    rating_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    impression_count INT DEFAULT 0,
    -- Data source
    data_source TEXT DEFAULT 'livestats',
    -- Processing
    status TEXT DEFAULT 'raw' CHECK (status IN (
        'raw','enriched','vod_found','clipping','clipped',
        'analyzed','published','clip_error','manual_review'
    )),
    retry_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- Full-text search
    search_vector tsvector
);

-- ═══════════════════════════
-- TABLES UTILISATEURS (zero-knowledge)
-- ═══════════════════════════

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    discord_username TEXT,
    discord_avatar_url TEXT,
    discord_id_hash TEXT,  -- SHA-256 du Discord ID
    -- Riot (optionnel)
    riot_puuid_hash TEXT,
    riot_summoner_name TEXT,
    riot_tag TEXT,
    riot_rank TEXT,
    riot_top_champions JSONB DEFAULT '[]',
    riot_linked_at TIMESTAMPTZ,
    -- Stats
    total_ratings INT DEFAULT 0,
    total_comments INT DEFAULT 0,
    badges JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) NOT NULL,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    score INT CHECK (score BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(kill_id, user_id)
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) NOT NULL,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    parent_id UUID REFERENCES comments(id),
    content TEXT NOT NULL CHECK (length(content) <= 500),
    moderation_status TEXT DEFAULT 'pending'
        CHECK (moderation_status IN ('pending','approved','flagged','rejected')),
    moderation_reason TEXT,
    toxicity_score FLOAT,
    upvotes INT DEFAULT 0,
    report_count INT DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE kill_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id) NOT NULL,
    tag TEXT NOT NULL,
    source TEXT DEFAULT 'auto' CHECK (source IN ('auto','ai','community')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(kill_id, tag)
);

CREATE TABLE community_clips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kill_id UUID REFERENCES kills(id),
    submitted_by UUID REFERENCES auth.users(id),
    platform TEXT CHECK (platform IN ('youtube','tiktok','twitter')),
    external_url TEXT NOT NULL,
    title TEXT,
    approved BOOLEAN DEFAULT FALSE,
    upvotes INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Push notification subscriptions
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    subscription_json TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Health check (heartbeat worker)
CREATE TABLE health_checks (
    id TEXT PRIMARY KEY,
    last_seen TIMESTAMPTZ DEFAULT now(),
    metrics JSONB DEFAULT '{}'
);

-- ═══════════════════════════
-- INDEXES
-- ═══════════════════════════

CREATE INDEX idx_kills_game ON kills(game_id, game_time_seconds);
CREATE INDEX idx_kills_killer ON kills(killer_player_id, created_at DESC);
CREATE INDEX idx_kills_status ON kills(status) WHERE status != 'published';
CREATE INDEX idx_kills_highlight ON kills(highlight_score DESC NULLS LAST) WHERE status = 'published';
CREATE INDEX idx_kills_team ON kills(tracked_team_involvement, avg_rating DESC NULLS LAST);
CREATE INDEX idx_kills_multi ON kills(multi_kill) WHERE multi_kill IS NOT NULL;
CREATE INDEX idx_kills_published ON kills(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_kills_search ON kills USING GIN(search_vector);
CREATE INDEX idx_ratings_kill ON ratings(kill_id);
CREATE INDEX idx_comments_kill ON comments(kill_id, created_at) WHERE is_deleted = false AND moderation_status = 'approved';

-- ═══════════════════════════
-- TRIGGERS
-- ═══════════════════════════

-- Auto-update avg_rating
CREATE OR REPLACE FUNCTION fn_update_kill_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE kills SET
        avg_rating = (SELECT ROUND(AVG(score)::numeric, 1) FROM ratings WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)),
        rating_count = (SELECT COUNT(*) FROM ratings WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)),
        updated_at = now()
    WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_rating_change
AFTER INSERT OR UPDATE OR DELETE ON ratings
FOR EACH ROW EXECUTE FUNCTION fn_update_kill_rating();

-- Auto-update comment_count
CREATE OR REPLACE FUNCTION fn_update_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE kills SET
        comment_count = (SELECT COUNT(*) FROM comments
            WHERE kill_id = COALESCE(NEW.kill_id, OLD.kill_id)
            AND is_deleted = false AND moderation_status = 'approved'),
        updated_at = now()
    WHERE id = COALESCE(NEW.kill_id, OLD.kill_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_comment_change
AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION fn_update_comment_count();

-- Auto-update search_vector
CREATE OR REPLACE FUNCTION fn_update_kill_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('french',
        COALESCE(NEW.killer_champion, '') || ' ' ||
        COALESCE(NEW.victim_champion, '') || ' ' ||
        COALESCE(NEW.ai_description, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kill_search
BEFORE INSERT OR UPDATE ON kills
FOR EACH ROW EXECUTE FUNCTION fn_update_kill_search_vector();

-- RPC pour enregistrer les impressions (minimal egress)
CREATE OR REPLACE FUNCTION fn_record_impression(p_kill_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE kills SET impression_count = COALESCE(impression_count, 0) + 1
    WHERE id = p_kill_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC pour le feed (retourne UNIQUEMENT les champs nécessaires)
CREATE OR REPLACE FUNCTION fn_get_feed_kills(p_limit INT, p_cursor TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
    id UUID, killer_champion TEXT, victim_champion TEXT,
    killer_name TEXT, victim_name TEXT,
    clip_url_vertical TEXT, clip_url_vertical_low TEXT, thumbnail_url TEXT,
    highlight_score FLOAT, avg_rating FLOAT, rating_count INT,
    ai_description TEXT, ai_tags JSONB, multi_kill TEXT,
    is_first_blood BOOLEAN, tracked_team_involvement TEXT,
    impression_count INT, comment_count INT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT k.id, k.killer_champion, k.victim_champion,
           p1.ign AS killer_name, p2.ign AS victim_name,
           k.clip_url_vertical, k.clip_url_vertical_low, k.thumbnail_url,
           k.highlight_score, k.avg_rating, k.rating_count,
           k.ai_description, k.ai_tags, k.multi_kill,
           k.is_first_blood, k.tracked_team_involvement,
           k.impression_count, k.comment_count,
           k.created_at
    FROM kills k
    LEFT JOIN players p1 ON k.killer_player_id = p1.id
    LEFT JOIN players p2 ON k.victim_player_id = p2.id
    WHERE k.status = 'published'
    AND (p_cursor IS NULL OR k.created_at < p_cursor)
    ORDER BY k.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════

ALTER TABLE kills ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public kills" ON kills FOR SELECT USING (status = 'published');
CREATE POLICY "Public profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Own profile update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Own profile insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Public ratings" ON ratings FOR SELECT USING (true);
CREATE POLICY "Auth insert rating" ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own rating update" ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Public approved comments" ON comments FOR SELECT USING (is_deleted = false AND moderation_status = 'approved');
CREATE POLICY "Auth insert comment" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own comment update" ON comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Public approved clips" ON community_clips FOR SELECT USING (approved = true);
CREATE POLICY "Auth submit clip" ON community_clips FOR INSERT WITH CHECK (auth.uid() = submitted_by);
```

---

# PARTIE 5 — WORKER PYTHON

## 5.1 Orchestrateur supervisé (main.py)

Chaque module tourne dans sa propre task asyncio avec timeout.
Si une task crash, elle redémarre automatiquement après 10 secondes.
Les tasks ne dépendent pas les unes des autres — un crash du CLIPPER ne bloque pas le HARVESTER.

Le worker utilise un cache SQLite local (`local_cache.py`) comme buffer si Supabase est inaccessible. Les writes sont bufferisés localement et flushés quand la connexion revient.

Un service systemd (Linux) ou Task Scheduler (Windows) auto-redémarre le worker en cas de crash OS.

## 5.2 Détection des kills — algorithme avancé (harvester.py)

Le live stats feed donne des frames ~10s avec KDA cumulé par joueur.
En diffant frame N et frame N+1, on détecte les changements.

**Cas 1 (70% des kills)** : 1 killer gagne +1 kill, 1 victime gagne +1 death, camps opposés → mapping high confidence.

**Cas 2 (teamfights)** : N killers, M victims → corrélation par camp. Blue killers → red deaths, red killers → blue deaths. Confidence medium.

**Cas 3** : kills sans death détectée dans la même frame → buffer, résoudre au prochain cycle.

**Multi-kill detection** : +N kills d'un joueur dans une seule frame → multi-kill direct. Sliding window de 30 secondes sur 3 frames consécutives pour détecter les pentas étalés.

**First blood** : quand totalKills (blue+red) passe de 0 à 1.

**Réconciliation post-game** : les stats finales (Oracle's Elixir ou getEventDetails) donnent les KDA finaux exacts. On vérifie que le total des kills détectés == kills finaux. Si écart → kills manqués taggés.

## 5.3 Sources de données — hiérarchie de fallback

```
Priorité 1: Live stats feed (temps réel, granulaire, timestamps epoch)
Priorité 2: Oracle's Elixir CSV (J+1, kills par joueur par game, pas de timestamps individuels)
Priorité 3: Leaguepedia Cargo API (J+1, picks/bans, KDA agrégé)
Priorité 4: Input manuel (Mehdi note les timestamps des kills importants)
```

Si le live stats feed est down, le pipeline continue avec les sources alternatives.
Les kills de source 2/3 ont `confidence: 'estimated'` et les game_time sont répartis uniformément.

## 5.4 Sync VOD — epoch-based (pause-proof)

Le live stats feed donne `rfc460Timestamp` = temps réel UTC pour chaque frame.
Le stream (LEC officiel, Kameto, Eto) tourne aussi en temps réel UTC.

```python
kill_vod_timestamp = (kill_epoch - game_start_epoch) + vod_offset
# Les pauses in-game n'affectent RIEN car on compare epoch vs epoch
```

Pour les streams Twitch (Kameto/Eto), le seul paramètre est le delay Twitch (~12s).
Calibration : Gemini Flash vérifie que la frame à mi-clip est bien du gameplay LoL,
puis lit le timer in-game pour détecter un drift > 30 secondes.
Si drift détecté → auto-correction de l'offset + re-clip.

## 5.5 Clipping — triple format (clipper.py)

Chaque kill produit 4 fichiers :

| Fichier | Format | Résolution | Profil | Usage |
|---------|--------|------------|--------|-------|
| `{id}_h.mp4` | 16:9 | 1280×720 | main 3.1 | Desktop, page kill detail |
| `{id}_v.mp4` | 9:16 | 720×1280 | main 3.1 | Scroll mobile, high quality |
| `{id}_v_low.mp4` | 9:16 | 360×640 | baseline 3.0 | Scroll mobile, réseau lent |
| `{id}_thumb.jpg` | 9:16 | 720×1280 | JPEG | Poster frame, OG image base |

Encodage : H.264, `movflags +faststart` (progressive loading), `maxrate` + `bufsize` pour bitrate constant, AAC audio 96k (suffisant pour casters).

Le vertical est croppé depuis l'horizontal : `crop=ih*9/16:ih:iw/2-ih*9/32:0`.

## 5.6 Analyse IA (analyzer.py)

Gemini 2.5 Flash-Lite prompt :

```
<role>Analyste esport LoL spécialisé highlights.</role>
<task>Analyse ce clip de match pro LoL. Réponds UNIQUEMENT en JSON valide.</task>
<output_format>
{
    "highlight_score": <float 1.0-10.0>,
    "tags": [<max 5 parmi: "outplay","teamfight","solo_kill","tower_dive",
              "baron_fight","dragon_fight","flash_predict","1v2","1v3",
              "clutch","clean","mechanical","shutdown","comeback",
              "engage","peel","snipe","steal">],
    "description_fr": "<max 120 chars, style commentateur hypé>",
    "kill_visible_on_screen": <bool>,
    "caster_hype_level": <int 1-5>
}
</output_format>
<rules>
- Non identifiable → null
- 1-3=routine, 4-6=intéressant, 7-8=très bon, 9-10=exceptionnel
- description_fr: percutante, titre de clip viral
- Contraintes finales: max 5 tags, JSON VALIDE uniquement, pas de texte avant/après
</rules>
```

## 5.7 OG Images (og_generator.py)

Pré-générées par le worker via Pillow (pas Satori edge). 1200×630 PNG.
Fond sombre gradient, texte killer→victim en Cinzel doré, rating étoiles,
description AI, badge event. Uploadées sur R2 (`og/{kill_id}.png`).
La route Next.js `/api/og/[id]` fait un simple redirect 302 vers R2. Zéro compute Vercel.

## 5.8 Modération Haiku (moderator.py)

Chaque commentaire passe par Haiku AVANT publication. Prompt :
```
Modère ce commentaire sur un site de clips esport LoL.
Commentaire de "{username}": "{content}"
Réponds UNIQUEMENT en JSON: {"action":"approve|flag|reject","reason":"...","toxicity":0-10}
Règles: le trash talk léger entre fans est OK, les emojis et l'argot gaming sont OK.
reject = toxique, spam, haine, harcèlement, contenu illégal.
```

## 5.9 Dégradation gracieuse

| Dépendance | Mode dégradé |
|-----------|-------------|
| Gemini | Publier SANS tags/description/score |
| VOD YouTube | Kill card "data-only" (stats sans clip) |
| yt-dlp | 5 retries puis skip → MANUAL_REVIEW |
| Supabase | Cache SQLite local, flush quand DB revient |
| R2 | Stocker localement, retry batch horaire |
| Discord | Log local, batch retry |
| Live stats feed | Fallback Oracle's Elixir CSV |
| lolesports API | Fallback Leaguepedia Cargo API |

---

# PARTIE 6 — FRONTEND

## 6.1 Mode Scroll (/scroll) — LE KILLER FEATURE

Chaque kill = 1 écran plein, `h-dvh`, `snap-y snap-mandatory`.
Intersection Observer threshold 0.5 : visible > 1s → autoplay + record impression.
Vidéo : `clip_url_vertical` (720p) ou `clip_url_vertical_low` (360p) détecté via `navigator.connection`.
Poster frame : `thumbnail_url`. `preload="metadata"`, switch à `"auto"` quand visible.
`loop muted playsInline`.

Overlay bottom : killer→victim, champions, description AI, rating étoiles.
Overlay right (style TikTok) : boutons share, comment, rate.
Infinite query : charge 10 kills, fetch next page au dernier.

### Feed algorithm — score composite Wilson

```typescript
function computeFeedScore(kill, recentKillers: string[]): number {
    const quality = (kill.highlight_score ?? 5) / 10;
    const community = kill.rating_count > 0
        ? wilsonScore(kill.avg_rating / 5, kill.rating_count) : 0.5;
    const hoursOld = (Date.now() - new Date(kill.created_at).getTime()) / 3600000;
    const freshness = Math.exp(-hoursOld / 168); // demi-vie 1 semaine
    const engagement = kill.impression_count > 10
        ? (kill.rating_count + kill.comment_count) / kill.impression_count : 0.3;
    const diversity = recentKillers.slice(-5).includes(kill.killer_player_id) ? 0.5 : 1.0;

    let score = quality*0.30 + community*0.25 + freshness*0.20 + engagement*0.15 + diversity*0.10;
    if (kill.multi_kill === 'penta') score *= 2.0;
    else if (kill.multi_kill === 'quadra') score *= 1.5;
    else if (kill.multi_kill === 'triple') score *= 1.2;
    if (kill.is_first_blood) score *= 1.1;
    return score;
}
```

### Mode live

Quand un match KC est en cours (détecté via `getLive` côté client, poll 2 min),
le feed passe en polling agressif 15 secondes. Bandeau "KC EN LIVE" animé en haut.

## 6.2 KC Timeline (composant bandeau)

Frise horizontale scrollable (drag + touch), 9 ères de 2021 à 2026 Spring.
Chaque ère = carte avec icon, période, label, sous-titre, résultat, roster.

PAR DÉFAUT : toutes visibles en couleur.
QUAND UNE ÈRE EST SÉLECTIONNÉE : les autres passent en `grayscale(100%) brightness(0.4)`.
L'ère sélectionnée s'agrandit avec animation `cubic-bezier(0.16, 1, 0.3, 1)`.
Panneau de détail slide sous la frise (events, roster avec changements en barré→nouveau, badge résultat).
Le filtre ère s'applique au feed de kills en dessous.
Connecteurs entre ères : losanges dorés + lignes fines (motif hextech).

### Ères KC

| ID | Période | Label | Couleur | Résultat clé |
|----|---------|-------|---------|--------------|
| lfl-2021 | 2021 | LFL S1 | #00C853 | 2× LFL · 2× EU Masters |
| lfl-2022 | 2022 | L'Ère Rekkles | #FFD700 | 3× EU Masters, 370K viewers |
| lfl-2023 | 2023 | LFL→LEC | #2196F3 | Rachat slot Astralis |
| lec-2024 | 2024 | LEC Rookie | #FF9800 | 4e Summer, apprentissage |
| lec-2025-w | 2025 W | Le Sacre | #C8AA6E | 🏆 CHAMPIONS LEC |
| lec-2025-sp | 2025 Sp | First Stand | #0AC8B9 | 2e international |
| lec-2025-su | 2025 Su | Le Drame | #E84057 | 💔 Pas de Worlds |
| lec-2026-v | 2026 V | Le Renouveau | #0057FF | Finalistes LEC Versus |
| lec-2026-sp | 2026 Sp | En Cours | #C8AA6E | Spring en cours 🔥 |

## 6.3 Pages

- `/kill/[id]` : clip dual-source (LEC officiel / Kameto / Eto switch), rating 1-5, commentaires threadés, tags, metadata match, OG meta tags dynamiques
- `/player/[slug]` : tous les kills du joueur, stats (KDA, champions, avg rating), filtres
- `/top` : leaderboard par Wilson score, filtres par split/semaine/joueur
- `/match/[slug]` : timeline interactive, chaque kill = dot cliquable
- `/community` : edits YouTube/TikTok soumis par les fans
- `/settings` : profil, lier Riot (optionnel), exporter données, supprimer compte

## 6.4 PWA

```json
{ "name": "LoLTok", "short_name": "LoLTok", "start_url": "/scroll",
  "display": "standalone", "orientation": "portrait",
  "background_color": "#010A13", "theme_color": "#C8AA6E" }
```

Push notifications VAPID : à chaque kill publié, le worker envoie une push aux abonnés.
Service worker avec actions "Voir le clip" / "Noter".

## 6.5 Recherche & Filtres

Full-text search PostgreSQL (`tsvector` indexé) sur champion, description AI, tags.
Filtres : joueur KC, type (KC killer/victim), multi-kill, tag, ère, match, highlight score min, rating min.
Tri : feed_score, highlight_score, avg_rating, created_at.

---

# PARTIE 7 — SÉCURITÉ

## 7.1 Zero-knowledge

**JAMAIS stocké** : email, mot de passe, IP, localisation, nom réel, données de paiement.
Discord ID : hashé SHA-256. Riot PUUID : hashé SHA-256.
On stocke seulement : username Discord, avatar URL, données publiques.

## 7.2 Auth

Discord OAuth exclusif. Supabase Auth gère les sessions (JWT 7j).
Riot OAuth optionnel (incentive : afficher rank + top champions sur le profil).

## 7.3 RLS

Activé sur TOUTES les tables. Pas d'exception.

## 7.4 Headers

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; media-src clips.kckills.com; ...
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

## 7.5 RGPD

Bouton "Supprimer mon compte" → efface profil, anonymise ratings, supprime commentaires.
Bouton "Exporter mes données" → JSON.
Politique de confidentialité en français.
Pas de cookies tiers. Umami self-hosted.

## 7.6 Disclaimer Riot (OBLIGATOIRE sur chaque page publique)

"LoLTok was created under Riot Games' 'Legal Jibber Jabber' policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."

---

# PARTIE 8 — EGRESS & OPTIMISATIONS

## 8.1 Budget egress Supabase (5 GB/mois free)

| Source | Estimation |
|--------|-----------|
| Page loads (20 kills × 2 KB) | 3.6 GB/mois (3000 loads/jour) |
| Auth sessions | 25 MB |
| Comments fetch | 10 MB |
| Ratings + RPC | 6 MB |
| Search queries | 50 MB |
| **TOTAL** | **~3.8 GB/mois** |

## 8.2 Optimisations

- Clips servis depuis R2 (pas Supabase) → zéro egress
- OG images sur R2 → zéro egress
- Thumbnails sur R2 → zéro egress
- RPC `fn_get_feed_kills` retourne UNIQUEMENT les champs nécessaires
- RPC `fn_record_impression` ne retourne rien (write-only)
- React Query : `staleTime: 30s` (idle), `15s` (live match)
- Cursor-based pagination (pas offset)
- Realtime Supabase DÉSACTIVÉ (polling adaptatif)

---

# PARTIE 9 — KC DATA RÉFÉRENCE

## Roster LEC 2026

| Joueur | Role | Nat | Notes |
|--------|------|-----|-------|
| Canna (Kim Chang-dong) | TOP | 🇰🇷 | MVP 2025, contrat 2027 |
| Yike (Martin Sundelin) | JGL | 🇸🇪 | Vocal leader, ex-G2 |
| Kyeahoo (Kang Ye-hoo) | MID | 🇰🇷 | Ex-DRX, recrue 2026 |
| Caliste (Caliste Henry-H.) | ADC | 🇫🇷 | Rookie of Year 2025, KDA 9.09 |
| Busio (Alan Cwalina) | SUP | 🇺🇸🇵🇱 | Ex-FlyQuest, Worlds 2024-2025 |

Coach: Reapered (Bok Han-gyu) 🇰🇷

## Stats LEC Versus 2026

- 28 kills/game en moyenne LEC, ~14 impliquant KC par game
- ~20 games jouées par KC, = ~280 kills à clipper pour le pilote
- Durée moyenne: 33:33
- Caliste: 5.1K / 1.1D / 4.9A, 80% WR, 11.3 CS/min
- 267 matchs KC depuis 2021. 172 victoires. 64.4% winrate.

---

# PARTIE 10 — COÛTS

| Service | Free Tier | Seuil migration |
|---------|-----------|----------------|
| Vercel | 0€ | >100 GB bandwidth → $20/mois |
| Supabase | 0€ | >400 MB DB ou >4 GB egress → $25/mois |
| Cloudflare R2 | 0€ | >10 GB → $0.015/GB |
| Gemini Flash-Lite | 0€ | >1000 RPD → $0.10/M tokens |
| Claude Haiku | ~3.75€ | Linéaire avec comments |
| Domaine kckills.com | ~1€ | — |
| PC électricité | ~5€ | — |
| **TOTAL** | **~10€/mois** | — |

---

# PARTIE 11 — MONITORING

## Structured logging (JSON) avec structlog

Chaque opération logge : `kill_detected`, `clip_created`, `vod_not_found`, `clip_failed`, etc.

## Métriques quotidiennes (rapport Discord 23:00)

`kills_detected_today`, `kills_clipped_today`, `kills_published_today`, `kills_in_error`,
`gemini_calls_today`, `gemini_quota_remaining`, `supabase_egress_estimated_mb`,
`r2_storage_used_gb`, `avg_clip_processing_seconds`, `worker_uptime_hours`.

## Alertes automatiques

| Alerte | Condition | Urgence |
|--------|-----------|---------|
| Worker down | Pas de heartbeat 1h | 🔴 |
| Gemini quota | >900 RPD | 🟡 |
| Supabase egress | >4 GB/mois | 🟡 |
| Kills en erreur | >5 CLIP_ERROR | 🟡 |
| API lolesports | 3 erreurs consécutives | 🔴 |
| yt-dlp throttle | 3 erreurs 429 | 🟡 |

---

# PARTIE 12 — ROADMAP

## Phase 0 — Setup (1-2 jours)
- [ ] Init monorepo Git
- [ ] Setup Supabase + exécuter schema SQL
- [ ] Setup Cloudflare R2 bucket + custom domain
- [ ] Setup Vercel projet
- [ ] Obtenir clés API (Gemini, Discord webhook, VAPID)
- [x] Acheter domaine kckills.com (Hostinger, DNS Cloudflare)

## Phase 1 — Worker MVP (8 jours)
- [ ] Client API lolesports (getSchedule, getEventDetails, getTeams)
- [ ] Client live stats feed (window endpoint)
- [ ] SENTINEL (détection matchs KC)
- [ ] HARVESTER (kill detection avancée avec corrélation + confidence)
- [ ] VOD_HUNTER (VOD + offset depuis getEventDetails)
- [ ] CLIPPER (yt-dlp + ffmpeg, triple format H + V + V_low)
- [ ] Validation sync (Gemini check gameplay + timer)
- [ ] ANALYZER (Gemini 2.5 Flash-Lite)
- [ ] OG_GENERATOR (Pillow → R2)
- [ ] WATCHDOG (Discord + monitoring)
- [ ] Scheduler global avec tous les rate limits
- [ ] Cache SQLite local (fallback Supabase)
- [ ] Backfill : 10+ matchs KC LEC Versus 2026
- [ ] Tests avec fixtures

## Phase 2 — Frontend (8 jours)
- [ ] Next.js 15 + Tailwind + shadcn/ui + design system LoL
- [ ] **Mode Scroll** /scroll (TikTok, autoplay, infinite, feed algorithm Wilson)
- [ ] **KC Timeline** bandeau (frise 2021-2026, filtre par ère, greyscale)
- [ ] Page /kill/[id] (clip multi-source, rate, comments)
- [ ] Page /player/[slug]
- [ ] Page /top
- [ ] Auth Discord (Supabase Auth)
- [ ] OG meta tags (redirect R2)
- [ ] PWA manifest + service worker + push notifications
- [ ] Mode live (polling 15s, bandeau KC EN LIVE)
- [ ] Recherche + filtres avancés
- [ ] Responsive mobile-first (375px)
- [ ] Accessibilité WCAG 2.1 AA

## Phase 3 — Communauté (4 jours)
- [ ] Ratings + commentaires + modération Haiku
- [ ] Tags communautaires (vote-based)
- [ ] Bot Discord (post auto des kills)
- [ ] Community clips (submit YouTube/TikTok)
- [ ] Gamification basique (badges)

## Phase 4 — Polish & Launch (2 jours)
- [ ] Performance audit (Lighthouse >90)
- [ ] Analytics Umami
- [ ] Backfill historique complet KC 2026
- [ ] SEO (sitemap, robots.txt, structured data)
- [ ] **ETO LE MONTRE EN STREAM** 🚀

**Total : ~23 jours de dev.**

---

# PARTIE 13 — CONSIGNES CLAUDE CODE

1. Commence par le worker (Phase 1). Le frontend sans données réelles est inutile.
2. Respecte TOUS les rate limits du scheduler. Un ban YouTube bloque tout.
3. Chaque module du worker : testable indépendamment avec fixtures.
4. Frontend mobile-first. Design pour 375px d'abord.
5. Les clips NE PASSENT PAS par Supabase. R2 uniquement.
6. Supabase = métadonnées JSON uniquement. Minimiser l'egress.
7. Disclaimer Riot sur CHAQUE page publique.
8. RLS activé sur TOUTES les tables. Pas d'exception.
9. Discord ID et Riot PUUID hashés SHA-256. Jamais en clair.
10. Chaque service externe a un mode dégradé documenté. Rien ne bloque le pipeline.
11. Le feed utilise Wilson score, PAS la moyenne brute des ratings.
12. Les OG images sont pré-générées par le worker (Pillow), PAS par Vercel (Satori).
13. Gemini 2.0 Flash est MORT. Utiliser 2.5 Flash-Lite.
14. Les clips ont 3 formats : horizontal 720p + vertical 720p + vertical 360p.
15. `movflags +faststart` sur TOUS les MP4 (progressive loading mobile).

---

*LoLTok — Every kill. Rated. Remembered.*
*Construit par Mehdi (Numelite) avec Claude (Kairos).*
