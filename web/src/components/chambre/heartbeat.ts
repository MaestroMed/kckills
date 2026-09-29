/**
 * Cœur de la Chambre — un battement « poum-poum » synthétisé en WebAudio
 * (aucun fichier son, aucun droit). Deux coups par battement, le second
 * plus faible ; l'écart se resserre quand le rythme s'emballe. Une
 * fondamentale grave (58 → 40 Hz) et une harmonique (118 → 76 Hz) pour
 * rester audible sur des haut-parleurs d'ordinateur ou de téléphone.
 *
 * Programmation en avance (fenêtre de 300 ms, horloge audio) : pas de
 * dérive même si le thread principal est chargé.
 */
export class Heartbeat {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private timer = 0;
  private next = 0;
  private bpm = 62;
  private volume = 0.3;
  private muted = false;

  /** À appeler dans un geste utilisateur (politique d'autoplay). */
  start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.muted ? 0 : this.volume;
    this.out.connect(this.ctx.destination);
    this.next = this.ctx.currentTime + 0.15;
    this.timer = window.setInterval(() => this.schedule(), 100);
    // Démarré hors de la fenêtre d'activation : reprise au prochain geste.
    if (this.ctx.state === "suspended") {
      const resume = () => {
        void this.ctx?.resume();
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      };
      window.addEventListener("pointerdown", resume);
      window.addEventListener("keydown", resume);
    }
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(40, Math.min(200, bpm));
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  stop(): void {
    window.clearInterval(this.timer);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.out = null;
  }

  private applyGain() {
    if (!this.ctx || !this.out) return;
    this.out.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.next < ctx.currentTime + 0.3) {
      const period = 60 / this.bpm;
      const gap = 0.3 * Math.pow(60 / this.bpm, 0.7);
      this.thump(this.next, 1);
      this.thump(this.next + gap, 0.6);
      this.next += period;
    }
  }

  private thump(t: number, amp: number) {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    env.connect(out);
    const voice = (type: OscillatorType, f0: number, f1: number, level: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.14);
      g.gain.value = level;
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + 0.3);
    };
    voice("sine", 58, 40, 1);
    voice("triangle", 118, 76, 0.35);
  }
}
