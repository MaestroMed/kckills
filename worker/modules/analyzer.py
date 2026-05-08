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

import asyncio
import json
import os
import re
import time
import structlog

from config import config
from scheduler import scheduler
from services import job_queue
from services.ai_pricing import compute_gemini_cost
from services.observability import run_logged
from services.runtime_tuning import (
    get_batch_size,
    get_lease_seconds,
    get_parallelism,
)
from services.supabase_client import (
    get_db,
    safe_insert,
    safe_select,
    safe_update,
)

log = structlog.get_logger()


# ─── Versioning constants (PR23-arch) ────────────────────────────────
# Bump ANALYZER_PROMPT_VERSION whenever the wording of ANALYSIS_PROMPT
# changes (rules, tags list, output format, roster pool — anything that
# can shift the model's output distribution). The version is stored on
# every ai_annotations row so we can later filter "what scores did
# v3 produce vs v4" without re-running.
#
# History :
#   v1 = original 3-rule prompt (pre-PR16)
#   v2 = added multi-language descriptions (PR14)
#   v3 = audit Quick Wins 1+2, anchored detail, banned phrases (current)
ANALYZER_PROMPT_VERSION: str = "v3"

# Pipeline-level version, logged into ai_annotations.analysis_version.
# Bumped when the pipeline architecture changes (kill_assets, ai_annotations,
# multi-step calls, etc.) regardless of the prompt wording.
ANALYZER_PIPELINE_VERSION: str = "v2"


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
              "engage","peel","snipe","steal","level_1_cheese",
              "rare_champ_pick","drake_steal","baron_steal","reverse_gank",
              "deep_ward","gold_swing","penta_setup","ace_setup",
              "side_swap","support_outplay","jungle_invade","mid_roam",
              "scary_play","clean_finish">],
    "description_fr": "<max 120 chars, FR, FACTUEL et VARIE>",
    "description_en": "<max 130 chars, EN, same energy as FR>",
    "description_ko": "<max 80 chars, KR Korean>",
    "description_es": "<max 130 chars, ES Spanish>",
    "kill_visible_on_screen": true,
    "caster_hype_level": <int 1-5>,
    "best_thumbnail_timestamp_in_clip_sec": <int 0-40, second IN the clip
                                              that best captures the kill
                                              moment — kill landing impact,
                                              champion ult animation, killfeed
                                              flash. Avoid loading screens,
                                              minimap zooms, caster cams>,
    "in_game_timer_at_clip_midpoint": "<MM:SS or NONE if not visible —
                                        read the in-game clock at top center
                                        of the screen at clip midpoint>",
    "confidence_score": <float 0.0-1.0, ton degre de confiance dans CETTE
                          analyse. 1.0 = clip net, kill clairement visible,
                          champions identifies sans doute. 0.5 = clip flou
                          ou angle incertain. 0.0 = devine totalement.>
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

# Descriptions shorter than this trigger a Gemini retry (up to 3 retries).
# Originally 80 to enforce "rich" descriptions, but Gemini's natural French
# style for short LoL kill clips lands in the 60-80 char range. Empirical
# observation : 73 of 75 recent rejections were perfectly valid clips like
# "KC Yike termine la Gwen avec une exécution éclair à la minute 31."
# (73 chars). Rejecting + retrying these wastes Gemini quota AND blocks
# publication. 50 chars is a safer floor that still catches truly empty /
# stub responses. The encoding-artifact + hallucination filters below
# remain unchanged — they're the real quality guard.
MIN_DESCRIPTION_CHARS = 50


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


