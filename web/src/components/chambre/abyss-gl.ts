/**
 * L'Abîme — fond 3D de la Chambre des Souffrances (un shader WebGL2 plein
 * cadre, sans dépendance).
 *
 * On regarde au fond d'un puits circulaire sans fin. Chaque pixel est un
 * point de la paroi, à la profondeur z = k / r (projection d'un cylindre vu
 * depuis son axe) : pierres appareillées, runes Hextech gravées, et un
 * anneau de lumière à chaque cercle de la descente. La caméra descend au
 * scroll (`uDescent`), en tournant un peu (le vertige) ; la palette glisse
 * de la pierre froide éclairée d'en haut à la roche rougie par la lueur de
 * l'Enfer, qui grandit au fond du puits et bat avec le cœur (`uPulse`). Des
 * cendres puis des braises montent vers la caméra.
 *
 * `flash()` : éclat au passage d'un anneau. `ascend()` : la remontée vers
 * la lumière (tout se dore et s'illumine).
 */

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDescent;
uniform float uProgress;
uniform float uPulse;
uniform float uFlash;
uniform float uAscend;
out vec4 fragColor;

#define PI 3.14159265
const float RING = 6.0;

float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0., a = .5;
  for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + vec2(13.7, 7.1); a *= .5; }
  return s;
}

