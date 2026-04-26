# LoLTok / KCKills Worker — Production container
# ============================================================
#
# This Dockerfile is the deployment target for migrating the
# worker off Mehdi's local PC onto a cloud VM (Hetzner / Fly.io
# / Railway / DO Droplet). It is NOT used today — Mehdi still
# runs the worker as a Python process on his Windows box. See
# docs/worker-stateless-plan.md for the full migration plan and
# docs/worker-deployment-options.md for host comparison.
#
# Build :
#   docker build -t kckills-worker -f worker/Dockerfile .
#
# Run (operator example) :
#   docker run -d --name kckills \
#     --restart=unless-stopped \
#     -v /srv/kckills/cache:/cache \
#     -v /srv/kckills/firefox:/home/kckills/.mozilla \
#     --env-file worker/.env.prod \
#     -e KCKILLS_DATA_ROOT=/cache \
#     -e KCKILLS_COOKIES_FILE=/cache/.youtube_cookies.txt \
#     -e KCKILLS_USE_NVENC=0 \
#     kckills-worker
#
# Required ENV vars (passed via --env-file or -e flags) :
#   SUPABASE_URL                    Supabase project URL
#   SUPABASE_SERVICE_KEY            Service-role key (server-side)
#   YOUTUBE_API_KEY                 YouTube Data API v3 key
#   GEMINI_API_KEY                  Gemini Flash-Lite key
#   ANTHROPIC_API_KEY               Claude Haiku key (moderation)
#   R2_ACCOUNT_ID                   Cloudflare R2 account
#   R2_ACCESS_KEY_ID                R2 IAM access key
#   R2_SECRET_ACCESS_KEY            R2 IAM secret
#   R2_BUCKET_NAME                  R2 bucket name (default: loltok-clips)
#   R2_PUBLIC_URL                   R2 public custom domain
#   DISCORD_WEBHOOK_URL             Watchdog notifications
#   KCKILLS_YT_COOKIES_FIREFOX_PROFILE   Firefox profile name
#                                   (e.g. "kckills-scraper")
#                                   The profile must exist inside
#                                   /home/kckills/.mozilla/firefox/
#                                   — operator pre-bakes via volume
#                                   mount or `firefox -CreateProfile`
#                                   in a sidecar container.
#
# Optional ENV vars :
#   KCKILLS_DATA_ROOT               Override data root (default: /cache)
#   KCKILLS_USE_NVENC               "0"/"1"/"auto" — set "0" on cloud
#                                   VMs without NVIDIA GPU
#   KCKILLS_USE_REDIS               "1" to use Redis cache backend
#   KCKILLS_GEMINI_TIER             free|balanced|premium|experimental
#
# Volumes (operator should mount) :
#   /cache             SSD-backed volume for vods/clips/thumbnails/hls
#                      (~5GB working set per active match, prune-able)
#   /home/kckills/.mozilla   Firefox profile dir (cookies survive here)
#
# Healthcheck queries the local SQLite cache to confirm the worker
# DB is responsive — does NOT hit external APIs (those quotas matter).
# ============================================================


# ─── Stage 1 : builder — install Python deps in a fat layer ─────
FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps for cryptography + lxml + Pillow native compiles.
# Removed in the runtime stage — they're heavy and not needed at run.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libssl-dev \
        libjpeg-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY worker/requirements.txt ./requirements.txt
RUN pip install --prefix=/install -r requirements.txt


# ─── Stage 2 : runtime — slim image with only the binaries needed ─
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    # Default data root in the container — operator should mount a
    # volume here. LocalPaths picks this up via KCKILLS_DATA_ROOT
    # but we set the var so the default is sensible.
    KCKILLS_DATA_ROOT=/cache \
    # Container has no NVIDIA GPU by default → libx264 is the safe
    # default. Operator can flip back to "auto" or "1" if running on
    # a GPU-equipped host (e.g. Hetzner GEX44 with RTX, future).
    KCKILLS_USE_NVENC=0 \
    # Allow Firefox to find its profile dir even when run as non-root.
    HOME=/home/kckills

# Runtime system deps :
#   ffmpeg          — video pipeline (clipper, hls_packager)
#   firefox-esr     — yt-dlp --cookies-from-browser firefox:<profile>
#                     (cookies live in the profile, see youtube_cookies.py)
#   ca-certificates — TLS for httpx / boto3 / google-genai
#   curl, unzip     — for the deno install below
#   libffi8, libssl3, libjpeg62-turbo, zlib1g  — runtime libs for
#                     cryptography / Pillow compiled in stage 1
#   tini            — proper PID 1 (forwards signals, reaps zombies)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        firefox-esr \
        ca-certificates \
        curl \
        unzip \
        tini \
        libffi8 \
        libjpeg62-turbo \
        zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Deno — required by some upstream tooling that the worker shells
# out to (channel reconciler scripts). Installed via the official
# one-liner into /usr/local/bin so it's on PATH for any user.
RUN curl -fsSL https://deno.land/install.sh \
      | DENO_INSTALL=/usr/local sh -s -- -y --no-modify-path \
    && chmod +x /usr/local/bin/deno

# Non-root user. UID 1000 matches the typical first-user UID on
# debian/ubuntu hosts so volume permissions Just Work for the
# operator who chowns the host dir to 1000:1000.
RUN groupadd --system --gid 1000 kckills \
 && useradd  --system --uid 1000 --gid kckills \
            --home-dir /home/kckills --create-home \
            --shell /bin/bash kckills

# Copy installed Python packages from builder stage.
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy worker source (.dockerignore strips caches/clips/etc.).
COPY --chown=kckills:kckills worker/ /app/worker/

# Pre-create the cache mountpoint so Docker doesn't need root to
# bind-mount on top of it. Owned by the runtime user.
RUN mkdir -p /cache /home/kckills/.mozilla \
 && chown -R kckills:kckills /cache /home/kckills

USER kckills

# Healthcheck : ping the local cache DB. If the DB is unreachable
# the worker is wedged regardless of what the daemons think they're
# doing — fail fast, let the orchestrator (docker / fly / k8s) restart.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import sys; sys.path.insert(0, '/app/worker'); from local_cache import cache; cache.pending_count(); print('ok')" \
        > /dev/null 2>&1 || exit 1

# Use tini as PID 1 so SIGTERM from the host actually reaches the
# Python orchestrator (otherwise asyncio.run() ignores the bare
# signal and the host has to SIGKILL after 30s).
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command : run the orchestrator (the supervised multi-role
# version). Operator can override to run a one-shot script :
#   docker run --rm kckills-worker python -m worker.scripts.queue_status
CMD ["python", "-m", "worker.orchestrator"]