# ─── Wave 13f migration — JSON schema for structured output ───────────
# The new google-genai SDK supports `response_schema` on
# generate_content. Passing this schema below tells Gemini to return
# JSON that matches the analyzer's contract exactly — no more
# JSON-fence stripping, no more "did the model wrap it in ```json"
# defense, no more catching JSONDecodeError on every call.
#
# Mirrors the <output_format> block in ANALYSIS_PROMPT above. If you
# add/remove a field there, update this schema too — the prompt is
# the human-readable spec, the schema is the machine-readable contract.
#
# Note : `tags` is intentionally an open array of strings (not a
# Pydantic enum) because the validation (max 5, allowed values) is
# enforced as part of the prompt rules and the soft post-validation
# below. Schema-level enum would hard-fail the call instead of
# letting the validator reject + retry, which is more brittle in
# practice given the model occasionally invents close-but-wrong tags.
ANALYSIS_RESPONSE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "highlight_score": {"type": "number"},
        "tags": {
            "type": "array",
            "items": {"type": "string"},
        },
        "description_fr": {"type": "string"},
        "description_en": {"type": "string"},
        "description_ko": {"type": "string"},
        "description_es": {"type": "string"},
        "kill_visible_on_screen": {"type": "boolean"},
        "caster_hype_level": {"type": "integer"},
        "best_thumbnail_timestamp_in_clip_sec": {"type": "integer"},
        "in_game_timer_at_clip_midpoint": {"type": "string"},
        "confidence_score": {"type": "number"},
    },
    "required": [
        "highlight_score", "tags", "description_fr",
        "kill_visible_on_screen",
    ],
}


# ─── Core call ──────────────────────────────────────────────────────────

async def analyze_kill(
    killer_name: str,
    killer_champion: str,
    victim_name: str,
    victim_champion: str,
    context: str = "",
    clip_path: str | None = None,
    model_override: str | None = None,
) -> dict | None:
    """Analyze a kill with Gemini. Returns parsed JSON dict or None.

    The result is NOT validated here — the caller is responsible for
    running validate_description on result['description_fr'] and
    deciding whether to save it.

    Returned dict carries internal _model / _usage / _latency_ms /
    _raw_text keys that the caller (analyze_kill_row → _process_one)
    forwards into the ai_annotations row for provenance tracking.
    """
    if not config.GEMINI_API_KEY:
        log.warn("gemini_no_api_key")
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        # Wave 20.1 — surface the remaining count so the operator can
        # distinguish "literally 0 left" from "drifted under the floor"
        # at a glance. Same shape as services/gemini_client.py for
        # consistency.
        try:
            remaining = scheduler.get_remaining("gemini")
        except Exception:
            remaining = None
        log.warn(
            "gemini_quota_exhausted",
            remaining=remaining,
            reset_hour_utc=scheduler.QUOTA_RESET_HOUR_UTC,
        )
        return None

    prompt = ANALYSIS_PROMPT.format(
        killer_champion=killer_champion or "?",
        killer_name=killer_name or "?",
        victim_champion=victim_champion or "?",
        victim_name=victim_name or "?",
        context=context or "",
        roster_pool_hint=ROSTER_POOL_HINT,
    )

    # Wave 13f migration — moved from `google.generativeai` (deprecated,
    # FutureWarning on every import) to `google.genai`. The new SDK
    # exposes a per-process Client and supports native structured
    # output via `response_schema` — see ANALYSIS_RESPONSE_SCHEMA above.
    # The schema makes the JSON-fence-stripping defensive layer obsolete :
    # Google guarantees `response.text` is parseable JSON matching the
    # schema (or surfaces the failure on the call).
    from services.gemini_client import get_client, _wait_for_file_active
    client = get_client()
    if client is None:
        log.warn("gemini_sdk_not_installed")
        return None
    try:
        from google.genai import types  # type: ignore
    except ImportError:
        log.warn("gemini_sdk_not_installed")
        return None

    text = ""
    started_at = time.monotonic()
    try:
        # PR13 — allow per-call model override (used by lab generator
        # to A/B-test different models on the same clip). Defaults to
        # the configured analyzer model.
        model_name = model_override or config.GEMINI_MODEL_ANALYZER

        # Wave 13f — single typed config used for every variant (with
        # video / text-only). `response_mime_type` + `response_schema`
        # tell Gemini to return JSON matching the analyzer schema,
        # so we don't need fence stripping or JSON-shape defenses.
        gen_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ANALYSIS_RESPONSE_SCHEMA,
        )

        if clip_path and os.path.exists(clip_path):
            video_file = client.files.upload(
                file=clip_path,
                config=types.UploadFileConfig(mime_type="video/mp4"),
            )
            if not _wait_for_file_active(client, video_file):
                log.warn("gemini_file_not_active", clip=clip_path)
                response = client.models.generate_content(
                    model=model_name, contents=prompt, config=gen_config,
                )
            else:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[prompt, video_file],
                    config=gen_config,
                )
        else:
            response = client.models.generate_content(
                model=model_name, contents=prompt, config=gen_config,
            )

        text = (response.text or "").strip()
        # Wave 13f : structured-output guarantees parseable JSON, so we
        # can json.loads() directly. We KEEP the json.loads() inside a
        # try/except below because the model has been observed to
        # occasionally violate the schema (rare, ~0.1%), and we'd
        # rather log + retry than crash the producer.
        result = json.loads(text)
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        log.info("gemini_analysis_done",
                 score=result.get("highlight_score"),
                 latency_ms=elapsed_ms)
        # Surface usage_metadata for lab cost accounting + ai_annotations
        try:
            um = getattr(response, "usage_metadata", None)
            if um is not None:
                result["_usage"] = {
                    "prompt_tokens": getattr(um, "prompt_token_count", None),
                    "candidates_tokens": getattr(um, "candidates_token_count", None),
                    "total_tokens": getattr(um, "total_token_count", None),
                }
        except Exception:
            pass
        result["_model"] = model_name
        result["_latency_ms"] = elapsed_ms
        result["_raw_text"] = text
        return result
    except json.JSONDecodeError as e:
        # Wave 20.1 — was warn ; bumped to error since this means the
        # structured-output schema (which is supposed to GUARANTEE
        # parseable JSON) was violated. Worth surfacing in Sentry-class
        # dashboards. text[:300] is enough to tell whether Gemini
        # returned a fence, a truncation, or pure prose.
        log.error(
            "gemini_invalid_json",
            killer=killer_name,
            victim=victim_name,
            decode_error=str(e)[:160],
            text=text[:300] if text else "",
        )
        return None
    except Exception as e:
        log.error("gemini_error", error=str(e))
        return None


