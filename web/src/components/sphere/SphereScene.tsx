"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Stats } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Link from "next/link";

export interface SphereTile {
  id: string;
  thumbnailUrl: string | null;
  killerChampion: string | null;
  victimChampion: string | null;
  killerName: string | null;
  killerPlayerId: string | null;
  highlightScore: number | null;
  multiKill: string | null;
  fightType: string | null;
  minuteBucket: string | null;
  opponentCode: string | null;
  hue: number;         // 0-360, derived from active axis for colour banding
}

export type SphereAxis =
  | "time"        // game_minute_bucket: 0-5 -> 35+ across latitude
  | "player"      // killer_player_id: each player on its own meridian
  | "opponent"    // opponent_team_code: enemy bands
  | "fight"       // fight_type: solo -> teamfight scale
  | "fibonacci";  // default - even golden-angle distribution

export type SphereFilterKey = "player" | "opponent" | "fight" | "time";

export interface SphereFilter {
  key: SphereFilterKey;
  value: string;
  label: string;
}

interface SphereSceneProps {
  tiles: SphereTile[];
  axis?: SphereAxis;
  /** Active semantic filter — non-matching tiles dim, matching pop. */
  filter?: SphereFilter | null;
  /** Tile clicks a chip on its active overlay -> updates parent state. */
  onFilterChange?: (filter: SphereFilter | null) => void;
  /** Show debug overlays (FPS counter, axis helpers). */
  debug?: boolean;
  /** Initial camera distance from sphere center. */
  cameraZ?: number;
}

const SPHERE_RADIUS = 8;
const TILE_W = 1.6;
const TILE_H = 0.9;
const TILE_GAP_RAD = 0.02; // visual breathing space between tiles

/**
 * Sphere Scroll 360 — V0 spike.
 *
 * The user sits at sphere center; tiles are placed on the inner surface
 * via Fibonacci sphere distribution (best practice for evenly spreading
 * N points on a sphere without clustering at the poles).
 *
 * V0 scope (validate technical feasibility):
 *   - All tiles rendered at once with frustum culling by three.js
 *   - Drag to orbit, scroll to dolly
 *   - Click a tile -> navigate to /kill/[id]
 *   - Centre tile (closest to camera viewing direction) glows + scales
 *   - Hue banding by player so the user sees clusters even at distance
 *
 * Out of scope for V0 (Phase 2/3 per the plan):
 *   - Semantic gestures (left=same player, etc.)
 *   - LOD streaming, prefetch, frustum-pool selection
 *   - Multi-shell / pinch-zoom
 *   - Personalisation, learning compass
 */
export function SphereScene({
  tiles,
  axis = "fibonacci",
  filter = null,
  onFilterChange,
  debug = false,
  cameraZ = 0,
}: SphereSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, cameraZ], fov: 75, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ background: "radial-gradient(circle, #0A1428 0%, #010A13 100%)" }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={0.8} />
      {/* OrbitControls inverted so dragging rotates the WORLD (not the
          camera around the world) — that's how an inside-out sphere
          should feel from the centre. autoRotate gives the first
          visitor visible motion immediately; the moment they touch the
          sphere it stops (autoRotate handles that internally). */}
      <OrbitControls
        enableZoom
        enablePan={false}
        minDistance={0}
        maxDistance={SPHERE_RADIUS - 0.5}
        rotateSpeed={-0.4}
        zoomSpeed={0.6}
        autoRotate
        autoRotateSpeed={0.4}
      />
      <SphereTiles tiles={tiles} axis={axis} filter={filter} onFilterChange={onFilterChange} />
      <CenterFocusBeam />
      {debug && <Stats />}
      {debug && <axesHelper args={[5]} />}
    </Canvas>
  );
}

function tileMatchesFilter(tile: SphereTile, f: SphereFilter | null): boolean {
  if (!f) return true;
  switch (f.key) {
    case "player":   return tile.killerPlayerId === f.value;
    case "opponent": return tile.opponentCode === f.value;
    case "fight":    return tile.fightType === f.value;
    case "time":     return tile.minuteBucket === f.value;
    default:         return true;
  }
}

/** Render every tile as a plane positioned on the inner sphere surface,
 *  facing the centre. Click handler routes to the kill detail page.
 *  When axis != "fibonacci", tiles are clustered in semantic bands so
 *  drag direction acquires intrinsic meaning. */
