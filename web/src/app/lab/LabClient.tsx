"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { BannerHandle } from "@/components/banner/banner-engine";
import { MOODS, WEATHER, forcedWeather, isMood, type Mood, type MoodWeather } from "@/lib/mood/presets";
import { emitStrike, emitSweep } from "@/lib/mood/sky";
import { fetchMoodWeather } from "@/lib/mood/use-mood-weather";
import { LogoLab } from "./LogoLab";

const KCBanner = dynamic(() => import("@/components/banner/KCBanner"), { ssr: false });

export function LabClient() {
  const [wind, setWind] = useState(2.3);
  const [big, setBig] = useState<BannerHandle | null>(null);
  // Météo calculée (forme de la KC) et temps forcé pour l'aperçu.
  const [computed, setComputed] = useState<MoodWeather | null>(null);
  const [forced, setForced] = useState<Mood | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mood");
    if (isMood(q)) {
      setForced(q);
      setWind(WEATHER[q].wind);
    }
    let alive = true;
    void fetchMoodWeather().then((w) => {
      if (!alive) return;
      setComputed(w);
      if (!isMood(q)) setWind(w.wind);
    });
    return () => {
      alive = false;
    };
  }, []);
  const weather = useMemo(() => (forced ? forcedWeather(forced) : computed), [forced, computed]);
  const pick = (m: Mood | null) => {
    setForced(m);
    setWind(m ? WEATHER[m].wind : (computed?.wind ?? 2.3));
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70">Labo · hors index</p>
      <h1 className="mt-2 font-display text-4xl font-black text-[var(--gold-bright)] md:text-5xl">Étendards</h1>
      <p className="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]">
        Tissu simulé (vent, rafales), drap bleu tissé, broderie or en relief qui s&apos;embrase au passage des rayons de
        lumière. Rendu WebGPU, repli WebGL2. La météo suit la forme de la KC : vent, lumière, éclairs et usure du drap.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Grand format */}
        <div
          className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)]"
          style={{
            background:
              "radial-gradient(60% 45% at 50% 30%, rgba(0,87,255,0.22), transparent 70%), radial-gradient(40% 40% at 15% 80%, rgba(138,61,255,0.18), transparent 70%), #02050d",
          }}
        >
          {weather && (
            <KCBanner
              side="left"
              variant="lab"
              topMarginPx={36}
              windSpeed={wind}
              weather={weather}
              onHandle={setBig}
              className="mx-auto h-[82vh] max-h-[980px] min-h-[560px] w-full max-w-[560px]"
            />
          )}
        </div>

        {/* Réglages */}
        <div className="space-y-6">
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">Météo</p>
            {computed && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                Calculée : <strong className="text-[var(--gold-bright)]">{WEATHER[computed.mood].label}</strong>
                <span className="font-data text-[10px] text-[var(--text-muted)]">
                  {" "}
                  · moral {computed.morale.toFixed(2)} · tension {computed.tension.toFixed(2)}
                </span>
                <br />
                {computed.reason}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Forcer un temps">
              <button
                type="button"
                aria-pressed={forced === null}
                onClick={() => pick(null)}
                className="col-span-2 rounded-lg border border-[var(--border-gold)] px-3 py-2 font-display text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--gold)] aria-pressed:border-[var(--gold)] aria-pressed:text-[var(--gold)]"
              >
                Temps réel
              </button>
              {MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={forced === m}
                  onClick={() => pick(m)}
                  className="rounded-lg border border-[var(--border-gold)] px-3 py-2 font-display text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--gold)] aria-pressed:border-[var(--gold)] aria-pressed:text-[var(--gold)]"
                >
                  {WEATHER[m].label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <label htmlFor="wind" className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">
              Vent · {wind.toFixed(1)} m/s
            </label>
            <input
              id="wind"
              type="range"
              min={0}
              max={4}
              step={0.1}
              value={wind}
              onChange={(e) => setWind(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--gold)]"
            />
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => big?.gust(1)}
                className="rounded-lg border border-[var(--border-gold)] px-2 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
              >
                Rafale
              </button>
              <button
                type="button"
                onClick={() => emitStrike(1)}
                className="rounded-lg border border-[var(--border-gold)] px-2 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
              >
                Éclair
              </button>
              <button
                type="button"
                onClick={() => emitSweep(1.15)}
                className="rounded-lg bg-[var(--gold)] px-2 py-2.5 font-display text-xs font-black uppercase tracking-widest text-[var(--bg-primary)] hover:bg-[var(--gold-bright)]"
              >
                Rayon
              </button>
            </div>
          </div>

          {/* À la taille du header, sur la photo du hero */}
          <div>
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">Taille réelle, sur le hero</p>
            <div
              className="relative mt-3 h-[300px] overflow-hidden rounded-xl border border-[var(--border-gold)] bg-cover bg-center"
              style={{ backgroundImage: "linear-gradient(rgba(1,10,19,0.35), rgba(1,10,19,0.55)), url(/images/hero-bg.jpg)" }}
            >
              <div className="absolute inset-x-3 top-3 h-11 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-primary)]/80 backdrop-blur" />
              {weather && (
                <>
                  <KCBanner side="left" variant="header" pxPerMeter={95} weather={weather} className="absolute left-0 top-[52px] h-[240px] w-[132px]" />
                  <KCBanner side="right" variant="header" pxPerMeter={95} weather={weather} className="absolute right-0 top-[52px] h-[240px] w-[132px]" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <LogoLab />
    </div>
  );
}