# Wave 13f migration : `_strip_code_fence` removed. The new SDK returns
# guaranteed-parseable JSON via `response_mime_type=application/json` +
# `response_schema=ANALYSIS_RESPONSE_SCHEMA` — Gemini no longer wraps
# the payload in markdown fences when those config flags are set.


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
        model_override=kill.get("_model_override"),
    )


# ─── Daemon loop ────────────────────────────────────────────────────────

# Cap how many clips we attempt per analyzer pass. Gemini Flash-Lite is
# free-tier capped at 950 RPD ≈ 39/hour. The cap is a safety bound
# against pulling 5000 rows at once.
#
# Tunable via KCKILLS_BATCH_ANALYZER (default 80).
ANALYZER_BATCH_SIZE = get_batch_size("analyzer")
ANALYZER_LEASE_SECONDS = get_lease_seconds("analyzer")


@run_logged()
async def run() -> int:
    """Analyzer main loop — queue-first, legacy scan as fallback.

    Order :
      1. Claim `clip.analyze` jobs from pipeline_jobs.
      2. If empty, fall back to scanning kills.status='clipped' AND
         enqueue jobs for what we find. Process them in this same pass
         so the migration window doesn't stall.
      3. Run the existing producer/consumer pipeline (Gemini analyzes
         while next clip downloads from R2). The optional pipeline_jobs
         row is attached to each kill dict via the `_pipeline_job` key
         so _process_one can succeed/fail it after the Gemini pass.
      4. On success : enqueue `og.generate`, `embedding.compute`, and
         `event.map` for downstream modules.
    """
    log.info("analyzer_scan_start")

    worker_id = f"analyzer-{os.getpid()}"

    # ─── 1. Queue-first claim ──────────────────────────────────────
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["clip.analyze"],
        ANALYZER_BATCH_SIZE,
        ANALYZER_LEASE_SECONDS,  # default 900s ; tunable via KCKILLS_LEASE_ANALYZER
    )

    legacy_fallback_used = False
    work_kills: list[dict] = []

    for job in claimed:
        kill_id = job.get("entity_id")
        if not kill_id:
            await asyncio.to_thread(
                job_queue.fail, job["id"], "no entity_id on job",
                60, "bad_payload",
            )
            continue
        rows = safe_select(
            "kills",
            "id, killer_champion, victim_champion, is_first_blood, multi_kill, "
            "tracked_team_involvement, fight_type, matchup_lane, lane_phase, "
            "kill_visible, assistants, shutdown_bounty, retry_count, "
            "clip_url_vertical, clip_url_horizontal, game_time_seconds",
            id=kill_id,
        )
        if not rows:
            await asyncio.to_thread(
                job_queue.fail, job["id"], "kill row missing",
                3600, "kill_deleted",
            )
            continue
        # Attach the pipeline_jobs row so _process_one can ack it.
        rows[0]["_pipeline_job"] = job
        work_kills.append(rows[0])

    # ─── 2. Legacy fallback if queue was empty ────────────────────
    if not work_kills:
        legacy_fallback_used = True
        kills = safe_select(
            "kills",
            "id, killer_champion, victim_champion, is_first_blood, multi_kill, "
            "tracked_team_involvement, fight_type, matchup_lane, lane_phase, "
            "kill_visible, assistants, shutdown_bounty, retry_count, "
            "clip_url_vertical, clip_url_horizontal, game_time_seconds",
            status="clipped",
        )
        if not kills:
            return 0
        kills = kills[:ANALYZER_BATCH_SIZE]
        # Enqueue for next pass so subsequent runs go through the queue.
        # Idempotent via the unique index on (type, entity_type, entity_id).
        enqueued = 0
        for k in kills:
            jid = await asyncio.to_thread(
                job_queue.enqueue,
                "clip.analyze", "kill", k["id"],
                None, 50, None, 3,
            )
            if jid:
                enqueued += 1
        log.info(
            "analyzer_legacy_fallback",
            processing=len(kills), enqueued_for_next_pass=enqueued,
        )
        work_kills = kills
    else:
        log.info(
            "analyzer_queue", claimed=len(claimed), processing=len(work_kills),
        )

    # PR10-C : pipelined producer/consumer.
    # While clip N is being analyzed by Gemini (5s call + 4s rate-limit
    # wait), clip N+1 is already downloading from R2 (~5-10s). Effective
    # cadence drops to max(download, gemini) per clip ≈ 9-10s instead of
    # ~12-15s serial. ~1.3-2x throughput at zero quota cost.
    return await _run_pipelined(work_kills)


