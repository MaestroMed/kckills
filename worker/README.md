# KCKILLS / LoLTok — Worker Python

Daemon asyncio supervisé qui détecte les matchs KC LEC, extrait les kills,
clippe les VODs YouTube, analyse les clips via Gemini et pousse tout sur
Supabase + Cloudflare R2. Conçu pour tourner 24/7 sur le PC de Mehdi.

## TL;DR

```bash
cd worker
cp .env.example .env         # et remplis les clés
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # Linux/macOS
pip install -r requirements.txt

# 1) Test end-to-end sur 1 match :
python main.py pipeline 115548424308414188

# 2) Daemon 24/7 :
python main.py
```

## Pré-requis système

| Dépendance | Rôle | Install |
|-----------|------|---------|
| Python 3.12+ | runtime | python.org |
| ffmpeg | encoding triple format | `winget install Gyan.FFmpeg` / `brew install ffmpeg` / `apt install ffmpeg` |
| yt-dlp | download VOD segments | installé via `requirements.txt` |
| Disk | ~5 GB temp (clips pendant encoding) | SSD recommandé |

Pas besoin d'AWS CLI — le worker utilise **boto3** directement pour parler à
R2 (S3-compatible).

## Architecture

```
          ┌────────────────┐      toutes les 5 min
          │    SENTINEL    │────► détecte matchs KC terminés
          └───────┬────────┘      écrit dans `matches` + `games`
                  │
          ┌───────▼────────┐      toutes les 10 min
          │   HARVESTER    │────► extrait kills par diff de frames
          └───────┬────────┘      écrit dans `kills` (status: vod_found)
                  │
          ┌───────▼────────┐      toutes les 5 min
          │    CLIPPER     │────► yt-dlp + ffmpeg × 3 + R2 upload
          └───────┬────────┘      status: clipped
                  │
          ┌───────▼────────┐      toutes les 10 min
          │    ANALYZER    │────► Gemini 2.5 Flash-Lite
          └───────┬────────┘      status: analyzed
                  │
          ┌───────▼────────┐      toutes les 15 min
          │  OG_GENERATOR  │────► Pillow PNG → R2
          └───────┬────────┘      status: published ✅
                  │
          ┌───────▼────────┐      toutes les 6h
          │   HEARTBEAT    │────► ping Supabase (anti-pause)
          └────────────────┘

          ┌────────────────┐      toutes les 30 min + 23:00 UTC
          │    WATCHDOG    │────► flush cache, reset stuck kills,
          └────────────────┘      daily Discord report
```

Chaque module tourne dans sa **propre task asyncio supervisée** : un crash du
clipper n'interrompt pas le harvester. Restart automatique 10 s après crash.

## Commandes

```bash
# Daemon (mode production)
python main.py

# Un module à la fois (dev / debugging)
python main.py sentinel
python main.py harvester
python main.py clipper
python main.py analyzer
python main.py og
python main.py heartbeat
python main.py watchdog

# Pipeline end-to-end sur un match (test harness) :
# Prend un match_external_id (l'ID Riot, ex: 115548424308414188)
python main.py pipeline 115548424308414188
```

Le mode `pipeline` orchestre sentinel → harvester → clipper → analyzer →
og_generator **pour ce match uniquement**, et affiche un rapport en fin
d'exécution :

```
============================================================
  Pipeline report — match 115548424308414188
============================================================
  Games processed   : 3
  Kills detected    : 42
  Kills clipped     : 40
  Kills analysed    : 40
  Kills published   : 40
  Errors            : 2
    - clip_error kill=a1b2c3…
============================================================
```

## Tests

```bash
# Tests unitaires (scheduler + harvester frame diff)
python tests/test_scheduler.py
python tests/test_harvester.py
```

Ces tests n'ont pas besoin de credentials — ils utilisent des fixtures.

## Rate limits (tous respectés via `scheduler.py`)

| Service | Limite | Delay enforcé |
|---------|--------|---------------|
| Gemini 2.5 Flash-Lite | 15 RPM, 1000 RPD | 4s entre appels, 950 quota/jour |
| YouTube Data API | 10k units/jour | 95 search/jour max |
| yt-dlp | ban YouTube si spam | 10s entre downloads, backoff exp sur 429 |
| LoL Esports | non documenté | 2s entre appels idle |
| Live stats feed | non documenté | 2s entre fenêtres |
| Discord webhook | 30/60s | 2.5s entre messages |
| Supabase | 500 req/s | 0.1s |

