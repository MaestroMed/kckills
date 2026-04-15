"""Moment event — a coherent chunk of action grouping N kills.

A moment is the atomic unit of the LoLTok feed. Instead of showing
individual kills (which produces near-identical clips for teamfights),
we group kills within a 30-second window into a single MOMENT.

Classifications:
  solo_kill       — 1 kill, 1-2 participants
  skirmish        — 2-3 kills, up to 6 participants
  teamfight       — 4+ kills or 7+ participants
  ace             — 5 deaths on one side in the moment
  objective_fight — significant gold swing (Baron/Dragon) with kills
"""

from __future__ import annotations

from dataclasses import dataclass, field
from models.kill_event import KillEvent


# ─── Classification constants ───────────────────────────────────────────

CLASSIFICATIONS = [
    "solo_kill",
    "skirmish",
    "teamfight",
    "ace",
    "objective_fight",
]

KC_INVOLVEMENTS = [
    "kc_aggressor",   # KC got more kills than deaths in this moment
    "kc_victim",      # KC died more than they killed
    "kc_both",        # KC both killed and died (trade / messy fight)
    "kc_none",        # KC not involved (shouldn't happen with KC filter)
]

# ─── Clip timing config ─────────────────────────────────────────────────

PAD_BEFORE = 15   # seconds before first kill
PAD_AFTER = 10    # seconds after last kill
MIN_DURATION = 20  # minimum clip duration
MAX_DURATION = 60  # maximum clip duration


def classify_moment(
    kills: list[KillEvent],
    gold_swing: int = 0,
    start_time_seconds: int = 0,
) -> str:
    """Classify a group of kills into a moment type."""
    n_kills = len(kills)

    # Collect unique participants (killers + victims)
    participants = set()
    blue_deaths = 0
    red_deaths = 0
    for k in kills:
        if k.killer_participant_id:
            participants.add(k.killer_participant_id)
        if k.victim_participant_id:
            participants.add(k.victim_participant_id)
        if k.victim_side == "blue":
            blue_deaths += 1
        elif k.victim_side == "red":
            red_deaths += 1

    n_participants = len(participants)

    # Ace: 5 deaths on one side
    if blue_deaths >= 5 or red_deaths >= 5:
        return "ace"

    # Objective fight: big gold swing in mid/late game with kills
    if abs(gold_swing) > 4000 and start_time_seconds > 1200 and n_kills >= 2:
        return "objective_fight"

    # Teamfight: many kills or many participants
    if n_kills >= 4 or n_participants >= 7:
        return "teamfight"

    # Skirmish: moderate action
    if n_kills >= 2:
        return "skirmish"

    # Solo kill
    return "solo_kill"


def compute_moment_score(
    kills: list[KillEvent],
    classification: str,
    kc_involvement: str,
    gold_swing: int = 0,
) -> float:
    """Compute aggregate hype score for a moment. Returns 1.0-10.0."""
    # Sum individual kill hype scores
    raw = sum(k.hype_score() for k in kills)

    # Classification bonuses
    bonuses = {
        "ace": 30,
        "objective_fight": 20,
        "teamfight": 10,
        "skirmish": 5,
        "solo_kill": 0,
    }
    raw += bonuses.get(classification, 0)

    # First blood in the moment
    if any(k.is_first_blood for k in kills):
        raw += 10

    # Big gold swing bonus
    if abs(gold_swing) > 3000:
        raw += 10

    # KC involvement modifier
    if kc_involvement == "kc_victim":
        raw *= 0.5
    elif kc_involvement == "kc_aggressor":
        raw *= 1.2

    # Normalize: divide by expected range and clamp
    # A solo kill scores ~10 raw, a penta ace ~200+
    # Target: solo_kill ~ 3-5, teamfight ~ 5-7, ace/penta ~ 8-10
    normalized = raw / 20.0
    return max(1.0, min(10.0, round(normalized, 1)))


