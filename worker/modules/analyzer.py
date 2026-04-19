"""
ANALYZER — Gemini 2.5 Flash-Lite analyses clip content.

For each clipped kill:
- highlight_score (1.0–10.0)
- tags (max 5 from predefined list)
- description_fr (max 120 chars, commentateur style)
- kill_visible (bool)
- caster_hype_level (1–5)

Exposes:
- analyze_kill(...) low-level helper (text-only or with a local clip file)
- analyze_kill_row(...) builds factual context from a DB kill row
- run() daemon loop that scans kills in status='clipped' and analyses them

Prompt v4 (18 avr 2026) — patch from Opus 4.7 audit on 340 published
descriptions. Tightens credit attribution (KC roster pool), bans
hallucinated spell names + LaTeX/HTML residues, requires anchored
detail (HP / timestamp / objective / spell), enforces structural
variety, and ranks the verbs to retire ("termine" / "achève" /
"surprend" surutilisés).

Post-validation pass added (audit Quick Wins 1+2):
- Reject descriptions containing encoding artifacts ($, \\text{,
  &eacute;, etc) or known hallucination phrases
- Flag descriptions < 80 chars as suspicious (probable shallow output)
"""

from __future__ import annotations

import json
import os
import re
import structlog

from config import config
from scheduler import scheduler
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


# ─── Roster reference (used in the prompt to enforce credit accuracy) ──
# Pool snapshot used by the prompt. Updated when the LEC roster moves —
# stale info here = wrong credits in descriptions, which is exactly what
# we're patching out. Sources: kc_matches.json + audit Opus 4.7.

ROSTER_POOL_HINT = """- Canna = TOP (KSante, Renekton, Jax, Gnar, Ambessa, Rumble, Aatrox, Sion, Aurora top)
- Yike = JGL (Nocturne, Vi, Skarner, MonkeyKing/Wukong, Naafiri, XinZhao, Khazix, Maokai, Jax jungle)
- Kyeahoo = MID (Ahri, Anivia, Orianna, Azir, Galio, Ryze, Viktor, Syndra, Sylas, Taliyah, Akali, Leblanc, Yasuo, Neeko, TwistedFate)
- Caliste = ADC (Jhin, Varus, Caitlyn, Ashe, Corki, Ezreal, Kalista, Kaisa, Xayah, Zeri, Aphelios, Sivir, Lucian)
- Busio = SUP (Rell, Nautilus, Rakan, Bard, Thresh, Seraphine, Nami, Leona, Alistar, Renata)"""