Reset quotidien : **07:00 UTC** (minuit Pacific).

## Dégradation gracieuse

| Service down | Comportement |
|-------------|-------------|
| Supabase | buffer SQLite local (`local_cache.db`), flush auto au retour |
| R2 | retry x3 avec backoff, puis skip |
| Gemini | kills publiés sans tags/description (status bypass `analyzed`) |
| yt-dlp | 5 retries avec backoff 60→960s, puis `clip_error` + manual review |
| lolesports API | fallback Oracle's Elixir CSV (module `data_fallback.py`) |
| Discord | logs locaux |

## Troubleshooting

**`ModuleNotFoundError: google.generativeai`** → `pip install -r requirements.txt`

**`ffmpeg: command not found`** → installer ffmpeg système (voir pré-requis)

**`yt-dlp` 429 too many requests** → attendre 15 min, le scheduler backoff
automatiquement

**Supabase `PGRST116`** → vérifier que le schema
`supabase/migrations/001_loltok_schema.sql` est bien exécuté

**R2 `SignatureDoesNotMatch`** → re-vérifier `R2_ACCESS_KEY_ID` et
`R2_SECRET_ACCESS_KEY` (créés dans Cloudflare > R2 > Manage R2 API Tokens)

**Worker crash loop** → les crashs sont loggés en JSON via `structlog` et
envoyés sur Discord via `discord_webhook.notify_error`. Lis les logs.

## Deploy systemd (Linux)

```ini
# /etc/systemd/system/kckills-worker.service
[Unit]
Description=KCKILLS Worker
After=network.target

[Service]
Type=simple
User=mehdi
WorkingDirectory=/home/mehdi/kckills/worker
Environment="PYTHONUNBUFFERED=1"
ExecStart=/home/mehdi/kckills/worker/.venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kckills-worker
sudo journalctl -u kckills-worker -f
```

## Deploy Task Scheduler (Windows)

Créer une tâche qui exécute `worker\run-worker.bat` au démarrage Windows,
avec "Restart the task if it fails" → every 1 minute, up to 999 times.

Ou plus simple : lancer `python main.py` dans un terminal et laisser tourner.

## Structure

```
worker/
├── main.py                   # entry point + daemon loop
├── config.py                 # .env + constantes
├── scheduler.py              # rate limiter global
├── local_cache.py            # fallback SQLite
├── modules/
│   ├── sentinel.py           # poll LEC schedule
│   ├── harvester.py          # kill detection via livestats frame diff
│   ├── vod_hunter.py         # find YouTube VOD + offset
│   ├── clipper.py            # yt-dlp + ffmpeg triple format + R2
│   ├── analyzer.py           # Gemini 2.5 Flash-Lite
│   ├── og_generator.py       # Pillow 1200×630 PNG
│   ├── moderator.py          # Claude Haiku (opt-in)
│   ├── heartbeat.py          # anti-pause Supabase
│   ├── watchdog.py           # health + daily report
│   └── pipeline.py           # end-to-end orchestrator (test harness)
├── services/
│   ├── lolesports_api.py     # esports-api.lolesports.com client
│   ├── livestats_api.py      # feed.lolesports.com client
│   ├── supabase_client.py    # PostgREST via httpx (no supabase-py)
│   ├── r2_client.py          # boto3 S3-compatible
│   ├── youtube_dl.py         # yt-dlp wrapper
│   ├── ffmpeg_ops.py         # encoding helpers
│   ├── gemini_client.py      # google-generativeai wrapper
│   ├── haiku_client.py       # anthropic wrapper
│   ├── discord_webhook.py    # webhook helpers
│   ├── leaguepedia.py        # fallback Cargo API
│   └── oracles_elixir.py     # fallback CSV data
├── models/
│   └── kill_event.py         # KillEvent dataclass
├── fixtures/                 # test fixtures
├── tests/
│   ├── test_harvester.py
│   └── test_scheduler.py
├── requirements.txt
├── .env.example
├── Dockerfile
└── README.md
```
