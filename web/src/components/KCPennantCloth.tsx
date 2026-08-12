"use client";

/**
 * KCPennantCloth — étendard KC en « vrai tissu » 3D (Header 2.0, Mehdi
 * 2026-08-12). Un petit plan R3F pinné par son bord haut, déformé en
 * useFrame par deux ondes progressives + une brise latérale : le rendu
 * lit comme une bannière de tissu qui flotte. Bannière navy, gros liseré
 * or, vrai logo Karmine Corp teinté or (public/images/kc-logo.png).
 *
 * Règles perf (skill r3f-sculpting-cards) :
 *   - Toute l'animation est IMPÉRATIVE dans useFrame (zéro setState à 60 fps).
 *   - Géométrie minuscule : 14×22 segments (≈ 660 tris) par étendard.
 *   - dpr [1, 2], antialias, alpha ; contexte « low-power ».
 *   - Le parent (navbar) ne monte ce composant QUE sur desktop, hors
 *     prefers-reduced-motion, après requestIdleCallback, si WebGL dispo.
 *   - delta clampé (onglet caché → pas de saut de simulation).
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const CLOTH_W = 0.8;
const CLOTH_H = 1.7;
const SEG_X = 14;
const SEG_Y = 22;

/** Texture bannière dessinée une fois sur un canvas offscreen :
 *  corps navy dégradé, gros contour or, liseré crème, queue d'aronde
 *  découpée par l'alpha, logo KC teinté or. */
function useBannerTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const W = 256;
    const H = Math.round((W * CLOTH_H) / CLOTH_W); // 435
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;

    // Silhouette : rectangle fendu en queue d'aronde (pointe du V vers le
    // haut, les deux pans descendent jusqu'en bas).
    const notch = H * 0.14;
    const swallow = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(W, H);
      ctx.lineTo(W / 2, H - notch);
      ctx.lineTo(0, H);
      ctx.closePath();
    };

    // Corps navy (dégradé profond, léger vignettage).
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#13233f");
    g.addColorStop(0.55, "#0A1428");
    g.addColorStop(1, "#060d1a");
    swallow();
    ctx.fillStyle = g;
    ctx.fill();

    // Gros contour or (la demande : « gros contours »).
    const gold = ctx.createLinearGradient(0, 0, W, H);
    gold.addColorStop(0, "#E8D6A8");
    gold.addColorStop(0.5, "#C8AA6E");
    gold.addColorStop(1, "#8d692f");
    swallow();
    ctx.lineWidth = 14;
    ctx.strokeStyle = gold;
    ctx.stroke();

    // Liseré crème interne fin.
    ctx.save();
    ctx.translate(W / 2, 0);
    ctx.scale((W - 44) / W, (H - 44) / H);
    ctx.translate(-W / 2, 22);
    swallow();
    ctx.restore();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(240,230,210,0.45)";
    ctx.stroke();

    // Barre d'accroche or en haut.
    ctx.fillStyle = gold;
    ctx.fillRect(0, 0, W, 12);

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;

    // Logo KC officiel, teinté or via un offscreen (source-in sur l'alpha),
    // dessiné dès que le PNG est chargé puis needsUpdate.
    const img = new Image();
    img.onload = () => {
      const size = W * 0.62;
      const off = document.createElement("canvas");
      off.width = off.height = size;
      const octx = off.getContext("2d")!;
      octx.drawImage(img, 0, 0, size, size);
      octx.globalCompositeOperation = "source-in";
      const lg = octx.createLinearGradient(0, 0, size, size);
      lg.addColorStop(0, "#F0E6D2");
      lg.addColorStop(0.5, "#C8AA6E");
      lg.addColorStop(1, "#a8853e");
      octx.fillStyle = lg;
      octx.fillRect(0, 0, size, size);
      // ombre douce pour décoller le logo du tissu
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.drawImage(off, (W - size) / 2, H * 0.16, size, size);
      ctx.restore();
      tex.needsUpdate = true;
    };
    img.src = "/images/kc-logo.png";

    return tex;
  }, []);
}

function ClothBanner({ phase = 0 }: { phase?: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const geoRef = useRef<THREE.PlaneGeometry>(null!);
  const tRef = useRef(phase);
  const texture = useBannerTexture();

  // Positions de repos copiées une fois — la déformation repart toujours
  // du plan neutre (pas d'accumulation d'erreur).
  const rest = useMemo(() => {
    const geo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, SEG_X, SEG_Y);
    return geo;
  }, []);

  useFrame((_, delta) => {
    const d = Math.min(delta, 0.05); // clamp après onglet caché
    tRef.current += d;
    const t = tRef.current;
    const geo = geoRef.current;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const restPos = rest.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      const x = restPos.getX(i);
      const y = restPos.getY(i);
      // 0 en haut (pinné à la tringle), 1 en bas (bord libre).
      const hang = THREE.MathUtils.clamp(0.5 - y / CLOTH_H, 0, 1);
      const amp = 0.14 * hang * hang * (0.6 + 0.4 * hang);
      // Deux ondes progressives + une respiration latérale : le cocktail
      // classique du drapeau — assez organique pour lire « tissu ».
      const z =
        amp *
        (Math.sin(y * 4.2 + t * 2.1 + x * 2.0) * 0.55 +
          Math.sin(y * 8.5 + t * 3.3 + x * 4.5) * 0.3 +
          Math.sin(x * 6.0 + t * 1.6) * 0.25);
      // Le bord libre dérive aussi légèrement en X (le vent pousse).
      const sway = 0.03 * hang * Math.sin(t * 1.3 + y * 2.0);
      pos.setXYZ(i, x + sway, y, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // Balancement global très léger de la tringle.
    meshRef.current.rotation.z = 0.03 * Math.sin(t * 0.9);
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <planeGeometry ref={geoRef} args={[CLOTH_W, CLOTH_H, SEG_X, SEG_Y]} />
      <meshStandardMaterial
        map={texture}
        transparent
        alphaTest={0.5}
        side={THREE.DoubleSide}
        roughness={0.85}
        metalness={0.18}
      />
    </mesh>
  );
}

export default function KCPennantCloth({ side }: { side: "left" | "right" }) {
  return (
    <Canvas
      // Décoratif pur — le parent porte aria-hidden + pointer-events-none.
      dpr={[1, 2]}
      camera={{ position: [0, 0, 2.3], fov: 45 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        // Le tone mapping ACES par défaut assombrissait la bannière en
        // slab noir illisible — on veut les couleurs fidèles du canvas.
        gl.toneMapping = THREE.NoToneMapping;
      }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={1.05} />
      <directionalLight position={[2, 1.5, 3]} intensity={0.9} />
      <directionalLight position={[-2, -1, 2]} intensity={0.3} color="#0AC8B9" />
      {/* Échelle calée sur le canvas 58×150 (fov 45, z 2.3 → champ visible
          ±0.95 en Y, ±0.37 en X) : fanion élancé 0.8×1.7 à l'échelle 0.85,
          tringle collée au bord haut, marge pour les ondes. */}
      <group scale={0.85} position={[0, 0.23, 0]}>
        <ClothBanner phase={side === "left" ? 0 : Math.PI * 0.7} />
      </group>
    </Canvas>
  );
}
