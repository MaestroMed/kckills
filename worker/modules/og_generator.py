"""
OG_GENERATOR — Pre-generates Open Graph images with Pillow.

1200×630 PNG: dark gradient background, gold Cinzel text,
killer → victim, rating stars, description AI, event badge.
Uploaded to R2 at og/{kill_id}.png.

Exposes:
- generate_og_image(...) low-level Pillow helper
- run() daemon loop for kills in status='analyzed' that still lack an OG image
"""

from __future__ import annotations

import asyncio
import os
import structlog

from PIL import Image, ImageDraw, ImageFont

from config import config
from services import r2_client
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()

# Concurrent Pillow renders + R2 uploads. Pillow itself releases the GIL
# during compression, and R2 uploads are I/O-bound, so 4 workers parallelise
# cleanly on a 16-core box. Bumped from serial loop after observing ~10min
# for a backlog of 200 OG images at 1 worker.
CONCURRENCY = 4

WIDTH = 1200
HEIGHT = 630
BG_COLOR = (1, 10, 19)            # --bg-primary
GOLD = (200, 170, 110)            # --gold
GOLD_BRIGHT = (240, 230, 210)     # --gold-bright
TEXT_PRIMARY = (240, 230, 210)
TEXT_MUTED = (123, 141, 181)
RED = (232, 64, 87)
BLUE_KC = (0, 87, 255)


def generate_og_image(
    kill_id: str,
    killer_name: str,
    killer_champion: str,
    victim_name: str,
    victim_champion: str,
    description: str = "",
    rating: float = 0,
    rating_count: int = 0,
    multi_kill: str | None = None,
    output_dir: str | None = None,
) -> str | None:
    """Generate an OG image and return the local file path."""
    out_dir = output_dir or config.THUMBNAILS_DIR
    os.makedirs(out_dir, exist_ok=True)
    output_path = os.path.join(out_dir, f"og_{kill_id}.png")

    try:
        img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
        draw = ImageDraw.Draw(img)

        # Subtle vertical gradient from BG → slightly warmer dark
        for y in range(HEIGHT):
            t = y / HEIGHT
            r = int(BG_COLOR[0] + (15 * (1 - t)))
            g = int(BG_COLOR[1] + (10 * (1 - t)))
            b = int(BG_COLOR[2] + (20 * (1 - t)))
            draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

        # Gold frame (top + left)
        draw.line([(0, 0), (WIDTH, 0)], fill=GOLD, width=3)
        draw.line([(0, 0), (0, HEIGHT)], fill=GOLD, width=3)
        draw.line([(0, HEIGHT - 1), (WIDTH, HEIGHT - 1)], fill=(60, 45, 20), width=1)

        font_title, font_sub, font_small = _load_fonts()

        # Multi-kill badge
        y_offset = 70
        if multi_kill:
            draw.text((60, y_offset), multi_kill.upper(), fill=GOLD_BRIGHT, font=font_sub)
            y_offset += 50

        # Killer line
        killer_text = f"{killer_name} · {killer_champion}"
        draw.text((60, y_offset), killer_text, fill=GOLD, font=font_title)
        y_offset += 70

        draw.text((60, y_offset), "eliminates", fill=TEXT_MUTED, font=font_sub)
        y_offset += 45

        victim_text = f"{victim_name} · {victim_champion}"
        draw.text((60, y_offset), victim_text, fill=RED, font=font_title)
        y_offset += 85

        if description:
            draw.text((60, y_offset), description[:100], fill=TEXT_PRIMARY, font=font_sub)
            y_offset += 45

        if rating and rating > 0:
            stars = "★" * int(round(rating)) + "☆" * (5 - int(round(rating)))
            rating_text = f"{stars}  {rating:.1f} ({rating_count} votes)"
            draw.text((60, y_offset), rating_text, fill=GOLD, font=font_small)

        # Branding footer
        draw.text((60, HEIGHT - 60), "KCKILLS", fill=GOLD, font=font_sub)
        draw.text((220, HEIGHT - 55), "Every Kill. Rated. Remembered.", fill=TEXT_MUTED, font=font_small)

        img.save(output_path, "PNG", optimize=True)
        log.info("og_generated", kill_id=kill_id, path=output_path)
        return output_path

    except Exception as e:
        log.error("og_generation_failed", kill_id=kill_id, error=str(e))
        return None


def _load_fonts():
    """Best-effort: try to load bundled fonts, fall back to Pillow default."""
    try:
        return (
            ImageFont.truetype("Cinzel-Bold.ttf", 52),
            ImageFont.truetype("FiraSans-Regular.ttf", 28),
            ImageFont.truetype("FiraSans-Regular.ttf", 20),
        )
    except Exception:
        pass
    try:
        # DejaVu ships with most Linux distros and python:3.12-slim
        return (
            ImageFont.truetype("DejaVuSans-Bold.ttf", 52),
            ImageFont.truetype("DejaVuSans.ttf", 28),
            ImageFont.truetype("DejaVuSans.ttf", 20),
        )
    except Exception:
        default = ImageFont.load_default()
        return default, default, default


# ─── Daemon loop ────────────────────────────────────────────────────────────

async def run() -> int:
    """Generate OG images for analysed kills that don't have one yet."""
    log.info("og_generator_scan_start")

    kills = safe_select(
        "kills",
        "id, killer_champion, victim_champion, ai_description, avg_rating, rating_count, multi_kill, og_image_url, status",
        status="analyzed",
    )
    if not kills:
        return 0

    # Fast-path : kills that already have og_image_url just need a
    # status flip. Batch them serially to avoid 200 parallel REST writes.
    already = [k for k in kills if k.get("og_image_url")]
    todo = [k for k in kills if not k.get("og_image_url")]
    for k in already:
        safe_update("kills", {"status": "published"}, "id", k["id"])

    if not todo:
        log.info("og_generator_scan_done", generated=0, status_only=len(already))
        return 0

    sem = asyncio.Semaphore(CONCURRENCY)
    counters = {"generated": 0, "skipped": 0}

    async def _process(kill: dict):
        async with sem:
            kid = kill["id"]
            # Pillow render runs CPU-bound; offload to a thread so the
            # event loop can keep firing the other workers' R2 uploads.
            local_path = await asyncio.to_thread(
                generate_og_image,
                kill_id=kid,
                killer_name=kill.get("killer_name") or "KC",
                killer_champion=kill.get("killer_champion") or "?",
                victim_name=kill.get("victim_name") or "Opponent",
                victim_champion=kill.get("victim_champion") or "?",
                description=kill.get("ai_description") or "",
                rating=float(kill.get("avg_rating") or 0),
                rating_count=int(kill.get("rating_count") or 0),
                multi_kill=kill.get("multi_kill"),
            )
            if not local_path:
                counters["skipped"] += 1
                return
            og_url = await r2_client.upload_og(kid, local_path)
            patch = {"status": "published"}
            if og_url:
                patch["og_image_url"] = og_url
            safe_update("kills", patch, "id", kid)
            try:
                os.remove(local_path)
            except Exception:
                pass
            counters["generated"] += 1

    await asyncio.gather(*[_process(k) for k in todo], return_exceptions=False)

    log.info(
        "og_generator_scan_done",
        generated=counters["generated"],
        skipped=counters["skipped"],
        status_only=len(already),
    )
    return counters["generated"]
