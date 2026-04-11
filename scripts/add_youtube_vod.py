"""
add_youtube_vod.py
──────────────────
Script interactif pour lier un VOD YouTube à un match KC et calibrer
les timestamps kill par kill.

Usage :
    cd Karmine_Stats
    python scripts/add_youtube_vod.py

Ce script :
1. Liste les games sans VOD dans la DB
2. Cherche automatiquement le VOD sur YouTube
3. Propose un timestamp estimé pour chaque kill
4. Met à jour la DB avec les infos VOD
"""

import os
import re
import sys
import json
import subprocess
import httpx
from pathlib import Path

# Add worker to path
sys.path.insert(0, str(Path(__file__).parent.parent / "worker"))

try:
    from src.config import config
    from src.db import get_db
    USE_DB = True
except Exception:
    USE_DB = False
    print("ℹ️  Mode sans DB — génère un fichier JSON local")


def search_youtube(query: str) -> list[dict]:
    """Cherche des vidéos YouTube via yt-dlp."""
    print(f"\n🔍 Recherche YouTube : {query}")
    try:
        result = subprocess.run(
            ["yt-dlp", "--flat-playlist", "--print", "%(id)s\t%(title)s\t%(duration)s", f"ytsearch5:{query}"],
            capture_output=True, text=True, timeout=30
        )
        videos = []
        for line in result.stdout.strip().split("\n"):
            parts = line.split("\t")
            if len(parts) >= 2:
                vid_id = parts[0]
                title = parts[1]
                duration = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
                videos.append({"id": vid_id, "title": title, "duration": duration})
        return videos
    except Exception as e:
        print(f"⚠️  yt-dlp non disponible : {e}")
        return []


