"""
DEDUP — Doublons exacts + collapse des séquences multi-kill.

Règles (spec docs/BACKFILL_DECRYPTAGE_SPEC_FOR_FABLE.md §6) :

  1. DOUBLONS EXACTS — même (event_epoch, victim_champion) dans une game
     (epoch > 0), ou clé floue (victim_champion, game_time ±10 s) pour les
     backfills gol.gg à epoch=0. Un seul keeper par groupe : le plus
     avancé dans le pipeline, puis URLs présentes, puis player mappé,
     puis le plus ancien. Le SQL 089 traite le cas epoch>0 en masse ;
     ce module traite TOUT (dont epoch=0) et produit un plan idempotent.

  2. SÉQUENCES MULTI-KILL — même killer, morts consécutives espacées de
     ≤ 12 s : un quadra est AUSSI un triple et un double. On garde UN
     kill canonique (tier max, dernier de la séquence à tier égal — c'est
     lui que l'annonceur consacre), les sous-paliers deviennent des
     métadonnées (absorbed) : status='duplicate' + is_duplicate_of.
     Si aucun row n'est étiqueté multi_kill mais que la séquence compte
     N morts, le tier est INFÉRÉ (N capé à 5) et proposé en correction
     du label du canonique.

  JAMAIS de DELETE : les kill_assets / fichiers R2 des absorbés restent
  référencés (piège mémoire R2 GC). Neutralisation uniquement.

Ce module est PUR (pas d'accès DB) pour être testable — l'application
du plan (writes) vit dans scripts/backfill_au_crible.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

MULTIKILL_TIER = {None: 1, "": 1, "single": 1, "double": 2,
                  "triple": 3, "quadra": 4, "penta": 5}
TIER_LABEL = {1: None, 2: "double", 3: "triple", 4: "quadra", 5: "penta"}

SEQUENCE_GAP_SECONDS = 12       # écart max entre 2 morts d'une séquence
FUZZY_GT_TOLERANCE = 10         # clé floue epoch=0 : bucket de game_time

STATUS_RANK = {
    "published": 0, "analyzed": 1, "clipped": 2, "clipping": 3,
    "vod_found": 4, "enriched": 5, "raw": 6, "needs_review": 7,
    "clip_error": 8, "manual_review": 9, "duplicate": 99,
}


@dataclass
class DedupAction:
    kill_id: str
    action: str                     # 'keep' | 'duplicate'
    duplicate_of: Optional[str] = None
    reason: str = ""                # 'exact_dup' | 'exact_dup_fuzzy' | 'subtier'


@dataclass
class SequenceInfo:
    canonical_kill_id: str
    absorbed_kill_ids: list[str]
    tier: int
    inferred_label: Optional[str]   # correction proposée du multi_kill
    sequence_start_epoch: Optional[int]
    sequence_end_epoch: Optional[int]
    killer_key: str


@dataclass
class DedupPlan:
    actions: list[DedupAction] = field(default_factory=list)
    sequences: list[SequenceInfo] = field(default_factory=list)

    @property
    def duplicates(self) -> list[DedupAction]:
        return [a for a in self.actions if a.action == "duplicate"]

    def keeper_of(self, kill_id: str) -> Optional[str]:
        for a in self.actions:
            if a.kill_id == kill_id and a.action == "duplicate":
                return a.duplicate_of
        return None


def _keeper_sort_key(k: dict):
    return (
        STATUS_RANK.get(k.get("status"), 50),
        -MULTIKILL_TIER.get(k.get("multi_kill"), 1),  # garder le label le + haut
        k.get("clip_url_vertical") is None,
        k.get("killer_player_id") is None,
        k.get("highlight_score") is None,
        k.get("created_at") or "",
        k.get("id") or "",
    )


def _tier(k: dict) -> int:
    return MULTIKILL_TIER.get(k.get("multi_kill"), 1)


def _epoch_s(k: dict) -> Optional[float]:
    """event_epoch en secondes (la DB stocke des millisecondes pour les
    kills livestats). 0/None → None (utiliser game_time_seconds)."""
    e = k.get("event_epoch")
    if not e:
        return None
    return e / 1000.0 if e > 10_000_000_000 else float(e)


def _time_of(k: dict) -> Optional[float]:
    return _epoch_s(k) if _epoch_s(k) is not None else (
        float(k["game_time_seconds"]) if k.get("game_time_seconds") is not None else None
    )


# ─── 1. Doublons exacts ───────────────────────────────────────────────

def find_exact_duplicates(kills: list[dict]) -> list[list[dict]]:
    """Groupes de doublons du même événement dans UNE game.

    epoch > 0  → clé stricte (event_epoch, victim_champion)
    epoch == 0 → clé floue (victim_champion, killer_champion) + clustering
                 des game_time à ±FUZZY_GT_TOLERANCE s.
    """
    groups: list[list[dict]] = []

    strict: dict[tuple, list[dict]] = {}
    fuzzy_pool: list[dict] = []
    for k in kills:
        if k.get("status") == "duplicate":
            continue
        if k.get("event_epoch") and k["event_epoch"] > 0:
            strict.setdefault(
                (k["event_epoch"], k.get("victim_champion")), []
            ).append(k)
        else:
            fuzzy_pool.append(k)

    groups.extend(g for g in strict.values() if len(g) > 1)

    # Clé floue : même (killer, victim) et game_time proches
    by_pair: dict[tuple, list[dict]] = {}
    for k in fuzzy_pool:
        by_pair.setdefault(
            (k.get("killer_champion"), k.get("victim_champion")), []
        ).append(k)
    for pool in by_pair.values():
        pool = [k for k in pool if k.get("game_time_seconds") is not None]
        pool.sort(key=lambda k: k["game_time_seconds"])
        cluster: list[dict] = []
        for k in pool:
            if cluster and (k["game_time_seconds"] - cluster[-1]["game_time_seconds"]
                            <= FUZZY_GT_TOLERANCE):
                cluster.append(k)
            else:
                if len(cluster) > 1:
                    groups.append(cluster)
                cluster = [k]
        if len(cluster) > 1:
            groups.append(cluster)
    return groups


# ─── 2. Séquences multi-kill ──────────────────────────────────────────

def find_multikill_sequences(kills: list[dict]) -> list[list[dict]]:
    """Séquences (même killer, morts consécutives ≤ SEQUENCE_GAP_SECONDS)
    d'au moins 2 kills, parmi les kills NON-duplicate d'une game."""
    by_killer: dict[str, list[dict]] = {}
    for k in kills:
        if k.get("status") == "duplicate":
            continue
        if _time_of(k) is None:
            continue
        key = k.get("killer_player_id") or f"champ:{k.get('killer_champion')}"
        if key in (None, "champ:None"):
            continue
        by_killer.setdefault(key, []).append(k)

    sequences: list[list[dict]] = []
    for ks in by_killer.values():
        ks.sort(key=lambda k: _time_of(k))
        seq = [ks[0]]
        for k in ks[1:]:
            if _time_of(k) - _time_of(seq[-1]) <= SEQUENCE_GAP_SECONDS:
                seq.append(k)
            else:
                if len(seq) > 1:
                    sequences.append(seq)
                seq = [k]
        if len(seq) > 1:
            sequences.append(seq)
    return sequences


def collapse_sequence(seq: list[dict]) -> SequenceInfo:
    """Choisit le canonique d'une séquence multi-kill.

    Canonique = tier étiqueté max ; à égalité le DERNIER de la séquence
    (le kill que l'annonceur consacre « QUADRA KILL »), départagé par
    l'avancement pipeline. Tier inféré = max(tier étiqueté, taille de la
    séquence) capé à 5 — corrige les séquences jamais étiquetées.
    """
    seq_sorted = sorted(seq, key=lambda k: _time_of(k))
    max_tier = max(_tier(k) for k in seq_sorted)
    candidates = [k for k in seq_sorted if _tier(k) == max_tier]
    # le plus avancé dans le pipeline d'abord (garder un published) ;
    # à statut égal, le DERNIER de la séquence (le kill que l'annonceur
    # consacre « QUADRA KILL » — son clip couvre toute la séquence)
    candidates.sort(key=lambda k: (
        STATUS_RANK.get(k.get("status"), 50),
        k.get("clip_url_vertical") is None,
        -(_time_of(k) or 0.0),
    ))
    canonical = candidates[0]

    inferred_tier = min(5, max(max_tier, len(seq_sorted)))
    epochs = [k.get("event_epoch") for k in seq_sorted
              if k.get("event_epoch") and k["event_epoch"] > 0]
    return SequenceInfo(
        canonical_kill_id=canonical["id"],
        absorbed_kill_ids=[k["id"] for k in seq_sorted if k["id"] != canonical["id"]],
        tier=inferred_tier,
        inferred_label=TIER_LABEL.get(inferred_tier)
        if inferred_tier > _tier(canonical) else None,
        sequence_start_epoch=min(epochs) if epochs else None,
        sequence_end_epoch=max(epochs) if epochs else None,
        killer_key=canonical.get("killer_player_id")
        or f"champ:{canonical.get('killer_champion')}",
    )


# ─── 3. Plan complet pour une game ────────────────────────────────────

def build_dedup_plan(kills: list[dict]) -> DedupPlan:
    """Plan de dédup d'une game : doublons exacts PUIS collapse multi-kill
    sur les survivants. Idempotent : les kills déjà status='duplicate'
    sont ignorés, les actions re-calculées donnent le même keeper
    (tri déterministe)."""
    plan = DedupPlan()
    neutralized: set[str] = set()

    # Phase 1 — doublons exacts
    for group in find_exact_duplicates(kills):
        group_sorted = sorted(group, key=_keeper_sort_key)
        keeper = group_sorted[0]
        reason = ("exact_dup" if keeper.get("event_epoch") else "exact_dup_fuzzy")
        plan.actions.append(DedupAction(keeper["id"], "keep"))
        for k in group_sorted[1:]:
            plan.actions.append(DedupAction(
                k["id"], "duplicate", duplicate_of=keeper["id"], reason=reason))
            neutralized.add(k["id"])

    # Phase 2 — séquences multi-kill sur les survivants
    survivors = [k for k in kills
                 if k["id"] not in neutralized and k.get("status") != "duplicate"]
    for seq in find_multikill_sequences(survivors):
        info = collapse_sequence(seq)
        plan.sequences.append(info)
        for kid in info.absorbed_kill_ids:
            plan.actions.append(DedupAction(
                kid, "duplicate", duplicate_of=info.canonical_kill_id,
                reason="subtier"))
            neutralized.add(kid)

    return plan
