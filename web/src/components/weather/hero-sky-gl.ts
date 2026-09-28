/**
 * Ciel du hero — un seul shader WebGL2 plein cadre, sans dépendance.
 *
 * Tout est procédural, calculé par pixel, composé par-dessus la photo du
 * hero (alpha prémultiplié : la lumière s'ajoute, l'assombrissement voile) :
 *   - pluie en trois plans de parallaxe, inclinée par le vent ;
 *   - rayons de soleil venus d'en haut à gauche, ravivés au passage des
 *     rayons qui balaient les étendards (même ciel, lib/mood/sky) ;
 *   - poussières d'or en suspension, qui scintillent ;
 *   - ombres de nuages qui glissent sur la photo ;
 *   - étincelles bleues qui montent (match en direct) ;
 *   - éclair : un trait brisé, le temps des deux flashs d'une frappe.
 * Chaque effet est dosé par un uniforme 0..1 (presets.hero) ; les réglages
 * glissent vers la nouvelle météo au lieu de sauter.
 */
import type { HeroSky } from "@/lib/mood/presets";
import { strikeEnvelope, SWEEP_MS } from "@/lib/mood/sky";

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uRays, uMotes, uClouds, uRain, uGloom, uSparks;
uniform vec3 uRayColor;
uniform float uWind;
uniform float uSweep;
uniform float uBolt, uBoltX, uBoltSeed;
uniform float uScale; // pixels du canvas par pixel CSS
out vec4 fragColor;

float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0., a = .5;
  for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.7); a *= .5; }
  return s;
}

// Pluie : une goutte au plus par cellule, traînée plus vive en tête.
float rain(vec2 uv, float colW, float cellH, float speed, float len, float dens, float seed, float thick, float px) {
  vec2 p = uv;
  p.x += p.y * uWind * .28;
  p.y -= uTime * speed;
  vec2 g = vec2(p.x / colW, p.y / cellH);
  vec2 id = floor(g);
  vec2 f = fract(g);
  if (h21(id + seed) > dens) return 0.;
  float x0 = .15 + .7 * h21(id + seed + 7.3);
  float y0 = h21(id + seed + 3.1) * (1. - len);
  float dx = abs(f.x - x0) * colW;
  float w = thick * uScale; // épaisseur donnée en px CSS
  float line = 1. - smoothstep(px * w * .5, px * (w * .5 + 1.), dx);
  float t = (f.y - y0) / len;
  return line * smoothstep(0., .15, t) * (1. - step(1., t)) * t;
}

// Poussières (ou étincelles) : un point par cellule, qui dérive et scintille.
float motes(vec2 uv, float cell, float seed, float rise, float blink) {
  vec2 p = uv;
  p.y += uTime * rise;
  p.x += sin(uTime * .15 + p.y * 2.) * .02;
  vec2 id = floor(p / cell);
  vec2 f = fract(p / cell) - .5;
  vec2 r = h22(id + seed);
  if (r.y < .35) return 0.;
  vec2 c = (r - .5) * .6 + vec2(sin(uTime * (.2 + r.x * .3) + r.y * 6.28), cos(uTime * (.17 + r.y * .3) + r.x * 6.28)) * .12;
  float d = length(f - c) * cell;
  float rad = .0014 + .003 * r.x;
  float disc = exp(-d * d / (rad * rad));
  float tw = mix(.45 + .55 * sin(uTime * (1.2 + r.y * 2.) + r.x * 40.), step(.55, fract(uTime * 2.7 + r.x * 13.)), blink);
  return disc * tw;
}

