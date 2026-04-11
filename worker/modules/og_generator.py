"""
OG_GENERATOR — Pre-generates Open Graph images with Pillow.

1200x630 PNG: dark gradient background, gold Cinzel text,
killer→victim, rating stars, description AI, event badge.
Uploaded to R2 at og/{kill_id}.png.
"""

import os
import structlog
from PIL import Image, ImageDraw, ImageFont
from config import config

log = structlog.get_logger()

WIDTH = 1200
HEIGHT = 630
BG_COLOR = (1, 10, 19)         # --bg-primary
GOLD = (200, 170, 110)          # --gold
TEXT_PRIMARY = (240, 230, 210)   # --text-primary
TEXT_MUTED = (123, 141, 181)     # --text-muted
RED = (232, 64, 87)             # --red


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
    """Generate an OG image and return the file path."""
    out_dir = output_dir or config.THUMBNAILS_DIR
    os.makedirs(out_dir, exist_ok=True)
    output_path = os.path.join(out_dir, f"og_{kill_id}.png")

    try:
        img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
        draw = ImageDraw.Draw(img)

        # Gradient overlay (top-down gold tint)
        for y in range(HEIGHT):
            alpha = int(15 * (1 - y / HEIGHT))
            draw.line([(0, y), (WIDTH, y)], fill=(GOLD[0], GOLD[1], GOLD[2], alpha) if alpha > 0 else BG_COLOR)

        # Gold border lines
        draw.line([(0, 0), (WIDTH, 0)], fill=GOLD, width=3)
        draw.line([(0, 0), (0, HEIGHT)], fill=GOLD, width=3)

        # Try to load Cinzel font, fallback to default
        try:
            font_title = ImageFont.truetype("Cinzel-Bold.ttf", 52)
            font_sub = ImageFont.truetype("FiraSans-Regular.ttf", 28)
            font_small = ImageFont.truetype("FiraSans-Regular.ttf", 20)
        except Exception:
            font_title = ImageFont.load_default()
            font_sub = font_title
            font_small = font_title

        # Multi-kill badge
        y_offset = 80
        if multi_kill:
            badge = multi_kill.upper()
            draw.text((60, y_offset), badge, fill=GOLD, font=font_sub)
            y_offset += 50

        # Killer → Victim
        kill_text = f"{killer_name} ({killer_champion})"
        draw.text((60, y_offset), kill_text, fill=GOLD, font=font_title)
        y_offset += 70

        arrow_text = "eliminates"
        draw.text((60, y_offset), arrow_text, fill=TEXT_MUTED, font=font_sub)
        y_offset += 45

        victim_text = f"{victim_name} ({victim_champion})"
        draw.text((60, y_offset), victim_text, fill=RED, font=font_title)
        y_offset += 80

        # Description
        if description:
            draw.text((60, y_offset), description[:100], fill=TEXT_PRIMARY, font=font_sub)
            y_offset += 45

        # Rating
        if rating > 0:
            stars = "★" * int(round(rating)) + "☆" * (5 - int(round(rating)))
            rating_text = f"{stars}  {rating:.1f} ({rating_count} votes)"
            draw.text((60, y_offset), rating_text, fill=GOLD, font=font_small)

        # LoLTok branding
        draw.text((60, HEIGHT - 60), "LoLTok", fill=GOLD, font=font_sub)
        draw.text((200, HEIGHT - 55), "Every Kill. Rated. Remembered.", fill=TEXT_MUTED, font=font_small)

        img.save(output_path, "PNG", optimize=True)
        log.info("og_generated", kill_id=kill_id, path=output_path)
        return output_path

    except Exception as e:
        log.error("og_generation_failed", kill_id=kill_id, error=str(e))
        return None
