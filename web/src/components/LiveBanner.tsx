"use client";

import { useState, useEffect } from "react";

export function LiveBanner() {
  const [isLive, setIsLive] = useState(false);
  const [opponent, setOpponent] = useState("");

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(
          "https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US",
          { headers: { "x-api-key": "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z" } }
        );
        const data = await r.json();
        const events = data?.data?.schedule?.events ?? [];
        for (const event of events) {
          const teams = event?.match?.teams ?? [];
          const isKc = teams.some(
            (t: { code: string }) => t.code === "KC"
          );
          if (isKc && event.state === "inProgress") {
            setIsLive(true);
            const opp = teams.find((t: { code: string }) => t.code !== "KC");
            setOpponent(opp?.code ?? "");
            return;
          }
        }
        setIsLive(false);
      } catch {
        // silently fail
      }
    };

    check();
    const interval = setInterval(check, 120_000); // poll every 2 min
    return () => clearInterval(interval);
  }, []);

  if (!isLive) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 bg-[var(--red)] px-4 py-1.5 text-center text-sm font-bold text-white animate-pulse">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      KC EN LIVE {opponent && `vs ${opponent}`}
    </div>
  );
}
