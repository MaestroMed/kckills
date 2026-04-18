"use client";

/**
 * useFeedPlayer — pool allocation strategy for the TikTok-native feed.
 *
 * Holds 5 logical "slots", each backed by a real <video> element rendered
 * once at the FeedPlayerPool component. As the active feed index changes,
 * this hook decides which slot covers which item index.
 *
 * Slot layout around the active item N:
 *
 *     [N-1]   [N]    [N+1]   [N+2]   [N-2 spare]
 *     warm    LIVE   warm    cold    cold-recyclable
 *
 *     - Slot 0 (LIVE)  : item N — playing
 *     - Slot 1 (warm)  : item N+1 — preload=auto, ready to play instantly on swipe up
 *     - Slot 2 (warm)  : item N-1 — already played, kept for swipe-back fluidity
 *     - Slot 3 (cold)  : item N+2 — preload=metadata only
 *     - Slot 4 (cold)  : the spare. Sits on item N-2 by default but free to be
 *                       reassigned mid-flick (e.g. fast skip-2).
 *
 * Why 5 not 4 ? Because during a fast flick (vy > FAST_FLICK_VELOCITY) we
 * advance by 2 in one gesture — without slot 4 we'd hit the cold path and
 * see the poster figé for ~200ms.
 *
 * Allocation is STABLE: a slot stays bound to its item while the item is
 * within range. Crossing the range bounds reassigns slots in O(1).
 *
 * The hook returns:
 *   - assignments: Map<itemIndex, slotIndex>  — which slot owns each item
 *   - slotForItem(idx): slotIndex | null      — null = not in pool
 *   - getSlotPriority(slot): "live"|"warm"|"cold"  — drives preload/play
 */

import { useEffect, useMemo, useRef, useState } from "react";

export const POOL_SIZE = 5;

export type SlotPriority = "live" | "warm" | "cold";

interface PlayerPoolState {
  /** itemIndex → slotIndex. Stable for items in range, missing if out. */
  assignments: Map<number, number>;
  /** slotIndex → itemIndex (reverse map). -1 means slot is unassigned. */
  slotItemIndex: number[];
  /** What priority each slot currently has. */
  priorities: SlotPriority[];
}

/** Build the desired item set for a given active index. Order matters
 *  because we re-use slots in this order when assignments shift. */
function desiredItemsForActive(active: number, total: number): {
  itemIndex: number;
  priority: SlotPriority;
}[] {
  const candidates = [
    { itemIndex: active, priority: "live" as SlotPriority },
    { itemIndex: active + 1, priority: "warm" as SlotPriority },
    { itemIndex: active - 1, priority: "warm" as SlotPriority },
    { itemIndex: active + 2, priority: "cold" as SlotPriority },
    { itemIndex: active - 2, priority: "cold" as SlotPriority },
  ];
  return candidates.filter((c) => c.itemIndex >= 0 && c.itemIndex < total);
}

export function useFeedPlayer({
  activeIndex,
  totalItems,
}: {
  activeIndex: number;
  totalItems: number;
}): PlayerPoolState & {
  slotForItem: (itemIndex: number) => number | null;
  getSlotPriority: (slot: number) => SlotPriority;
} {
  // Underlying state — slot[i] = itemIndex it's bound to (-1 = unassigned).
  // We seed with all -1 and let the effect below populate on first render.
  const [slotItemIndex, setSlotItemIndex] = useState<number[]>(() =>
    Array.from({ length: POOL_SIZE }, () => -1),
  );
  const [priorities, setPriorities] = useState<SlotPriority[]>(() =>
    Array.from({ length: POOL_SIZE }, () => "cold" as SlotPriority),
  );

  /** We keep a ref alongside state so the allocation algorithm can read
   *  the latest values without depending on stale closure values. */
  const slotItemIndexRef = useRef(slotItemIndex);
  slotItemIndexRef.current = slotItemIndex;

  useEffect(() => {
    if (totalItems === 0) return;
    const desired = desiredItemsForActive(activeIndex, totalItems);
    const desiredSet = new Set(desired.map((d) => d.itemIndex));
    const prevSlots = [...slotItemIndexRef.current];
    const newSlots = [...prevSlots];
    const newPriorities = Array.from({ length: POOL_SIZE }, () => "cold" as SlotPriority);

    // 1. Find which existing slot bindings we can KEEP (item still desired).
    const keptItems = new Set<number>();
    for (let s = 0; s < POOL_SIZE; s++) {
      if (newSlots[s] !== -1 && desiredSet.has(newSlots[s])) {
        keptItems.add(newSlots[s]);
      } else {
        newSlots[s] = -1; // free this slot
      }
    }

    // 2. For each desired item not yet bound, find a free slot.
    for (const d of desired) {
      if (keptItems.has(d.itemIndex)) continue;
      const freeSlot = newSlots.indexOf(-1);
      if (freeSlot === -1) break; // shouldn't happen with 5 slots + max 5 desired
      newSlots[freeSlot] = d.itemIndex;
    }

    // 3. Fill priority lookup from the desired list.
    for (const d of desired) {
      const slot = newSlots.indexOf(d.itemIndex);
      if (slot !== -1) newPriorities[slot] = d.priority;
    }

    // 4. Skip update if nothing changed (avoid unnecessary re-renders).
    const changed =
      prevSlots.some((v, i) => v !== newSlots[i]) ||
      priorities.some((p, i) => p !== newPriorities[i]);
    if (changed) {
      setSlotItemIndex(newSlots);
      setPriorities(newPriorities);
    }
  }, [activeIndex, totalItems, priorities]);

  const assignments = useMemo(() => {
    const m = new Map<number, number>();
    slotItemIndex.forEach((itemIdx, slot) => {
      if (itemIdx !== -1) m.set(itemIdx, slot);
    });
    return m;
  }, [slotItemIndex]);

  const slotForItem = (itemIndex: number) => assignments.get(itemIndex) ?? null;
  const getSlotPriority = (slot: number) => priorities[slot] ?? "cold";

  return { assignments, slotItemIndex, priorities, slotForItem, getSlotPriority };
}