// Bokeh : grosses taches floues au premier plan (profondeur de champ).
float bokeh(vec2 uv, float seed) {
  float cell = .26;
  vec2 p = uv + vec2(uTime * .006, -uTime * .01);
  vec2 id = floor(p / cell);
  vec2 f = fract(p / cell) - .5;
  vec2 r = h22(id + seed);
  if (r.x < .55) return 0.;
  vec2 c = (r - .5) * .5 + vec2(sin(uTime * .1 + r.y * 6.28), cos(uTime * .08 + r.x * 6.28)) * .08;
  float d = length(f - c) * cell;
  float rad = .018 + .026 * r.y;
  float disc = 1. - smoothstep(rad * .82, rad, d);
  float rim = smoothstep(rad * .6, rad * .95, d) * disc;
  return (disc * .55 + rim * .45) * (.5 + .5 * sin(uTime * .4 + r.x * 20.));
}

vec3 sunRays(vec2 uv, float aspect) {
  vec2 d = uv - vec2(-.15 * aspect, -.35);
  float a = atan(d.y, d.x);
  float n = fbm(vec2(a * 9., uTime * .06));
  float streak = smoothstep(.4, .82, n);
  float r = length(d);
  return uRayColor * (streak * exp(-r * .7) * .9 + exp(-r * 2.2) * .35) * (1. + uSweep * 1.2);
}

