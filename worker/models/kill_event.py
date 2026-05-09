"""Kill event dataclass with state machine and structured hype scoring."""

from dataclasses import dataclass, field


STATUSES = [
    "raw",          # kill detected from frame diff
    "enriched",     # mapped killer/victim with confidence
    "vod_found",    # VOD URL + offset known
    "clipping",     # ffmpeg processing
    "clipped",      # clips uploaded to R2
    "analyzed",     # Gemini analysis done
    "published",    # visible on the site
    "clip_error",   # clipping failed
    "manual_review",  # needs human check
]


# ─── Structured hype scoring (audit v2 blueprint ν3) ────────────────────
#
# Replaces the subjective Gemini-only score with a data-driven base score.
# Gemini can still adjust it, but the base is deterministic and consistent.

MULTI_KILL_SCORES = {
    "penta": 100,
    "quadra": 80,
    "triple": 60,
    "double": 40,
}
SINGLE_KILL_BASE = 10


def compute_hype_score(
    multi_kill: str | None = None,
    is_first_blood: bool = False,
    shutdown_bounty: int = 0,
    game_time_seconds: int | None = None,
    tracked_team_involvement: str | None = None,
    confidence: str = "high",
) -> float:
    """Compute a structured hype score from kill metadata.

    Returns a float in the 1.0-10.0 range. This is the BASE score before
    any Gemini analysis — deterministic, consistent, and fast.
    """
    raw = MULTI_KILL_SCORES.get(multi_kill or "", SINGLE_KILL_BASE)

    # First blood
    if is_first_blood:
        raw += 10

    # Shutdown bounty (big shutdown = impressive kill)
    if shutdown_bounty >= 700:
        raw += 20
    elif shutdown_bounty >= 400:
        raw += 10

    # Game phase — late game kills are higher stakes
    gt = game_time_seconds or 0
    if gt > 25 * 60:
        raw += 10
    elif gt > 14 * 60:
        raw += 5

    # KC as killer is the hero content; KC as victim is less exciting
    if tracked_team_involvement == "team_victim":
        raw -= 10

    # Low-confidence kills are less reliable
    if confidence in ("low", "estimated"):
        raw -= 5

    # Normalize to 1.0-10.0
    return max(1.0, min(10.0, raw / 12.0))


@dataclass
class KillEvent:
    game_id: str
    event_epoch: int  # UTC epoch ms from livestats frame
    game_time_seconds: int | None = None

    killer_participant_id: str | None = None
    killer_name: str | None = None
    killer_champion: str | None = None
    killer_side: str | None = None

    victim_participant_id: str | None = None
    victim_name: str | None = None
    victim_champion: str | None = None
    victim_side: str | None = None

    assistants: list[dict] = field(default_factory=list)

    confidence: str = "high"  # high, medium, low, estimated
    tracked_team_involvement: str | None = None  # team_killer, team_victim, team_assist

    is_first_blood: bool = False
    multi_kill: str | None = None  # double, triple, quadra, penta
    shutdown_bounty: int = 0
    # Wave 27.18 — fight_type computed at insertion time (was previously
    # only set by the post-hoc backfill_assists.py script). Values mirror
    # the script's classify_fight() : solo_kill / pick / gank /
    # skirmish_2v2 / skirmish_3v3 / teamfight_4v4 / teamfight_5v5.
    fight_type: str | None = None

    status: str = "raw"
    retry_count: int = 0
    data_source: str = "livestats"

    def hype_score(self) -> float:
        return compute_hype_score(
            multi_kill=self.multi_kill,
            is_first_blood=self.is_first_blood,
            shutdown_bounty=self.shutdown_bounty,
            game_time_seconds=self.game_time_seconds,
            tracked_team_involvement=self.tracked_team_involvement,
            confidence=self.confidence,
        )

    def to_db_dict(self) -> dict:
        d = {
            "game_id": self.game_id,
            "event_epoch": self.event_epoch,
            "game_time_seconds": self.game_time_seconds,
            "killer_champion": self.killer_champion,
            "victim_champion": self.victim_champion,
            "assistants": self.assistants,
            "confidence": self.confidence,
            "tracked_team_involvement": self.tracked_team_involvement,
            "is_first_blood": self.is_first_blood,
            "multi_kill": self.multi_kill,
            "shutdown_bounty": self.shutdown_bounty,
            "highlight_score": self.hype_score(),
            "status": self.status,
            "data_source": self.data_source,
        }
        # Wave 27.18 — only emit fight_type when the harvester has
        # computed it ; NULL falls through to the post-hoc
        # backfill_assists.py classifier without overwriting a manual
        # admin-set value.
        if self.fight_type is not None:
            d["fight_type"] = self.fight_type
        return d