@dataclass
class MomentEvent:
    """A coherent moment of action grouping N kills."""

    game_id: str
    kills: list[KillEvent] = field(default_factory=list)

    # Time window (game-relative seconds)
    start_time_seconds: int = 0
    end_time_seconds: int = 0

    # Classification
    classification: str = "solo_kill"

    # Team stats
    blue_kills: int = 0
    red_kills: int = 0
    winning_side: str | None = None
    kc_involvement: str = "kc_none"
    participants_involved: int = 0

    # Economy
    gold_swing: int = 0

    # Scoring
    moment_score: float = 5.0

    # Clip timing (computed)
    clip_start_seconds: int = 0
    clip_end_seconds: int = 0
    clip_duration: int = 20

    # State
    status: str = "raw"
    data_source: str = "livestats"

    # Epoch for VOD alignment
    first_kill_epoch: int = 0
    last_kill_epoch: int = 0

    @staticmethod
    def from_kills(
        kills: list[KillEvent],
        gold_snapshots: dict[int, dict[str, int]] | None = None,
        kc_side: str | None = None,
    ) -> "MomentEvent":
        """Build a MomentEvent from a list of temporally-close kills."""
        if not kills:
            raise ValueError("Cannot create moment from empty kill list")

        game_id = kills[0].game_id
        sorted_kills = sorted(kills, key=lambda k: k.game_time_seconds or 0)

        start_t = sorted_kills[0].game_time_seconds or 0
        end_t = sorted_kills[-1].game_time_seconds or 0

        # Count kills per side
        blue_kills = sum(1 for k in kills if k.killer_side == "blue")
        red_kills = sum(1 for k in kills if k.killer_side == "red")

        # Winning side
        if blue_kills > red_kills:
            winning_side = "blue"
        elif red_kills > blue_kills:
            winning_side = "red"
        else:
            winning_side = None

        # KC involvement
        kc_kills_count = sum(
            1 for k in kills
            if k.tracked_team_involvement == "team_killer"
        )
        kc_deaths_count = sum(
            1 for k in kills
            if k.tracked_team_involvement == "team_victim"
        )
        if kc_kills_count > 0 and kc_deaths_count > 0:
            kc_involvement = "kc_both"
        elif kc_kills_count > 0:
            kc_involvement = "kc_aggressor"
        elif kc_deaths_count > 0:
            kc_involvement = "kc_victim"
        else:
            kc_involvement = "kc_none"

        # Unique participants
        participants = set()
        for k in kills:
            if k.killer_participant_id:
                participants.add(k.killer_participant_id)
            if k.victim_participant_id:
                participants.add(k.victim_participant_id)

        # Gold swing from snapshots
        gold_swing = 0
        if gold_snapshots:
            # Find closest snapshots to start and end
            snap_times = sorted(gold_snapshots.keys())
            start_snap = _closest(snap_times, start_t)
            end_snap = _closest(snap_times, end_t)
            if start_snap is not None and end_snap is not None:
                sg = gold_snapshots[start_snap]
                eg = gold_snapshots[end_snap]
                # Gold swing = change in gold difference
                start_diff = sg.get("blue", 0) - sg.get("red", 0)
                end_diff = eg.get("blue", 0) - eg.get("red", 0)
                gold_swing = end_diff - start_diff

        # Classification
        classification = classify_moment(kills, gold_swing, start_t)

        # Score
        moment_score = compute_moment_score(
            kills, classification, kc_involvement, gold_swing,
        )

        # Clip timing: variable based on moment duration
        clip_start = max(0, start_t - PAD_BEFORE)
        clip_end = end_t + PAD_AFTER
        clip_duration = clip_end - clip_start
        # Clamp duration
        if clip_duration < MIN_DURATION:
            # Extend symmetrically
            extra = MIN_DURATION - clip_duration
            clip_start = max(0, clip_start - extra // 2)
            clip_end = clip_start + MIN_DURATION
            clip_duration = MIN_DURATION
        elif clip_duration > MAX_DURATION:
            # Trim: keep PAD_BEFORE before first kill, cap total
            clip_end = clip_start + MAX_DURATION
            clip_duration = MAX_DURATION

        return MomentEvent(
            game_id=game_id,
            kills=sorted_kills,
            start_time_seconds=start_t,
            end_time_seconds=end_t,
            classification=classification,
            blue_kills=blue_kills,
            red_kills=red_kills,
            winning_side=winning_side,
            kc_involvement=kc_involvement,
            participants_involved=len(participants),
            gold_swing=gold_swing,
            moment_score=moment_score,
            clip_start_seconds=clip_start,
            clip_end_seconds=clip_end,
            clip_duration=clip_duration,
            first_kill_epoch=sorted_kills[0].event_epoch,
            last_kill_epoch=sorted_kills[-1].event_epoch,
        )

    @property
    def kill_count(self) -> int:
        return len(self.kills)

    @property
    def has_first_blood(self) -> bool:
        return any(k.is_first_blood for k in self.kills)

    @property
    def best_multi_kill(self) -> str | None:
        """Return the highest multi-kill in this moment."""
        order = {"penta": 5, "quadra": 4, "triple": 3, "double": 2}
        best = None
        best_val = 0
        for k in self.kills:
            if k.multi_kill and order.get(k.multi_kill, 0) > best_val:
                best = k.multi_kill
                best_val = order[k.multi_kill]
        return best

    @property
    def killer_champions(self) -> list[str]:
        """Unique killer champions in this moment."""
        seen = set()
        result = []
        for k in self.kills:
            if k.killer_champion and k.killer_champion not in seen:
                seen.add(k.killer_champion)
                result.append(k.killer_champion)
        return result

    @property
    def victim_champions(self) -> list[str]:
        """Unique victim champions in this moment."""
        seen = set()
        result = []
        for k in self.kills:
            if k.victim_champion and k.victim_champion not in seen:
                seen.add(k.victim_champion)
                result.append(k.victim_champion)
        return result

    def summary_line(self) -> str:
        """One-line summary for logging/Discord."""
        killers = ", ".join(self.killer_champions[:3])
        victims = ", ".join(self.victim_champions[:3])
        duration = self.end_time_seconds - self.start_time_seconds
        gt = self.start_time_seconds
        return (
            f"[{self.classification.upper()}] {self.kill_count} kills "
            f"@ {gt // 60}:{gt % 60:02d} ({duration}s) | "
            f"{killers} > {victims} | {self.kc_involvement} | "
            f"score={self.moment_score}"
        )

    def to_db_dict(self) -> dict:
        """Serialize for Supabase moments table insert."""
        return {
            "game_id": self.game_id,
            "start_time_seconds": self.start_time_seconds,
            "end_time_seconds": self.end_time_seconds,
            "classification": self.classification,
            "blue_kills": self.blue_kills,
            "red_kills": self.red_kills,
            "winning_side": self.winning_side,
            "kc_involvement": self.kc_involvement,
            "kill_count": self.kill_count,
            "participants_involved": self.participants_involved,
            "gold_swing": self.gold_swing,
            "moment_score": self.moment_score,
            "status": self.status,
        }


def _closest(sorted_keys: list[int], target: int) -> int | None:
    """Find the closest value in a sorted list to the target."""
    if not sorted_keys:
        return None
    best = sorted_keys[0]
    best_dist = abs(best - target)
    for k in sorted_keys:
        d = abs(k - target)
        if d < best_dist:
            best = k
            best_dist = d
        elif d > best_dist:
            break  # sorted, so no point continuing
    return best


def group_kills_into_moments(
    kills: list[KillEvent],
    gold_snapshots: dict[int, dict[str, int]] | None = None,
    kc_side: str | None = None,
    window_seconds: int = 30,
) -> list[MomentEvent]:
    """Group a list of kills into moments using a sliding time window.

    Kills within `window_seconds` of each other belong to the same moment.
    The window is relative to the LAST kill in the current cluster (chaining).
    """
    if not kills:
        return []

    sorted_kills = sorted(kills, key=lambda k: k.game_time_seconds or 0)
    moments: list[MomentEvent] = []

    current_cluster: list[KillEvent] = [sorted_kills[0]]

    for kill in sorted_kills[1:]:
        last_time = current_cluster[-1].game_time_seconds or 0
        this_time = kill.game_time_seconds or 0

        if this_time - last_time <= window_seconds:
            current_cluster.append(kill)
        else:
            # Finalize current moment
            moments.append(
                MomentEvent.from_kills(current_cluster, gold_snapshots, kc_side)
            )
            current_cluster = [kill]

    # Don't forget the last cluster
    if current_cluster:
        moments.append(
            MomentEvent.from_kills(current_cluster, gold_snapshots, kc_side)
        )

    return moments