# ─── Pipelined run ─────────────────────────────────────────────────────────

QUEUE_MAX = 8
# Number of concurrent R2 download workers feeding the Gemini consumer.
# Gemini itself is single-threaded (4s/call rate-limit) so adding more
# downloaders past the queue depth = no benefit. Tunable via
# KCKILLS_PARALLEL_ANALYZER (default 5).
DOWNLOAD_WORKERS = get_parallelism("analyzer")
SENTINEL: object = object()


async def _download_clip_async(kill: dict) -> tuple[dict, str | None]:
    """Async wrapper around the blocking httpx.stream download.

    Returns (kill, clip_path_or_None). On failure, clip_path is None and
    the consumer falls back to text-only Gemini analysis.
    """
    clip_url = kill.get("clip_url_vertical") or kill.get("clip_url_horizontal")
    if not clip_url:
        return kill, None
    _clip_dir = config.CLIPS_DIR
    os.makedirs(_clip_dir, exist_ok=True)
    clip_path = os.path.join(_clip_dir, f"qc_{kill['id'][:8]}.mp4")

    def _blocking() -> bool:
        import httpx as _httpx
        try:
            with _httpx.stream("GET", clip_url, follow_redirects=True, timeout=30) as resp:
                resp.raise_for_status()
                with open(clip_path, "wb") as f:
                    for chunk in resp.iter_bytes():
                        f.write(chunk)
            return True
        except Exception as e:
            log.warn("analyzer_clip_download_failed",
                     kill_id=kill["id"][:8], error=str(e)[:60])
            return False

    ok = await asyncio.to_thread(_blocking)
    return kill, (clip_path if ok else None)


async def _download_worker(in_q: "asyncio.Queue", out_q: "asyncio.Queue") -> None:
    while True:
        item = await in_q.get()
        if item is SENTINEL:
            in_q.task_done()
            await out_q.put(SENTINEL)
            break
        try:
            pair = await _download_clip_async(item)
            await out_q.put(pair)
        finally:
            in_q.task_done()


