import { NextResponse } from "next/server";
import { getMoodWeather } from "@/lib/mood/mood-weather";
import { forcedWeather } from "@/lib/mood/presets";

/**
 * GET /api/mood — météo du site d'après la forme de la KC (lib/mood).
 * Mise en cache 10 min au CDN : le moral bouge au rythme des matchs.
 */
export const revalidate = 600;

export async function GET() {
  try {
    const weather = await getMoodWeather();
    return NextResponse.json(weather, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json(forcedWeather("variable"));
  }
}