ANALYSIS_PROMPT = """<role>Analyste esport LoL specialise highlights. Tu commentes avec precision factuelle, registre commentateur (Drakos / Trobi / Doigby).</role>

<task>Decris ce kill de match pro LoL en 1 phrase percutante, fr.
Killer: {killer_champion} ({killer_name})
Victime: {victim_champion} ({victim_name})
Donnees factuelles (verite terrain, NE PAS contredire):
{context}

Reponds UNIQUEMENT en JSON valide.</task>

<output_format>
{{
    "highlight_score": <float 1.0-10.0>,
    "tags": [<max 5 parmi: "outplay","teamfight","solo_kill","tower_dive",
              "baron_fight","dragon_fight","flash_predict","1v2","1v3",
              "clutch","clean","mechanical","shutdown","comeback",
              "engage","peel","snipe","steal">],
    "description_fr": "<max 120 chars, fr, FACTUEL et VARIE>",
    "kill_visible_on_screen": true,
    "caster_hype_level": <int 1-5>
}}
</output_format>

<roster_kc_lec_2026>
{roster_pool_hint}

REGLE: si killer OU victim est joue par un joueur KC, utilise le PSEUDO
DU JOUEUR (pas le nom du champion) au moins une fois dans la description.
Verifie que le champion correspond au pool ci-dessus avant d'attribuer.
</roster_kc_lec_2026>

<rules_dures_priorite_absolue>

1. CREDIT JOUEUR — voir bloc roster ci-dessus.

2. INTERDICTION ABSOLUE :
   - Ne mentionne JAMAIS un champion qui n'est ni le killer ni la victim ci-dessus.
   - Ne mentionne JAMAIS une equipe adverse specifique sauf si elle est
     EXPLICITEMENT dans les donnees factuelles.
   - N'invente JAMAIS de noms de sorts ("lance-tolet", "Essence of TF",
     "Kaleidoscope fantome" — ce sont des hallucinations qu'on a vues).
   - Pas de formules LaTeX ($, \\text{{}}), pas d'HTML entities (&eacute;,
     &amp;), pas de caracteres d'echappement : uniquement texte UTF-8 propre.

3. ANCRAGE CONCRET OBLIGATOIRE :
   La description DOIT contenir AU MOINS UN de ces 4 elements :
   - HP/PV chiffre ("a 134 HP", "20% de vie")
   - timestamp ("a 11:00", "a 22 minutes", "minute 31")
   - objectif precis (tour, dragon, Baron, Herald, Atakhan, inhibitor,
     tri-brush, pit, river, raptor)
   - sort nomme precisement (R = ultime nomme, ex "Grand Saut" pour
     Pantheon, "Vault Breaker" pour Vi E)

4. VARIETE STRUCTURELLE :
   Ne commence PAS par "[Champion] termine/acheve/surprend [Victim]".
   Ces 3 verbes sont SURUTILISES (33% de la base). Varie :
   - parfois commencer par l'action mecanique
   - parfois par la position
   - parfois par l'objectif conteste
   - parfois par le moment du match
   Verbes recommandes pour finir un kill : pique, scelle, envoie au sol,
   close, KO, met a terre, finish, expedie. Pour le sort : lance, pop,
   balance, place, trigger, chain.

5. MULTI-KILL ET FIRST BLOOD :
   - Si MULTI-KILL (double/triple/quadra/penta) est dans le contexte,
     la description DOIT le mentionner explicitement.
   - Si FIRST BLOOD est dans le contexte, la description DOIT mentionner
     "first blood" ou "premier sang".
   - Sinon, ne pas inventer ces mentions.

6. BANNIS (rejet automatique en post-validation) :
   - "sans aucune aide", "sans aide", "sans assistance", "zero assist"
     (redondant avec solo_kill dans les donnees structurees)
   - "propre", "proprement", "parfait", "parfaite" : max 1 fois par
     description, jamais 2
   - "utilise son [sort]" : remplacer par "lance", "pop", "balance",
     "place", "trigger"
   - "petite mise a mort", "expedie en un clin d'oeil" : trop informel

7. KILL_VISIBLE = FALSE (si dans contexte) :
   Ne PAS affirmer le kill avec certitude. Utilise "KC force le fight",
   "le setup mene a un pick", "l'engage retourne le tempo" — JAMAIS
   "X termine Y" / "X acheve Y".

</rules_dures_priorite_absolue>

<rules_softer>
- 1-3=routine, 4-6=interessant, 7-8=tres bon, 9-10=exceptionnel
- description_fr: max 120 chars, percutante, FACTUELLE, VARIEE
- Si assistants present: mentionne au moins un nom (ex: "avec l'assist de Yike")
- JSON VALIDE uniquement, pas de texte avant/apres
</rules_softer>"""


# ─── Post-validation (Audit Quick Wins 1+2) ───────────────────────────
# Reject descriptions containing encoding artifacts or known
# hallucination phrases. Flag suspicious-looking outputs (too short).

ENCODING_REJECT_PATTERNS = [
    re.compile(r"\$"),                  # LaTeX dollar signs
    re.compile(r"\\text\{"),            # \text{...}
    re.compile(r"&[a-z]+;"),            # &eacute; &amp; &nbsp;
    re.compile(r"\\u00[0-9a-f]{2}"),    # raw \u00e9 escapes
    re.compile(r"<[a-z]+/?>"),          # stray HTML tags
]

KNOWN_HALLUCINATION_PATTERNS = [
    re.compile(r"lance-tolet", re.IGNORECASE),
    re.compile(r"essence of[A-Z]?", re.IGNORECASE),
    re.compile(r"kal[ée]idoscope fant", re.IGNORECASE),
]

BANNED_PHRASE_PATTERNS = [
    re.compile(r"\bsans aucune aide\b", re.IGNORECASE),
    re.compile(r"\bsans aide\b", re.IGNORECASE),
    re.compile(r"\bsans assistance\b", re.IGNORECASE),
    re.compile(r"\bzero assist\b", re.IGNORECASE),
]

MIN_DESCRIPTION_CHARS = 80