def _cleanup_clip(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


async def _process_one(kill: dict, clip_path: str | None,
                       counters: dict) -> None:
    """Run Gemini + commit results for a single kill. Mirrors the
    pre-refactor inline loop body.

    PR23-arch : results are written to ai_annotations (versioned,
    confidence-scored, provenance-tracked). The DB trigger
    fn_sync_ai_annotation_to_kill keeps the legacy kills.* columns in
    sync, so /scroll keeps working without code changes. The kills row
    is only mutated here for fields that are NOT covered by the trigger
    (status, retry_count, needs_reclip, kill_visible, caster_hype_level,
    ai_qc_timer_sec, ai_qc_drift_sec, ai_pipeline_version).

    Queue integration : when kill carries a `_pipeline_job` row (from
    job_queue.claim), we ack it on success and fail it on rejection.
    Downstream jobs (og.generate, embedding.compute, event.map) are
    enqueued only on success.
    """
    job = kill.get("_pipeline_job")  # may be None for legacy fallback path
    result = await analyze_kill_row(kill, clip_path=clip_path)
    _cleanup_clip(clip_path)

    if not result:
        if job is not None:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                "gemini returned no result", 300, "gemini_empty",
            )
        return

    desc = result.get("description_fr")
    ok, reason = validate_description(desc)
    if not ok:
        log.warn(
            "analyzer_desc_rejected",
            kill_id=kill.get("id"),
            reason=reason,
            desc_preview=(desc or "")[:80],
        )
        counters["rejected"] += 1
        current_retries = int(kill.get("retry_count") or 0)
        if current_retries >= 3:
            log.warn("analyzer_giving_up",
                     kill_id=kill.get("id"), retries=current_retries)
            safe_update(
                "kills",
                {"status": "manual_review", "retry_count": current_retries + 1},
                "id", kill["id"],
            )
        else:
            safe_update(
                "kills", {"retry_count": current_retries + 1},
                "id", kill["id"],
            )
        if job is not None:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                f"description_rejected: {reason}", 600, "desc_rejected",
            )
        return

    # Build the patch (legacy kills.* fields still need direct update for
    # the columns NOT mirrored by the trigger : status, kill_visible,
    # qc fields, pipeline version). The denormalised description /
    # tags / score columns are populated by the trigger from the
    # ai_annotations row we insert below.
    patch = _build_analysis_patch(result, kill)
    needs_reclip_due_to_drift = bool(patch.get("needs_reclip"))
    kill_visible_flag = bool(patch.get("kill_visible", True))
    qc_drift_sec = patch.get("ai_qc_drift_sec")

    if needs_reclip_due_to_drift:
        log.warn(
            "analyzer_qc_drift_detected",
            kill_id=kill["id"][:8],
            expected=int(kill.get("game_time_seconds") or 0),
            actual=patch.get("ai_qc_timer_sec"),
            drift=qc_drift_sec,
        )

    # ─── Write to ai_annotations (PR23-arch) ─────────────────────────
    # 1. archive any previous current row for this kill
    # 2. insert the new row with full provenance + cost + confidence
    # The DB trigger then back-fills kills.ai_description_*, ai_tags,
    # highlight_score, ai_thumbnail_timestamp_sec.
    _archive_previous_annotation(kill["id"])
    _insert_ai_annotation(kill, result, patch)

    # ─── Update the rest of the kills row directly ──────────────────
    # Strip fields that the trigger now writes — we still own status,
    # qc, pipeline version, kill_visible, caster_hype_level.
    trigger_owned = {
        "highlight_score", "ai_tags", "ai_description", "ai_description_fr",
        "ai_description_en", "ai_description_ko", "ai_description_es",
        "ai_thumbnail_timestamp_sec",
    }
    direct_patch = {k: v for k, v in patch.items() if k not in trigger_owned}
    if direct_patch:
        safe_update("kills", direct_patch, "id", kill["id"])

    try:
        from services.event_qc import (
            tick_qc_described, tick_qc_visible,
            tick_qc_clip_validated, fail_qc_clip_validated,
        )
        tick_qc_described(kill["id"])
        tick_qc_visible(kill["id"], kill_visible_flag)
        # PR14 : per-clip QC tick from the same Gemini call (no extra cost)
        if qc_drift_sec is not None:
            if needs_reclip_due_to_drift:
                fail_qc_clip_validated(kill["id"], reason=f"drift={qc_drift_sec}s")
            else:
                tick_qc_clip_validated(kill["id"])
    except Exception as _e:
        log.warn("event_qc_tick_failed",
                 kill_id=kill["id"][:8], stage="analyzed", error=str(_e)[:120])

    # ─── Queue handoff : ack + enqueue downstream jobs ─────────────
    # Inherit priority bracket from parent job so editorial / live work
    # keeps its lane through og + embedding + event.map.
    priority = 50
    if job is not None:
        try:
            priority = 70 if int(job.get("priority") or 50) >= 70 else 50
        except Exception:
            priority = 50
        await asyncio.to_thread(
            job_queue.succeed, job["id"],
            {"highlight_score": patch.get("highlight_score")},
        )

    # Always enqueue downstream — these modules are queue-driven now.
    # If the kill needs re-clip due to drift, we still enqueue these
    # since the OG/embedding work doesn't change with a re-clip and
    # the publisher will hold the kill back via needs_reclip.
    for next_type in ("og.generate", "embedding.compute", "event.map"):
        await asyncio.to_thread(
            job_queue.enqueue,
            next_type, "kill", kill["id"],
            None, priority, None, 3,
        )

    counters["analysed"] += 1