function SphereTiles({
  tiles,
  axis,
  filter,
  onFilterChange,
}: {
  tiles: SphereTile[];
  axis: SphereAxis;
  filter: SphereFilter | null;
  onFilterChange?: (filter: SphereFilter | null) => void;
}) {
  const positions = useMemo(
    () => positionTilesByAxis(tiles, axis, SPHERE_RADIUS),
    [tiles, axis],
  );
  const cameraDir = useRef(new THREE.Vector3());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Update active tile on every frame — closest to forward-looking camera dir.
  useFrame(({ camera }) => {
    cameraDir.current.set(0, 0, -1).applyQuaternion(camera.quaternion);
    let bestDot = -Infinity;
    let bestIdx = -1;
    for (let i = 0; i < positions.length; i += 1) {
      const p = positions[i];
      // Tile direction from origin (which is camera position when zoomed-in)
      const dot =
        cameraDir.current.x * (p.x / SPHERE_RADIUS) +
        cameraDir.current.y * (p.y / SPHERE_RADIUS) +
        cameraDir.current.z * (p.z / SPHERE_RADIUS);
      if (dot > bestDot) {
        bestDot = dot;
        bestIdx = i;
      }
    }
    // Only update when actually different — React re-renders cost.
    if (bestIdx !== activeIndex && bestDot > 0.85) {
      setActiveIndex(bestIdx);
    }
  });

  return (
    <group>
      {tiles.map((tile, i) => {
        const p = positions[i];
        const isActive = activeIndex === i;
        const passesFilter = tileMatchesFilter(tile, filter);
        return (
          <SphereTileMesh
            key={tile.id}
            tile={tile}
            position={p}
            active={isActive}
            dim={!passesFilter}
            onFilterChange={onFilterChange}
          />
        );
      })}
    </group>
  );
}

interface TileMeshProps {
  tile: SphereTile;
  position: THREE.Vector3;
  active: boolean;
  dim: boolean;
  onFilterChange?: (filter: SphereFilter | null) => void;
}

function SphereTileMesh({ tile, position, active, dim, onFilterChange }: TileMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  // Load thumbnail texture lazily — this is V0's biggest perf risk on
  // mobile, will move to LOD/streaming in Phase 3.
  useEffect(() => {
    if (!tile.thumbnailUrl) return;
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";
    loader.load(
      tile.thumbnailUrl,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        setTexture(t);
      },
      undefined,
      () => {
        // Quietly skip on failure — tile renders as solid colour.
      },
    );
  }, [tile.thumbnailUrl]);

  // Orient the tile so its face looks at the sphere centre.
  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.lookAt(0, 0, 0);
  }, [position]);

  const tileColor = useMemo(() => new THREE.Color().setHSL(tile.hue / 360, 0.45, 0.4), [tile.hue]);

  // Tile size scales with highlight_score so the eye lands on great
  // clips first. Min 0.85x (routine) → max 1.55x (penta / score 10).
  const baseScale = useMemo(() => {
    const hl = (tile.highlightScore ?? 5) / 10;
    let s = 0.85 + hl * 0.45;
    if (tile.multiKill === "penta") s *= 1.25;
    else if (tile.multiKill === "quadra") s *= 1.15;
    else if (tile.multiKill === "triple") s *= 1.08;
    return Math.min(1.55, s);
  }, [tile.highlightScore, tile.multiKill]);

  // Active tile pops further. Dim tiles shrink slightly to reinforce focus.
  const scale = active ? baseScale * 1.18 : dim ? baseScale * 0.85 : baseScale;

  // Emissive accent: gold for active, orange for high-score multi-kills,
  // none for the rest. Dim tiles get NO accent so they recede visually.
  const emissive = useMemo(() => {
    if (dim) return new THREE.Color("#000000");
    if (active) return new THREE.Color("#C8AA6E");
    if (tile.multiKill === "penta") return new THREE.Color("#FFD700");
    if (tile.multiKill === "quadra") return new THREE.Color("#FF9800");
    if ((tile.highlightScore ?? 0) >= 8.5) return new THREE.Color("#C8AA6E");
    return new THREE.Color("#000000");
  }, [active, dim, tile.multiKill, tile.highlightScore]);

  const emissiveIntensity = active
    ? 0.5
    : dim
      ? 0
      : tile.multiKill === "penta"
        ? 0.45
        : tile.multiKill === "quadra"
          ? 0.3
          : (tile.highlightScore ?? 0) >= 8.5
            ? 0.18
            : 0;

  // Dim tiles drop opacity hard so the focused subset reads instantly.
  const opacity = dim ? 0.18 : 1;

  return (
    <mesh ref={meshRef} position={position} scale={scale}>
      <planeGeometry args={[TILE_W, TILE_H]} />
      <meshStandardMaterial
        map={texture ?? undefined}
        color={texture ? "#ffffff" : tileColor}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        side={THREE.DoubleSide}
        toneMapped={false}
        transparent
        opacity={opacity}
      />
      {active && !dim && (
        <Html
          position={[0, -TILE_H / 2 - 0.15, 0]}
          center
          distanceFactor={6}
          occlude={false}
          style={{ pointerEvents: "auto" }}
        >
          <ActiveTileOverlay tile={tile} onFilterChange={onFilterChange} />
        </Html>
      )}
    </mesh>
  );
}