def get_video_chapters(video_id: str) -> list[dict]:
    """Récupère les chapitres d'une vidéo YouTube (souvent les games)."""
    try:
        result = subprocess.run(
            ["yt-dlp", "--print", "%(chapters)j", f"https://www.youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=30
        )
        chapters_json = result.stdout.strip()
        if chapters_json and chapters_json != "null":
            return json.loads(chapters_json) or []
    except Exception:
        pass
    return []


def format_duration(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}h{m:02d}m{s:02d}s"
    return f"{m}:{s:02d}"


def game_time_to_seconds(game_time_ms: int) -> int:
    """Convertit un timestamp de jeu (ms) en secondes."""
    return game_time_ms // 1000


def interactive_add_vod():
    """Interface interactive pour ajouter un VOD."""

    print("\n" + "="*60)
    print("  KCKills — Ajout de VOD YouTube")
    print("="*60)

    # Liste les kills sans clip
    if USE_DB:
        db = get_db()
        kills = db.table("kills").select(
            "id, game_timestamp_ms, killer_champion, victim_champion, game_id"
        ).is_("clip_url", "null").order("game_timestamp_ms").execute()
        kills_data = kills.data or []
    else:
        # Mode démo — utilise les données du fichier
        kills_data = [
            {"id": "k1", "game_id": "g1", "game_timestamp_ms": 432000, "killer_champion": "LeeSin", "victim_champion": "Ksante"},
            {"id": "k2", "game_id": "g1", "game_timestamp_ms": 918000, "killer_champion": "Sylas", "victim_champion": "Azir"},
            {"id": "k3", "game_id": "g1", "game_timestamp_ms": 1284000, "killer_champion": "Jinx", "victim_champion": "Aphelios"},
            {"id": "k6", "game_id": "g2", "game_timestamp_ms": 1860000, "killer_champion": "Zeri", "victim_champion": "Jinx"},
            {"id": "k8", "game_id": "g3", "game_timestamp_ms": 1440000, "killer_champion": "Corki", "victim_champion": "Viktor"},
        ]

    if not kills_data:
        print("✅ Tous les kills ont déjà un clip !")
        return

    # Group by game
    games: dict[str, list] = {}
    for kill in kills_data:
        gid = kill["game_id"]
        if gid not in games:
            games[gid] = []
        games[gid].append(kill)

    print(f"\n📊 {len(kills_data)} kills sans clip dans {len(games)} games")

    results = {}  # game_id -> {youtube_id, offset}

    for game_id, game_kills in games.items():
        print(f"\n{'─'*60}")
        print(f"🎮 Game {game_id} — {len(game_kills)} kills")

        # Pour chaque game, demander le YouTube ID
        print("\n💡 Trouve le VOD sur : https://www.youtube.com/@lolesports/videos")
        print("   Ou cherche automatiquement (requires yt-dlp)")

        search = input("\nRecherche auto ? (ex: 'KC G2 LEC 2026 finale') ou colle l'URL/ID directement : ").strip()

        youtube_id = None
        game_start_offset = 0

        if search.startswith("http") or (len(search) == 11 and " " not in search):
            # Direct URL or ID
            if "youtube.com/watch?v=" in search:
                youtube_id = search.split("v=")[1].split("&")[0]
            elif "youtu.be/" in search:
                youtube_id = search.split("youtu.be/")[1].split("?")[0]
            else:
                youtube_id = search
        elif search:
            videos = search_youtube(f"{search} site:youtube.com")
            if videos:
                print("\n📺 Résultats :")
                for i, v in enumerate(videos[:5]):
                    print(f"  [{i+1}] {v['title']} ({format_duration(v['duration'])}) — ID: {v['id']}")
                choice = input("\nChoix (1-5) ou YouTube ID manuel : ").strip()
                if choice.isdigit() and 1 <= int(choice) <= len(videos):
                    youtube_id = videos[int(choice)-1]["id"]
                elif choice:
                    youtube_id = choice

        if not youtube_id:
            print("⏭  Game ignorée")
            continue

        print(f"\n✅ YouTube ID : {youtube_id}")
        print(f"   URL : https://www.youtube.com/watch?v={youtube_id}")

        # Try to get chapters for game detection
        print("\n🔍 Récupération des chapitres...")
        chapters = get_video_chapters(youtube_id)
        if chapters:
            print("📋 Chapitres détectés :")
            for i, ch in enumerate(chapters):
                print(f"  [{i+1}] {ch.get('title', '?')} → {format_duration(int(ch.get('start_time', 0)))}")

            ch_choice = input("\nQuel chapitre correspond à cette game ? (numéro ou 0 pour entrer manuellement) : ").strip()
            if ch_choice.isdigit() and 0 < int(ch_choice) <= len(chapters):
                game_start_offset = int(chapters[int(ch_choice)-1].get("start_time", 0))
                print(f"✅ Offset game : {format_duration(game_start_offset)}")

        if game_start_offset == 0:
            offset_input = input(f"\nTimestamp de début de la game dans le VOD (ex: 1234 ou 20:34) [0]: ").strip()
            if ":" in offset_input:
                parts = offset_input.split(":")
                if len(parts) == 2:
                    game_start_offset = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 3:
                    game_start_offset = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            elif offset_input.isdigit():
                game_start_offset = int(offset_input)

        results[game_id] = {
            "youtube_id": youtube_id,
            "offset": game_start_offset,
        }

        # Calculate timestamps for each kill
        print(f"\n📍 Timestamps calculés pour les kills :")
        kill_results = []
        for kill in sorted(game_kills, key=lambda k: k["game_timestamp_ms"]):
            game_time_s = game_time_to_seconds(kill["game_timestamp_ms"])
            vod_time = game_start_offset + game_time_s
            clip_start = max(0, vod_time - 10)
            clip_end = vod_time + 8

            print(f"  🗡  {kill['killer_champion']} → {kill['victim_champion']}")
            print(f"     Game: {format_duration(game_time_s)} | VOD: {format_duration(vod_time)}")
            print(f"     URL: https://youtu.be/{youtube_id}?t={clip_start}")

            kill_results.append({
                "kill_id": kill["id"],
                "youtube_id": youtube_id,
                "youtube_start": clip_start,
                "youtube_end": clip_end,
                "vod_time": vod_time,
            })

        confirm = input("\n✅ Confirmer ces timestamps ? (o/n) : ").strip().lower()
        if confirm in ("o", "oui", "y", "yes", ""):
            if USE_DB:
                for kr in kill_results:
                    db.table("kills").update({
                        "status": "ready",
                    }).eq("id", kr["kill_id"]).execute()
                db.table("games").update({
                    "vod_url": f"https://www.youtube.com/watch?v={youtube_id}",
                    "vod_platform": "youtube",
                    "vod_offset_seconds": game_start_offset,
                    "vod_offset_calibrated": True,
                }).eq("id", game_id).execute()
                print(f"✅ {len(kill_results)} kills mis à jour en DB")
            else:
                # Écrit dans un fichier JSON pour mise à jour manuelle du code
                output_file = Path(__file__).parent.parent / "data" / "youtube_vods.json"
                output_file.parent.mkdir(exist_ok=True)
                existing = {}
                if output_file.exists():
                    existing = json.loads(output_file.read_text())
                existing[game_id] = {
                    "youtube_id": youtube_id,
                    "game_start_offset": game_start_offset,
                    "kills": kill_results,
                }
                output_file.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
                print(f"\n✅ Données sauvegardées dans : {output_file}")
                print(f"\n📝 Copie ces valeurs dans demo-data.ts :")
                for kr in kill_results:
                    print(f"  kill {kr['kill_id']}: youtubeId: \"{kr['youtube_id']}\", youtubeStart: {kr['youtube_start']}, youtubeEnd: {kr['youtube_end']}")

    print("\n" + "="*60)
    print("  Terminé ! ✅")
    print("="*60)


if __name__ == "__main__":
    interactive_add_vod()