async def _gemini_consumer(out_q: "asyncio.Queue", n_producers: int,
                           counters: dict) -> None:
    sentinels_seen = 0
    while sentinels_seen < n_producers:
        item = await out_q.get()
        try:
            if item is SENTINEL:
                sentinels_seen += 1
                continue
            kill, clip_path = item
            remaining = scheduler.get_remaining("gemini")
            if remaining is not None and remaining <= 0:
                log.warn("analyzer_daily_quota_reached")
                _cleanup_clip(clip_path)
                # Push the queue job back to pending with a long retry
                # so we don't burn attempts on a drained quota. 2h gives
                # the daily reset (07:00 UTC) plenty of room.
                job = kill.get("_pipeline_job")
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "gemini_daily_quota_reached", 7200, "gemini_quota",
                    )
                # Drain any in-flight items from downloaders so they
                # can exit cleanly. Don't analyze them.
                continue
            try:
                await _process_one(kill, clip_path, counters)
            except Exception as e:
                log.error("analyzer_consumer_error",
                          kill_id=kill.get("id", "?")[:8], error=str(e)[:200])
                _cleanup_clip(clip_path)
                # Surface unexpected exception to the queue so the row
                # gets a retry. Without this, the lease eventually
                # expires (15 min) and gets re-claimed — slower path.
                job = kill.get("_pipeline_job")
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        f"analyzer_exception: {type(e).__name__}",
                        300, "analyzer_exception",
                    )
        finally:
            out_q.task_done()


async def _run_pipelined(kills: list[dict]) -> int:
    """Producer/consumer pipeline. See module-level run() for design notes."""
    in_q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    out_q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    counters = {"analysed": 0, "rejected": 0}

    log.info("analyzer_pipelined_start",
             kills=len(kills), workers=DOWNLOAD_WORKERS)

    producers = [
        asyncio.create_task(_download_worker(in_q, out_q),
                            name=f"analyzer_dl_{i}")
        for i in range(DOWNLOAD_WORKERS)
    ]
    consumer = asyncio.create_task(
        _gemini_consumer(out_q, DOWNLOAD_WORKERS, counters),
        name="analyzer_gemini_consumer",
    )

    # Feed the queue. The bound (QUEUE_MAX) provides natural backpressure
    # — if Gemini stalls, this loop blocks on put().
    for k in kills:
        await in_q.put(k)
    for _ in range(DOWNLOAD_WORKERS):
        await in_q.put(SENTINEL)

    await asyncio.gather(*producers)
    await consumer

    log.info("analyzer_scan_done",
             analysed=counters["analysed"], rejected=counters["rejected"],
             pipelined=True)
    return counters["analysed"]


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


# ─── Analysis patch builder ────────────────────────────────────────────
# Extracted from _process_one so reanalyze_backlog.py and the lab generator
# can build the same patch shape. The patch is the SUPERSET of fields
# updated on the kills row — the post-PR23 _process_one strips the
# trigger-owned subset (description / tags / score / thumbnail) before
# writing, but reanalyze_backlog.py wants the full patch returned to
# decide what to log.