/** Glassmorphism overlay shown beneath the active tile. Title + click-
 *  to-open + filter chips that update the parent sphere state. */
function ActiveTileOverlay({
  tile,
  onFilterChange,
}: {
  tile: SphereTile;
  onFilterChange?: (filter: SphereFilter | null) => void;
}) {
  return (
    <div className="rounded-xl bg-black/85 backdrop-blur-md border border-[var(--gold)]/45 px-3 py-2 text-center whitespace-nowrap shadow-2xl shadow-black/50">
      <Link
        href={`/kill/${tile.id}`}
        className="block hover:opacity-90"
      >
        <p className="font-display text-[11px] font-bold text-white leading-tight">
          <span className="text-[var(--gold)]">{tile.killerChampion ?? "?"}</span>
          <span className="text-white/55 mx-1">→</span>
          <span>{tile.victimChampion ?? "?"}</span>
        </p>
        {tile.highlightScore != null && (
          <p className="mt-0.5 font-data text-[8px] text-[var(--gold)]/80 uppercase tracking-widest">
            {tile.highlightScore.toFixed(1)}/10
            {tile.multiKill ? ` · ${tile.multiKill}` : ""}
            {" · ouvrir"}
          </p>
        )}
      </Link>

      {/* Filter chips — click to filter the sphere */}
      {onFilterChange && (
        <div className="mt-1.5 flex items-center justify-center gap-1 flex-wrap">
          {tile.killerName && tile.killerPlayerId && (
            <FilterChip
              label={tile.killerName}
              onClick={() =>
                onFilterChange({ key: "player", value: tile.killerPlayerId!, label: tile.killerName! })
              }
            />
          )}
          {tile.opponentCode && (
            <FilterChip
              label={`vs ${tile.opponentCode}`}
              onClick={() =>
                onFilterChange({ key: "opponent", value: tile.opponentCode!, label: `vs ${tile.opponentCode}` })
              }
            />
          )}
          {tile.fightType && (
            <FilterChip
              label={tile.fightType}
              onClick={() =>
                onFilterChange({ key: "fight", value: tile.fightType!, label: tile.fightType! })
              }
            />
          )}
          {tile.minuteBucket && (
            <FilterChip
              label={`${tile.minuteBucket} min`}
              onClick={() =>
                onFilterChange({ key: "time", value: tile.minuteBucket!, label: `${tile.minuteBucket} min` })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2 py-0.5 text-[8px] font-data uppercase tracking-widest text-[var(--gold)]/90 hover:bg-[var(--gold)]/25 hover:border-[var(--gold)]/70 transition-colors"
    >
      {label}
    </button>
  );
}

/** Subtle radial fade in the centre of the sphere, hints at "you are
 *  inside something" rather than floating in void. */
function CenterFocusBeam() {
  return (
    <mesh>
      <sphereGeometry args={[SPHERE_RADIUS - 0.01, 32, 32]} />
      <meshBasicMaterial
        color="#C8AA6E"
        side={THREE.BackSide}
        transparent
        opacity={0.04}
      />
    </mesh>
  );
}

// ─── Math helpers ───────────────────────────────────────────────────────

/**
 * Fibonacci sphere — places N points on a sphere with near-uniform
 * spacing. Avoids the polar clustering of naive (theta, phi) random
 * sampling. The fallback when no semantic axis is selected.
 */
function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points.push(new THREE.Vector3(x * radius, y * radius, z * radius));
  }
  return points;
}

// Stable order for each axis — drives the spatial gradient (top→bottom for
// time/fight, around the sphere for player/opponent).
const AXIS_ORDER: Record<SphereAxis, string[] | null> = {
  fibonacci: null,
  time: ["0-5", "5-10", "10-15", "15-20", "20-25", "25-30", "30-35", "35+"],
  fight: [
    "solo_kill", "gank", "pick",
    "skirmish_2v2", "skirmish_3v3",
    "teamfight_4v4", "teamfight_5v5",
  ],
  player: null,    // ordered alphabetically at runtime
  opponent: null,  // ordered alphabetically at runtime
};

function getAxisKey(tile: SphereTile, axis: SphereAxis): string | null {
  switch (axis) {
    case "time":     return tile.minuteBucket;
    case "fight":    return tile.fightType;
    case "player":   return tile.killerPlayerId;
    case "opponent": return tile.opponentCode;
    default:         return null;
  }
}

/**
 * Place each tile at a sphere position determined by its value on the
 * active axis. The semantic dimension becomes inherent to the layout —
 * dragging "down" on the time axis genuinely takes you later in the
 * game, dragging "around" on the player axis cycles through KC players.
 *
 *   time / fight  → latitude bands (north pole = first value, south = last)
 *   player / opp  → longitude wedges (each value occupies a meridian sector)
 *   fibonacci     → uniform fallback
 */
function positionTilesByAxis(
  tiles: SphereTile[],
  axis: SphereAxis,
  radius: number,
): THREE.Vector3[] {
  if (axis === "fibonacci" || tiles.length === 0) {
    return fibonacciSphere(tiles.length, radius);
  }

  // Group tile indices by their axis value.
  const groupsMap = new Map<string, number[]>();
  for (let i = 0; i < tiles.length; i += 1) {
    const key = getAxisKey(tiles[i], axis) ?? "_unknown";
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key)!.push(i);
  }

  // Sort groups by the axis's intrinsic order (e.g. 0-5 before 5-10).
  const explicitOrder = AXIS_ORDER[axis];
  const sortedGroups = [...groupsMap.entries()].sort((a, b) => {
    if (explicitOrder) {
      const ia = explicitOrder.indexOf(a[0]);
      const ib = explicitOrder.indexOf(b[0]);
      // Unknown values sink to the end.
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a[0].localeCompare(b[0]);
  });

  const G = sortedGroups.length;
  const positions = new Array<THREE.Vector3>(tiles.length);

  // Latitude-banded axes: groups stack vertically along the sphere's
  // y-axis. Within a band, tiles distribute evenly around the longitude.
  const isLatitudeAxis = axis === "time" || axis === "fight";

  sortedGroups.forEach(([, indices], gIdx) => {
    if (isLatitudeAxis) {
      // phiCenter spreads from 0.18 (near north pole) to π-0.18 (near south).
      const phiCenter = 0.18 + (gIdx / Math.max(1, G - 1)) * (Math.PI - 0.36);
      const phiSpread = (Math.PI - 0.36) / Math.max(1, G) * 0.5;
      indices.forEach((idx, i) => {
        const theta = (i / indices.length) * 2 * Math.PI + gIdx * 0.13;
        const phi = phiCenter + ((i % 5) - 2) * (phiSpread / 5);
        positions[idx] = sphericalToCartesian(radius, phi, theta);
      });
    } else {
      // Longitude-wedge axes: each group occupies a meridian sector,
      // tiles spread by phi within their wedge.
      const thetaCenter = (gIdx / G) * 2 * Math.PI;
      const thetaSpread = (2 * Math.PI) / G * 0.85;
      indices.forEach((idx, i) => {
        const phi = 0.25 + (i / Math.max(1, indices.length - 1)) * (Math.PI - 0.5);
        const theta = thetaCenter + ((i % 4) - 1.5) * (thetaSpread / 4);
        positions[idx] = sphericalToCartesian(radius, phi, theta);
      });
    }
  });

  // Fill any holes from race conditions / odd grouping with fibonacci fallback.
  const fallback = fibonacciSphere(tiles.length, radius);
  for (let i = 0; i < positions.length; i += 1) {
    if (!positions[i]) positions[i] = fallback[i];
  }
  return positions;
}

function sphericalToCartesian(r: number, phi: number, theta: number): THREE.Vector3 {
  const sinPhi = Math.sin(phi);
  return new THREE.Vector3(
    r * sinPhi * Math.cos(theta),
    r * Math.cos(phi),
    r * sinPhi * Math.sin(theta),
  );
}

// `Stats` import only used in debug — keep the bundle lean.
void Stats;
