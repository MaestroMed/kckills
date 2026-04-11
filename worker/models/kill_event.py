"""Kill event dataclass with state machine."""

from dataclasses import dataclass, field
from datetime import datetime


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

    status: str = "raw"
    retry_count: int = 0
    data_source: str = "livestats"

    def to_db_dict(self) -> dict:
        return {
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
            "status": self.status,
            "data_source": self.data_source,
        }