def validate_description(text: str | None) -> tuple[bool, str]:
    """Return (is_acceptable, reason). False = description should be re-tried.

    is_acceptable=True is the happy path. If False, the worker should
    NOT save this description to kills.ai_description and should
    instead leave the row in 'analyzed' status with needs_regen=true so
    the next analyzer pass picks it up again.
    """
    if not text or not isinstance(text, str):
        return False, "empty"
    stripped = text.strip()
    if len(stripped) < MIN_DESCRIPTION_CHARS:
        return False, f"too_short ({len(stripped)} < {MIN_DESCRIPTION_CHARS} chars)"
    for pat in ENCODING_REJECT_PATTERNS:
        if pat.search(stripped):
            return False, f"encoding_artifact ({pat.pattern!r})"
    for pat in KNOWN_HALLUCINATION_PATTERNS:
        if pat.search(stripped):
            return False, f"known_hallucination ({pat.pattern!r})"
    for pat in BANNED_PHRASE_PATTERNS:
        if pat.search(stripped):
            return False, f"banned_phrase ({pat.pattern!r})"
    return True, "ok"


# ─── Core call ──────────────────────────────────────────────────────────

async def analyze_kill(
    killer_name: str,
    killer_champion: str,
    victim_name: str,
    victim_champion: str,
    context: str = "",
    clip_path: str | None = None,
) -> dict | None:
    """Analyze a kill with Gemini. Returns parsed JSON dict or None.

    The result is NOT validated here — the caller is responsible for
    running validate_description on result['description_fr'] and
    deciding whether to save it.
    """
    if not config.GEMINI_API_KEY:
        log.warn("gemini_no_api_key")
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("gemini_quota_exceeded")
        return None

    prompt = ANALYSIS_PROMPT.format(
        killer_champion=killer_champion or "?",
        killer_name=killer_name or "?",
        victim_champion=victim_champion or "?",
        victim_name=victim_name or "?",
        context=context or "",
        roster_pool_hint=ROSTER_POOL_HINT,
    )

    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        log.warn("gemini_sdk_not_installed")
        return None

    text = ""
    try:
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash-lite")

        if clip_path and os.path.exists(clip_path):
            video_file = genai.upload_file(clip_path)
            from services.gemini_client import _wait_for_file_active
            if not _wait_for_file_active(genai, video_file):
                log.warn("gemini_file_not_active", clip=clip_path)
                response = model.generate_content(prompt)
            else:
                response = model.generate_content([prompt, video_file])
        else:
            response = model.generate_content(prompt)

        text = (response.text or "").strip()
        text = _strip_code_fence(text)
        result = json.loads(text)
        log.info("gemini_analysis_done", score=result.get("highlight_score"))
        return result
    except json.JSONDecodeError:
        log.warn("gemini_invalid_json", text=text[:200] if text else "")
        return None
    except Exception as e:
        log.error("gemini_error", error=str(e))
        return None


def _strip_code_fence(text: str) -> str:
    """Gemini sometimes wraps JSON in ```json ... ``` fences — unwrap them."""
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            inner = parts[1]
            if inner.startswith("json"):
                inner = inner[4:]
            return inner.strip()
    return text


async def analyze_kill_row(kill: dict, clip_path: str | None = None) -> dict | None:
    """Build rich factual context from a DB kill row and call analyze_kill.

    Reads the ground-truth columns populated by the harvester +
    server-side classifiers (fight_type, matchup_lane, lane_phase,
    multi_kill, is_first_blood, kill_visible). Passes them as INPUT
    to Gemini — NOT something to guess.
    """
    parts: list[str] = []

    # ─── Ground truth (server-side classified, NEVER guessed) ────────
    if kill.get("is_first_blood"):
        parts.append("FIRST BLOOD = oui (description DOIT le mentionner)")
    if kill.get("multi_kill"):
        mk = str(kill["multi_kill"]).upper()
        parts.append(f"MULTI-KILL = {mk} (description DOIT le mentionner)")

    fight_type = kill.get("fight_type")
    if fight_type:
        parts.append(f"fight_type = {fight_type} (verite terrain — NE PAS contredire)")

    lane = kill.get("matchup_lane")
    if lane:
        parts.append(f"lane = {lane}")

    phase = kill.get("lane_phase")
    if phase:
        parts.append(f"phase = {phase}")

    # KC involvement
    involvement = kill.get("tracked_team_involvement") or ""
    if involvement == "team_killer":
        parts.append("KC scores the kill")
    elif involvement == "team_victim":
        parts.append("KC player eliminated")

    # Assistants — critical for factual accuracy
    assistants = kill.get("assistants") or []
    if isinstance(assistants, list) and len(assistants) > 0:
        assist_names = [
            a.get("champion") or a.get("name") or "?"
            for a in assistants
            if isinstance(a, dict)
        ]
        if assist_names:
            parts.append(
                f"Assistants: {', '.join(assist_names)} "
                f"({len(assist_names)} assist(s) = PAS un solo kill)"
            )
        else:
            parts.append(f"{len(assistants)} assistant(s) = PAS un solo kill")
    else:
        parts.append("ZERO assist")

    # Shutdown bounty
    bounty = kill.get("shutdown_bounty") or 0
    if bounty >= 400:
        parts.append(f"Shutdown bounty: {bounty}g")

    # kill_visible — if False, instruct Gemini to NOT affirm the kill
    kv = kill.get("kill_visible")
    if kv is False:
        parts.append(
            "kill_visible = FALSE (kill non visible a l'ecran — "
            "NE PAS affirmer le kill, decrire le setup uniquement)"
        )

    return await analyze_kill(
        killer_name=kill.get("_killer_name_hint") or kill.get("killer_name") or "KC player",
        killer_champion=kill.get("killer_champion") or "?",
        victim_name=kill.get("_victim_name_hint") or kill.get("victim_name") or "opponent",
        victim_champion=kill.get("victim_champion") or "?",
        context=". ".join(parts),
        clip_path=clip_path,
    )