def _build_analysis_patch(result: dict, kill: dict) -> dict:
    """Convert a Gemini result dict into a kills-row update patch.

    Includes the full set of fields (legacy denormalised + qc + status)
    so callers can either write it directly (legacy backfill scripts)
    or strip the trigger-owned subset (production analyzer path).
    """
    desc = result.get("description_fr")
    desc_en = (result.get("description_en") or "").strip() or None
    desc_ko = (result.get("description_ko") or "").strip() or None
    desc_es = (result.get("description_es") or "").strip() or None
    thumb_ts = _safe_int(result.get("best_thumbnail_timestamp_in_clip_sec"))
    kill_visible_flag = bool(result.get("kill_visible_on_screen", True))

    # Parse in-game timer from "MM:SS" format → compute drift vs expected
    qc_timer_sec: int | None = None
    qc_drift_sec: int | None = None
    timer_raw = (result.get("in_game_timer_at_clip_midpoint") or "").strip()
    if timer_raw and timer_raw.upper() != "NONE":
        m = re.match(r"(\d+):(\d+)", timer_raw)
        if m:
            qc_timer_sec = int(m.group(1)) * 60 + int(m.group(2))
            expected = int(kill.get("game_time_seconds") or 0)
            if expected > 0:
                qc_drift_sec = abs(qc_timer_sec - expected)

    needs_reclip_due_to_drift = (qc_drift_sec is not None and qc_drift_sec > 30)

    patch = {
        "highlight_score": _safe_float(result.get("highlight_score")),
        "ai_tags": result.get("tags") or [],
        "ai_description": desc,
        "ai_description_fr": desc,                       # canonical FR copy
        "ai_description_en": desc_en,
        "ai_description_ko": desc_ko,
        "ai_description_es": desc_es,
        "ai_thumbnail_timestamp_sec": thumb_ts,
        # Wave 27.8 / V42 — write to the new V42 column ONLY if migration
        # 058 has been applied. Until then, the column doesn't exist and
        # the entire safe_update PATCH would fail with PostgREST 42703,
        # leaving the kill stuck pre-'analyzed'. Detected via the env
        # gate KCKILLS_HAS_MIGRATION_058 so we can flip it the moment
        # the migration runs without redeploying. Once 058 is in prod
        # everywhere, drop the gate and write unconditionally.
        # (See hotfix f7e6318 for the matching frontend gate.)
        **(
            {"best_thumbnail_seconds": thumb_ts}
            if (
                os.getenv("KCKILLS_HAS_MIGRATION_058", "").strip().lower()
                in ("1", "true", "yes")
            )
            else {}
        ),
        "ai_qc_timer_sec": qc_timer_sec,
        "ai_qc_drift_sec": qc_drift_sec,
        "ai_pipeline_version": ANALYZER_PIPELINE_VERSION,
        "kill_visible": kill_visible_flag,
        "caster_hype_level": _safe_int(result.get("caster_hype_level")),
        "status": "analyzed",
    }
    if needs_reclip_due_to_drift:
        patch["needs_reclip"] = True
    return patch


# ─── ai_annotations writers (PR23-arch) ────────────────────────────────

def _lookup_current_asset(kill_id: str) -> tuple[str | None, int | None]:
    """Return (asset_id, version) of the current 'horizontal' or 'vertical'
    asset for this kill, or (None, None) if migration 026 isn't applied
    or no asset row exists. Either is acceptable — input_asset_id is
    nullable on ai_annotations.
    """
    db = get_db()
    if not db:
        return None, None
    try:
        # Prefer horizontal (it's what Gemini analyses by default — the
        # vertical is a crop). Fall back to vertical if horizontal is
        # missing (older kills).
        for asset_type in ("horizontal", "vertical"):
            rows = db.select(
                "kill_assets",
                columns="id,version",
                filters={"kill_id": kill_id, "type": asset_type, "is_current": "true"},
            )
            if rows:
                row = rows[0]
                return row.get("id"), row.get("version")
    except Exception as e:
        # Migration 026 may not yet be applied in some envs — that's fine,
        # input_asset_id is nullable.
        log.debug("ai_anno_asset_lookup_failed",
                  kill_id=kill_id[:8], error=str(e)[:120])
    return None, None