float bolt(vec2 uv, float aspect) {
  float x0 = (.5 + .35 * uBoltX) * aspect;
  float endY = .5 + .25 * h21(vec2(uBoltSeed, 1.));
  if (uv.y > endY) return 0.;
  float y = uv.y;
  float disp = (vn(vec2(y * 7., uBoltSeed)) - .5) * .16
             + (vn(vec2(y * 31., uBoltSeed + 3.)) - .5) * .05
             + (vn(vec2(y * 90., uBoltSeed + 7.)) - .5) * .015;
  float d = abs(uv.x - (x0 + disp * (.3 + y)));
  return (exp(-d * 900.) + exp(-d * 45.) * .35) * (1. - smoothstep(endY - .08, endY, y));
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes.y; // y vers le bas, unité = hauteur
  float aspect = uRes.x / uRes.y;
  float px = 1. / uRes.y;
  vec3 light = vec3(0.);
  if (uRays > .001) light += sunRays(uv, aspect) * uRays;
  if (uMotes > .001) {
    float m = motes(uv, .085, 1., .012, 0.) + motes(uv * 1.7 + 3.1, .085, 5., .02, 0.) * .6;
    light += vec3(1., .82, .5) * (m * .95 + bokeh(uv, 21.) * .07) * uMotes;
  }
  if (uRain > .001) {
    float r = rain(uv, .08, .8, 3.2, .45, .2, 13., 2.6, px) * .28
            + rain(uv, .045, .55, 2.4, .38, .3, 1., 1.4, px) * .45
            + rain(uv, .028, .38, 1.7, .32, .3, 5., 1., px) * .3
            + rain(uv, .016, .24, 1.15, .26, .3, 9., .8, px) * .2;
    // brume de pluie au sol, poussée par le vent
    float mist = smoothstep(.5, 1.05, uv.y) * fbm(uv * vec2(2.2, 5.) + vec2(uTime * .09 * uWind, uTime * .02));
    light += vec3(.72, .8, .95) * (r + mist * .1) * uRain;
  }
  if (uSparks > .001) {
    float s = motes(uv, .11, 11., .09, 1.) + motes(uv * 1.5 + 7.7, .11, 17., .13, 1.) * .7;
    light += vec3(.55, .75, 1.) * s * uSparks * 1.2;
  }
  if (uBolt > .001) {
    light += vec3(.85, .9, 1.) * bolt(uv, aspect) * uBolt;
    light += vec3(.55, .65, .9) * uBolt * .1 * (1. - uv.y * .6); // le ciel s'éclaire
  }
  float shade = smoothstep(.42, .78, fbm(uv * 1.3 + vec2(uTime * .018, uTime * .004))) * uClouds * .28;
  float darkA = clamp(shade + uGloom * (.35 + .4 * (1. - uv.y)), 0., .8);
  fragColor = vec4(vec3(.005, .012, .03) * darkA + min(light, vec3(1.)), darkA);
}`;

export interface HeroSkyState extends HeroSky {
  /** Inclinaison de la pluie (vent latéral, -1..1). */
  wind: number;
}

export interface HeroSkyHandle {
  set(s: HeroSkyState): void;
  sweep(strength: number): void;
  strike(x: number, strength: number): void;
  setPaused(p: boolean): void;
  dispose(): void;
}

const KEYS = ["rays", "motes", "clouds", "rain", "gloom", "sparks", "wind"] as const;

export function mountHeroSky(
  canvas: HTMLCanvasElement,
  initial: HeroSkyState,
  opts: { scale: number; fps: number },
): HeroSkyHandle | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // triangle plein cadre
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = {
    res: u("uRes"),
    time: u("uTime"),
    rays: u("uRays"),
    motes: u("uMotes"),
    clouds: u("uClouds"),
    rain: u("uRain"),
    gloom: u("uGloom"),
    sparks: u("uSparks"),
    wind: u("uWind"),
    rayColor: u("uRayColor"),
    sweep: u("uSweep"),
    bolt: u("uBolt"),
    boltX: u("uBoltX"),
    boltSeed: u("uBoltSeed"),
    scale: u("uScale"),
  };

  const cur: HeroSkyState = { ...initial };
  let target: HeroSkyState = { ...initial };
  const rayCol = (hex: number) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  let rayNow = rayCol(initial.rayColor);
  let sweep: { at: number; strength: number } | null = null;
  let strike: { at: number; x: number; strength: number; seed: number } | null = null;

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * opts.scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * opts.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf = 0;
  let last = 0;
  let prev = performance.now();
  const minDt = 1000 / opts.fps - 2;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < minDt) return;
    last = now;
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    const k = 1 - Math.exp(-dt / 1.2);
    for (const key of KEYS) cur[key] += (target[key] - cur[key]) * k;
    const tc = rayCol(target.rayColor);
    rayNow = rayNow.map((c, i) => c + (tc[i] - c) * k);

    let sw = 0;
    if (sweep) {
      const s = (now - sweep.at) / SWEEP_MS;
      if (s > 1) sweep = null;
      else if (s > 0) sw = Math.pow(Math.sin(Math.PI * s), 0.8) * sweep.strength;
    }
    let bolt = 0;
    if (strike) {
      const t = (now - strike.at) / 1000;
      if (t > 1.2) strike = null;
      else bolt = strikeEnvelope(t) * strike.strength;
    }

    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, (now / 1000) % 3600);
    gl.uniform1f(U.rays, cur.rays);
    gl.uniform1f(U.motes, cur.motes);
    gl.uniform1f(U.clouds, cur.clouds);
    gl.uniform1f(U.rain, cur.rain);
    gl.uniform1f(U.gloom, cur.gloom);
    gl.uniform1f(U.sparks, cur.sparks);
    gl.uniform1f(U.wind, cur.wind);
    gl.uniform3f(U.rayColor, rayNow[0], rayNow[1], rayNow[2]);
    gl.uniform1f(U.sweep, sw);
    gl.uniform1f(U.bolt, bolt);
    gl.uniform1f(U.boltX, strike?.x ?? 0);
    gl.uniform1f(U.boltSeed, strike?.seed ?? 0);
    gl.uniform1f(U.scale, opts.scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  raf = requestAnimationFrame(frame);

  return {
    set(s) {
      target = { ...s };
    },
    sweep(strength) {
      sweep = { at: performance.now(), strength };
    },
    strike(x, strength) {
      strike = { at: performance.now(), x, strength, seed: Math.random() * 100 };
    },
    setPaused(p) {
      cancelAnimationFrame(raf);
      if (!p) {
        prev = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      // pas de loseContext() : un remontage sur le même canvas (StrictMode, changement
      // de préférence de mouvement) récupérerait un contexte perdu et ne compilerait plus.
    },
  };
}