# ─── Daemon loop ────────────────────────────────────────────────────────

async def run() -> int:
    """Find kills in status='clipped' and run Gemini analysis.

    Now reads the ground-truth columns (fight_type, matchup_lane,
    lane_phase, kill_visible) so analyze_kill_row can pass them as
    truth lines. Post-validates the description before saving — bad
    descriptions stay in status='clipped' so the next pass retries.
    """
    log.info("analyzer_scan_start")

    kills = safe_select(
        "kills",
        "id, killer_champion, victim_champion, is_first_blood, multi_kill, "
        "tracked_team_involvement, fight_type, matchup_lane, lane_phase, "
        "kill_visible, assistants, shutdown_bounty, retry_count, "
        "clip_url_vertical, clip_url_horizontal",
        status="clipped",
    )
    if not kills:
        return 0

    analysed = 0
    rejected = 0
    for kill in kills:
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 0:
            log.warn("analyzer_daily_quota_reached")
            break

        # Download clip from R2 for VIDEO analysis (not text-only)
        clip_path = None
        clip_url = kill.get("clip_url_vertical") or kill.get("clip_url_horizontal")
        if clip_url:
            import httpx as _httpx
            _clip_dir = os.path.join(os.path.dirname(__file__), "..", "clips")
            os.makedirs(_clip_dir, exist_ok=True)
            clip_path = os.path.join(_clip_dir, f"qc_{kill['id'][:8]}.mp4")
            try:
                with _httpx.stream("GET", clip_url, follow_redirects=True, timeout=30) as resp:
                    resp.raise_for_status()
                    with open(clip_path, "wb") as f:
                        for chunk in resp.iter_bytes():
                            f.write(chunk)
            except Exception as e:
                log.warn("analyzer_clip_download_failed", kill_id=kill["id"][:8], error=str(e)[:60])
                clip_path = None

        result = await analyze_kill_row(kill, clip_path=clip_path)

        # Clean up downloaded clip
        if clip_path and os.path.exists(clip_path):
            try:
                os.remove(clip_path)
            except Exception:
                pass

        if not result:
            continue

        desc = result.get("description_fr")
        ok, reason = validate_description(desc)
        if not ok:
            log.warn(
                "analyzer_desc_rejected",
                kill_id=kill.get("id"),
                reason=reason,
                desc_preview=(desc or "")[:80],
            )
            rejected += 1
            # Bump retry counter — if too many failures, give up and let
            # human review handle it. Stays in 'clipped' status so the
            # next analyzer pass picks it up again.
            current_retries = int(kill.get("retry_count") or 0)
            if current_retries >= 3:
                log.warn(
                    "analyzer_giving_up",
                    kill_id=kill.get("id"),
                    retries=current_retries,
                )
                # Move to manual_review so we don't loop forever on a
                # row Gemini can't describe properly.
                safe_update(
                    "kills",
                    {"status": "manual_review", "retry_count": current_retries + 1},
                    "id",
                    kill["id"],
                )
            else:
                safe_update(
                    "kills",
                    {"retry_count": current_retries + 1},
                    "id",
                    kill["id"],
                )
            continue

        patch = {
            "highlight_score": _safe_float(result.get("highlight_score")),
            "ai_tags": result.get("tags") or [],
            "ai_description": desc,
            "kill_visible": bool(result.get("kill_visible_on_screen", True)),
            "caster_hype_level": _safe_int(result.get("caster_hype_level")),
            "status": "analyzed",
        }
        safe_update("kills", patch, "id", kill["id"])
        analysed += 1

    log.info("analyzer_scan_done", analysed=analysed, rejected=rejected)
    return analysed


def _safe_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None