// Particules qui montent vers la caméra (espace log-polaire : plus proches = plus grosses).
float rising(vec2 p, float t, float density, float seed) {
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 g = vec2(a / (2. * PI) * 34., log(r) * 5. - t);
  vec2 id = floor(g);
  vec2 f = fract(g) - .5;
  vec2 h = h22(id + seed);
  if (h.x > density) return 0.;
  vec2 c = (h22(id + seed + 4.7) - .5) * .6;
  float d = length(f - c);
  float s = .05 + .07 * h.y;
  return exp(-d * d / (s * s)) * (.55 + .45 * sin(t * 7. + h.y * 40.)) * smoothstep(.03, .35, r);
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float r = max(length(p), 1e-3);
  float P = uProgress;
  // le vertige : la chute tourne lentement
  float a = atan(p.y, p.x) + uTime * .012 + uDescent * .03;
  float zw = .55 / r;               // distance de la paroi vue sous ce pixel
  float z = zw + uDescent;          // profondeur absolue dans le puits
  vec2 w = vec2(a / (2. * PI) * 18., z * 1.6);

  // ── pierre appareillée ──
  vec2 b = w;
  b.x += step(1., mod(floor(b.y), 2.)) * .5;
  vec2 bi = floor(b), bf = fract(b);
  float edge = min(min(bf.x, 1. - bf.x), min(bf.y * 1.6, (1. - bf.y) * 1.6));
  float detail = 1. - smoothstep(6., 16., zw); // au loin, la texture se fond (pas de moiré)
  float mortar = mix(1., smoothstep(0., .07, edge), detail);
  float grain = fbm(w * 2.3 + bi * 3.1);
  float stone = mix(.62, (.35 + .75 * grain) * (.6 + .4 * h21(bi)), detail) * mix(.3, 1., mortar);

  // ── runes gravées (losanges Hextech) sur quelques blocs ──
  vec2 q = bf - .5;
  q.y *= 1.6;
  float runeOn = step(.86, h21(bi + 7.7)) * detail;
  float rune = runeOn * (1. - smoothstep(.015, .04, abs(abs(q.x) + abs(q.y) - .26)));

  // ── anneaux : un par cercle (1 à 10) ──
  float k = floor(z / RING + .5);
  float dRing = abs(z - k * RING);
  float valid = step(.5, k) * step(k, 10.5);
  // l'anneau brille au loin et s'efface en passant la caméra (sinon il éblouit le texte)
  float ring = valid * exp(-dRing * dRing / .018) * smoothstep(.6, 2.6, zw);
  float lip = valid * smoothstep(.0, .25, z - k * RING) * (1. - smoothstep(.25, .9, z - k * RING)); // ombre sous la corniche

  // ── lumière ──
  vec3 stoneCol = mix(vec3(.15, .16, .19), vec3(.16, .06, .045), P);
  vec3 fogCol = mix(vec3(.004, .007, .016), vec3(.055, .004, .003), P);
  vec3 ringCol = mix(vec3(.9, .72, .42), vec3(1., .2, .08), smoothstep(.25, .85, P));
  float lantern = exp(-zw * .11);                                  // la torche de la caméra
  float fromAbove = exp(-max(uDescent, 0.) * .22) * exp(-zw * .12); // la lumière de la surface
  float hellI = smoothstep(.04, 1., P) * (1. + .55 * uPulse);
  float fromBelow = hellI * exp(-max(10.5 * RING - z, 0.) * .09);  // la paroi rougie par le fond
  vec3 lit = stoneCol * stone * (.28 + lantern * 1.15 + fromAbove * vec3(1.1, .95, .7) * 1.4)
           + vec3(1., .28, .06) * stone * fromBelow * .45;
  lit *= 1. - lip * .55;
  lit += ringCol * ring * (1.4 + lantern + .6 * hellI);
  lit += mix(vec3(.55, .75, 1.), vec3(1., .35, .1), P) * rune * (.5 + .8 * lantern) * (.6 + .4 * sin(uTime * 1.3 + bi.x));

  float fog = 1. - exp(-zw * .12);
  vec3 col = mix(lit, fogCol, fog);

  // ── la lueur du fond ──
  col += vec3(1., .3, .06) * exp(-r * 7.) * hellI * 1.6;
  col += vec3(1., .42, .12) * exp(-r * 2.2) * hellI * .08;

  // ── cendres (en haut), braises (en bas) ──
  float dust = rising(p, uTime * .35, .18, 1.);
  float embers = rising(p * 1.3, uTime * .8, .32, 9.) + rising(p * .8, uTime * .6, .22, 17.);
  col += vec3(.55, .58, .62) * dust * (1. - P) * .35;
  col += vec3(1., .45, .12) * embers * smoothstep(.3, 1., P) * 1.2;

  // ── cœur, éclat, remontée ──
  float vig = smoothstep(1.25, .25 + .1 * uPulse * P, r * (1. + .12 * uPulse * P));
  col *= mix(.55, 1., vig);
  col += vec3(1., .88, .66) * uFlash * .55 * (1. - smoothstep(0., .9, r));
  col = mix(col, vec3(1., .93, .78) * (1.2 - r * .6), uAscend * uAscend);

  col += (h21(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * .025; // grain
  fragColor = vec4(max(col, 0.), 1.);
}`;

export interface AbyssHandle {
  /** Profondeur visée (0 = premier anneau ; -1 = au bord du puits) et avancée 0..1. */
  setDepth(descent: number, progress: number): void;
  /** Battements par minute du cœur (0 = arrêté). */
  setBpm(bpm: number): void;
  flash(strength?: number): void;
  ascend(): void;
  setPaused(p: boolean): void;
  dispose(): void;
}

/** Espacement des anneaux dans le shader (RING) : un cercle = 6 unités. */
export const ABYSS_RING = 6;

export function mountAbyss(
  canvas: HTMLCanvasElement,
  opts: { scale: number; fps: number; still?: boolean },
): AbyssHandle | null {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
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
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = {
    res: u("uRes"),
    time: u("uTime"),
    descent: u("uDescent"),
    progress: u("uProgress"),
    pulse: u("uPulse"),
    flash: u("uFlash"),
    ascend: u("uAscend"),
  };

  const state = { descent: -1, progress: 0, targetDescent: -1, targetProgress: 0, vel: 0 };
  let bpm = 0;
  let flashAt = -1e9;
  let flashStrength = 0;
  let ascendAt = -1;

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * opts.scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * opts.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (opts.still) draw(performance.now());
  };

  // Cœur : « poum-poum » (deux coups, le second plus faible), 0..1.
  const pulseAt = (t: number) => {
    if (bpm <= 0) return 0;
    const ph = ((t / 1000) * bpm) / 60;
    const f = ph - Math.floor(ph);
    const beat = (x: number, amp: number) => (x < 0 ? 0 : amp * Math.exp(-x * 14) * Math.min(1, x * 40));
    return beat(f, 1) + beat(f - 0.28, 0.6);
  };

  let prev = performance.now();
  const draw = (now: number) => {
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    if (opts.still) {
      state.descent = state.targetDescent;
      state.progress = state.targetProgress;
    } else {
      // ressort critique : la caméra suit le scroll sans à-coups
      const k = 18;
      const acc = k * (state.targetDescent - state.descent) - 2 * Math.sqrt(k) * state.vel;
      state.vel += acc * dt;
      state.descent += state.vel * dt;
      state.progress += (state.targetProgress - state.progress) * (1 - Math.exp(-dt / 0.6));
    }
    const flash = Math.max(0, flashStrength * Math.exp(-(now - flashAt) / 260));
    const ascend = ascendAt < 0 ? 0 : Math.min(1, (now - ascendAt) / 1400);
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, opts.still ? 12 : (now / 1000) % 3600);
    gl.uniform1f(U.descent, state.descent);
    gl.uniform1f(U.progress, state.progress);
    gl.uniform1f(U.pulse, opts.still ? 0 : pulseAt(now));
    gl.uniform1f(U.flash, opts.still ? 0 : flash);
    gl.uniform1f(U.ascend, ascend);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf = 0;
  let last = 0;
  const minDt = 1000 / opts.fps - 2;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < minDt) return;
    last = now;
    draw(now);
  };
  if (!opts.still) raf = requestAnimationFrame(frame);
  else draw(performance.now());

  return {
    setDepth(descent, progress) {
      state.targetDescent = descent;
      state.targetProgress = progress;
      if (opts.still) draw(performance.now());
    },
    setBpm(v) {
      bpm = v;
    },
    flash(strength = 1) {
      flashAt = performance.now();
      flashStrength = strength;
    },
    ascend() {
      ascendAt = performance.now();
      if (opts.still) draw(performance.now() + 1400);
    },
    setPaused(p) {
      cancelAnimationFrame(raf);
      if (!p && !opts.still) {
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