def _archive_previous_annotation(kill_id: str) -> None:
    """Flip any prior is_current=true annotations for this kill to false.

    Required because ai_annotations has a UNIQUE INDEX on (kill_id) WHERE
    is_current=true — inserting a new current row without first archiving
    the old one would violate the constraint.
    """
    from datetime import datetime, timezone
    db = get_db()
    if not db:
        return
    try:
        # PostgREST partial-eq update : flip is_current to false on the
        # current row(s) for this kill.
        import httpx as _httpx
        params = {
            "kill_id": f"eq.{kill_id}",
            "is_current": "eq.true",
        }
        body = {
            "is_current": False,
            "archived_at": datetime.now(timezone.utc).isoformat(),
        }
        r = _httpx.patch(
            f"{db.base}/ai_annotations",
            headers=db.headers,
            params=params,
            json=body,
            timeout=15.0,
        )
        # 200/204 = ok. 404/PGRST205 = table doesn't exist yet (mig 028
        # not applied) — that's fine, _insert_ai_annotation will also
        # silently no-op.
        if r.status_code >= 400 and r.status_code != 404:
            log.warn("ai_anno_archive_failed",
                     kill_id=kill_id[:8],
                     status=r.status_code, body=r.text[:200])
    except Exception as e:
        log.warn("ai_anno_archive_error",
                 kill_id=kill_id[:8], error=str(e)[:120])


def _insert_ai_annotation(kill: dict, result: dict, patch: dict) -> None:
    """Insert one ai_annotations row with full provenance + confidence + cost.

    Uses safe_insert so a Supabase outage falls through to the local
    SQLite cache and the row is replayed on flush. The DB trigger
    fn_sync_ai_annotation_to_kill takes care of back-filling
    kills.ai_description_*, ai_tags, highlight_score on insert.
    """
    model_name = result.get("_model") or config.GEMINI_MODEL_ANALYZER
    usage = result.get("_usage") or {}
    input_tok = _safe_int(usage.get("prompt_tokens"))
    output_tok = _safe_int(usage.get("candidates_tokens"))
    cost_usd = compute_gemini_cost(model_name, input_tok, output_tok)
    latency_ms = _safe_int(result.get("_latency_ms"))

    confidence = _safe_float(result.get("confidence_score"))
    if confidence is None:
        confidence = 0.5
    # Clamp to [0, 1] — we've seen models return >1 occasionally.
    confidence = max(0.0, min(1.0, confidence))

    asset_id, asset_version = _lookup_current_asset(kill["id"])

    raw_response = {
        "model": model_name,
        "usage": usage,
        # Truncated raw text for debugging — full payload would bloat
        # the DB. 4 KB is enough to see the structure of any malformed
        # reply.
        "text_preview": (result.get("_raw_text") or "")[:4000],
        # Echo the parsed values so audit can compare model output side-
        # by-side with the post-validation patch.
        "parsed": {
            "highlight_score": result.get("highlight_score"),
            "tags": result.get("tags"),
            "description_fr": result.get("description_fr"),
            "description_en": result.get("description_en"),
            "description_ko": result.get("description_ko"),
            "description_es": result.get("description_es"),
            "kill_visible_on_screen": result.get("kill_visible_on_screen"),
            "caster_hype_level": result.get("caster_hype_level"),
            "in_game_timer_at_clip_midpoint": result.get("in_game_timer_at_clip_midpoint"),
            "best_thumbnail_timestamp_in_clip_sec": result.get("best_thumbnail_timestamp_in_clip_sec"),
        },
    }

    row = {
        "kill_id": kill["id"],
        "model_provider": "gemini",
        "model_name": model_name,
        "prompt_version": ANALYZER_PROMPT_VERSION,
        "analysis_version": ANALYZER_PIPELINE_VERSION,
        "input_asset_id": asset_id,
        "input_asset_version": asset_version,
        "highlight_score": patch.get("highlight_score"),
        "ai_tags": patch.get("ai_tags") or [],
        "ai_description_fr": patch.get("ai_description_fr"),
        "ai_description_en": patch.get("ai_description_en"),
        "ai_description_ko": patch.get("ai_description_ko"),
        "ai_description_es": patch.get("ai_description_es"),
        "ai_thumbnail_timestamp_sec": patch.get("ai_thumbnail_timestamp_sec"),
        "confidence_score": confidence,
        "raw_response": raw_response,
        "input_tokens": input_tok,
        "output_tokens": output_tok,
        "cost_usd": cost_usd,
        "latency_ms": latency_ms,
        "is_current": True,
    }

    rec = safe_insert("ai_annotations", row)
    if rec:
        log.info(
            "ai_anno_inserted",
            kill_id=kill["id"][:8],
            model=model_name,
            confidence=round(confidence, 2),
            cost_usd=cost_usd,
            latency_ms=latency_ms,
        )
    else:
        log.warn("ai_anno_insert_failed_or_cached",
                 kill_id=kill["id"][:8], model=model_name)
