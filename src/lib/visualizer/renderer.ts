import type { Analysis, VizMode } from "@/lib/audio/types";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
};

type Star = {
  x: number;
  y: number;
  z: number;
  pz: number;
};

const BAR_COUNT = 96;
const PARTICLE_CAP = 520;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

export class VisualizerRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private t = 0;
  private rot = 0;
  private shake = 0;
  private flash = 0;
  private hue = 186;
  private floodSlot = 0;
  private bars = new Float32Array(BAR_COUNT);
  private peaks = new Float32Array(BAR_COUNT);
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private tunnel: number[] = [];
  private title = "";
  private artist = "";
  private reduced = false;
  mode: VizMode = "auto";
  hideCenter = false;

  get palette() {
    return { hue: this.hue, flash: this.flash };
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("Canvas is unavailable.");
    this.ctx = ctx;
    for (let i = 0; i < 160; i++) this.spawnStar();
    for (let i = 0; i < 10; i++) this.tunnel.push(i / 10);
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  setTrack(title: string, artist: string) {
    this.title = title;
    this.artist = artist;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  frame(dt: number, analysis: Analysis, freq: Uint8Array, wave: Uint8Array, playing: boolean) {
    const idle = !playing;
    const a = idle ? this.idleAnalysis(analysis) : analysis;
    this.t += dt;
    this.rot += dt * (0.12 + a.bass * 0.9);
    this.hue = 186 + a.high * 28 + Math.sin(this.t * 0.15) * 8;

    if (a.beat) {
      this.shake = this.reduced ? 0 : 10 + a.bass * 14;
      this.flash = 0.22 + a.bass * 0.28;
      this.burst(a);
      this.floodSlot = (this.floodSlot + 1) % 3;
    }
    if (a.drop) {
      this.flash = 0.55;
      this.burst(a, 80);
    }
    this.shake *= 0.84;
    this.flash *= 0.9;

    this.smoothBars(freq, a);

    const ctx = this.ctx;
    const fade = idle ? 0.18 : 0.1 + (1 - a.energy) * 0.08;
    ctx.fillStyle = `rgba(5,5,8,${fade})`;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    const mode = this.mode === "auto" ? this.autoMode(a) : this.mode;
    this.drawStars(a, mode === "tunnel");
    this.drawFloods(a);
    if (mode === "grid" || (this.mode === "auto" && a.energy > 0.22)) this.drawGrid(a);
    if (mode === "tunnel" || (this.mode === "auto" && a.energy > 0.5)) this.drawTunnel(a);
    if (mode === "wave") this.drawWaves(a, wave);
    else this.drawHorizonWave(a, wave);
    if (mode === "storm" || this.mode === "auto") this.drawStorm(a);
    if (mode !== "wave") this.drawOrbital(a);
    this.drawLasers(a);
    this.stepParticles(dt, a);
    if (!this.hideCenter) this.drawCenter(a);
    this.drawTitle(a);
    this.drawVignette();
    if (this.flash > 0.02) {
      ctx.fillStyle = `hsla(${this.hue}, 80%, 78%, ${this.flash * 0.22})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  }

  private idleAnalysis(base: Analysis): Analysis {
    const t = this.t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.15);
    const pulse2 = 0.5 + 0.5 * Math.sin(t * 2.3 + 1.2);
    return {
      bass: Math.max(base.bass, 0.22 + pulse * 0.18),
      lowMid: Math.max(base.lowMid, 0.16 + pulse2 * 0.12),
      mid: Math.max(base.mid, 0.12 + (1 - pulse) * 0.1),
      high: Math.max(base.high, 0.1 + pulse2 * 0.08),
      energy: Math.max(base.energy, 0.2 + pulse * 0.12),
      beat: base.beat,
      hat: base.hat,
      drop: base.drop,
      flux: Math.max(base.flux, 0.04),
      bpm: base.bpm,
      beatPhase: base.beatPhase,
      barBeat: base.barBeat,
      confidence: base.confidence,
    };
  }

  private autoMode(a: Analysis): VizMode {
    if (a.energy > 0.62 || a.drop) return "tunnel";
    if (a.energy > 0.4) return "grid";
    if (a.high > 0.35) return "storm";
    return "orbital";
  }

  private smoothBars(freq: Uint8Array, a: Analysis) {
    const n = this.bars.length;
    const usable = Math.max(24, Math.floor(freq.length * 0.45));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const idx = Math.floor(Math.pow(t, 1.4) * usable);
      const v = (freq[idx] ?? 0) / 255;
      const boosted = Math.pow(v, 0.85) * (0.55 + a.energy * 0.7);
      this.bars[i] = lerp(this.bars[i]!, boosted, 0.28);
      this.peaks[i] = Math.max(this.peaks[i]! * 0.97, this.bars[i]!);
    }
  }

  private spawnStar() {
    this.stars.push({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
      pz: Math.random(),
    });
  }

  private drawStars(a: Analysis, warp: boolean) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const speed = (warp ? 0.55 : 0.12) + a.energy * 0.7;
    ctx.strokeStyle = `hsla(${this.hue}, 70%, 80%, 0.55)`;
    ctx.lineWidth = 1;
    for (const s of this.stars) {
      s.pz = s.z;
      s.z -= speed * 0.016;
      if (s.z <= 0.02) {
        s.x = (Math.random() - 0.5) * 2;
        s.y = (Math.random() - 0.5) * 2;
        s.z = 1;
        s.pz = 1;
      }
      const sx = cx + (s.x / s.z) * cx;
      const sy = cy + (s.y / s.z) * cy;
      const px = cx + (s.x / s.pz) * cx;
      const py = cy + (s.y / s.pz) * cy;
      const alpha = clamp(1.1 - s.z) * (0.25 + a.energy * 0.5);
      ctx.strokeStyle = `hsla(${this.hue}, 80%, 88%, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }

  private drawGrid(a: Analysis) {
    const ctx = this.ctx;
    const horizon = this.h * 0.52;
    const vanishX = this.w / 2;
    const vanishY = horizon - 20;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon - 8, this.w, this.h);
    ctx.clip();

    const rows = 18;
    const pulse = a.bass * 40;
    ctx.lineWidth = 1;
    for (let i = 0; i < rows; i++) {
      const u = (i + ((this.t * (0.4 + a.energy) * 6) % 1)) / rows;
      const y = horizon + Math.pow(u, 1.7) * (this.h - horizon) + pulse * u;
      const alpha = 0.06 + u * 0.28 + (a.beat ? 0.08 : 0);
      ctx.strokeStyle = `hsla(${this.hue}, 80%, 70%, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }
    const cols = 16;
    for (let i = -cols; i <= cols; i++) {
      const x = vanishX + i * (this.w / cols);
      ctx.strokeStyle = `hsla(${this.hue}, 70%, 72%, ${0.08 + a.lowMid * 0.25})`;
      ctx.beginPath();
      ctx.moveTo(vanishX, vanishY);
      ctx.lineTo(x, this.h + 40);
      ctx.stroke();
    }
    ctx.restore();

    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = t * this.w;
      const h = this.bars[Math.floor(t * (this.bars.length - 1))]! * this.h * 0.22;
      ctx.fillStyle = `hsla(${this.hue + t * 20}, 90%, ${55 + a.bass * 20}%, ${0.18 + a.energy * 0.25})`;
      ctx.fillRect(x, horizon - h, this.w / n + 1, h);
    }
  }

  private drawTunnel(a: Analysis) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h * 0.48;
    const max = Math.hypot(this.w, this.h) * 0.55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot * 0.35);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.tunnel.length; i++) {
      this.tunnel[i] = (this.tunnel[i]! + (0.004 + a.bass * 0.02)) % 1;
      const u = this.tunnel[i]!;
      const r = 12 + u * max;
      const bar = this.bars[i % this.bars.length]!;
      ctx.strokeStyle = `hsla(${this.hue + u * 30}, 90%, ${60 + bar * 25}%, ${0.08 + (1 - u) * 0.28})`;
      ctx.lineWidth = 2 + bar * 10 + (a.beat ? 4 : 0);
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawOrbital(a: Analysis) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h * 0.46;
    const radius = Math.min(this.w, this.h) * 0.22;
    const n = this.bars.length;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const v = this.bars[i]!;
      const len = 18 + v * radius * 1.35;
      const x0 = Math.cos(ang) * radius;
      const y0 = Math.sin(ang) * radius;
      const x1 = Math.cos(ang) * (radius + len);
      const y1 = Math.sin(ang) * (radius + len);
      ctx.strokeStyle = `hsla(${this.hue + (i / n) * 40 - 10}, 92%, ${58 + v * 28}%, ${0.35 + v * 0.55})`;
      ctx.lineWidth = Math.max(2, (Math.PI * 2 * radius) / n - 1.4);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      const peak = this.peaks[i]!;
      const px = Math.cos(ang) * (radius + 18 + peak * radius * 1.35 + 6);
      const py = Math.sin(ang) * (radius + 18 + peak * radius * 1.35 + 6);
      ctx.fillStyle = `hsla(${this.hue}, 100%, 90%, ${0.35 + peak * 0.4})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.rotate(-this.rot * 2.2);
    ctx.strokeStyle = `hsla(${this.hue + 20}, 90%, 80%, ${0.18 + a.mid * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius * (0.72 + a.lowMid * 0.15), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawCenter(a: Analysis) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h * 0.46;
    const r = Math.min(this.w, this.h) * (0.07 + a.bass * 0.08);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
    g.addColorStop(0, `hsla(${this.hue}, 90%, 92%, ${0.55 + a.bass * 0.4})`);
    g.addColorStop(0.35, `hsla(${this.hue}, 90%, 60%, ${0.2 + a.energy * 0.25})`);
    g.addColorStop(1, "hsla(190, 80%, 40%, 0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${this.hue}, 80%, 96%, ${0.55 + a.bass * 0.35})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHorizonWave(a: Analysis, wave: Uint8Array) {
    const ctx = this.ctx;
    const y = this.h * 0.78;
    const step = Math.max(1, Math.floor(wave.length / Math.max(80, this.w / 4)));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let i = 0; i < wave.length; i += step) {
      const x = (i / wave.length) * this.w;
      const v = (wave[i]! - 128) / 128;
      ctx.lineTo(x, y + v * (28 + a.energy * 70));
    }
    ctx.strokeStyle = `hsla(${this.hue}, 90%, 78%, ${0.22 + a.energy * 0.35})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  private drawWaves(a: Analysis, wave: Uint8Array) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const bands = 5;
    for (let b = 0; b < bands; b++) {
      const y = this.h * (0.22 + b * 0.14);
      const amp = (18 + b * 10) * (0.45 + a.energy);
      const hue = this.hue + b * 12;
      ctx.beginPath();
      const step = 4;
      for (let x = 0; x <= this.w; x += step) {
        const wi = Math.floor((x / this.w) * (wave.length - 1));
        const v = (wave[wi]! - 128) / 128;
        const wobble = Math.sin(x * 0.01 + this.t * (1 + b * 0.2) + b) * a.mid * 10;
        const yy = y + v * amp * (1 - b * 0.08) + wobble;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = `hsla(${hue}, 90%, ${62 + b * 4}%, ${0.18 + a.energy * 0.22})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStorm(a: Analysis) {
    if (a.flux < 0.04 && !a.beat) return;
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h * 0.46;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `hsla(${this.hue}, 100%, 88%, ${0.12 + a.flux * 1.4})`;
    ctx.lineWidth = 1;
    const bolts = a.beat ? 5 : 2;
    for (let b = 0; b < bolts; b++) {
      const ang = this.rot * 3 + b * 1.3 + a.high * 4;
      let x = cx;
      let y = cy;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 8;
      for (let s = 0; s < segs; s++) {
        const dist = (s + 1) * (18 + a.energy * 28);
        x = cx + Math.cos(ang) * dist + (Math.random() - 0.5) * 24;
        y = cy + Math.sin(ang) * dist + (Math.random() - 0.5) * 24;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFloods(a: Analysis) {
    const ctx = this.ctx;
    const wash = ctx.createLinearGradient(0, 0, 0, this.h * 0.34);
    const top = 0.1 + a.bass * 0.18 + this.flash * 0.42;
    wash.addColorStop(0, `hsla(${this.hue}, 100%, 68%, ${top})`);
    wash.addColorStop(0.45, `hsla(${this.hue + 20}, 90%, 50%, ${top * 0.35})`);
    wash.addColorStop(1, `hsla(${this.hue}, 80%, 40%, 0)`);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, this.w, this.h * 0.36);
    const xs = [0.22, 0.5, 0.78];
    for (let i = 0; i < xs.length; i++) {
      const x = this.w * xs[i]!;
      const kickHit = i === this.floodSlot ? 1 : 0;
      const hatHit = i === (this.floodSlot + 1) % 3 ? a.high : 0;
      const pulse = kickHit * (a.bass + this.flash) + hatHit * 0.6;
      const r = this.w * (0.14 + pulse * 0.1);
      const g = ctx.createRadialGradient(x, 8, 4, x, 12, r);
      g.addColorStop(0, `hsla(${this.hue + i * 120}, 100%, 70%, ${0.04 + pulse * 0.55})`);
      g.addColorStop(0.45, `hsla(${this.hue + i * 120}, 100%, 52%, ${0.02 + pulse * 0.22})`);
      g.addColorStop(1, `hsla(${this.hue + i * 120}, 90%, 40%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, 0, r * 2, r * 1.3);
    }
    ctx.restore();
  }

  private drawLasers(a: Analysis) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h * 0.5;
    const n = 4;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const side = i < 2 ? -1 : 1;
      const k = i % 2;
      const ox = cx + side * (this.w * 0.16 + k * this.w * 0.1);
      const oy = -20;
      const sway = Math.sin(this.t * (0.5 + k * 0.12) + i) * this.w * 0.08;
      const tx = cx + sway * 0.25;
      const ty = cy + 40 + Math.sin(this.t * 0.7 + i) * 16;
      const alpha = 0.06 + a.energy * 0.1 + this.flash * 0.4 + (i % 2 ? a.high : a.bass) * 0.1;
      ctx.strokeStyle = `hsla(${this.hue + i * 22}, 100%, 58%, ${alpha})`;
      ctx.lineWidth = 1.4 + this.flash * 6 + a.bass * 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.restore();
  }

  private burst(a: Analysis, extra = 28) {
    const cx = this.w / 2;
    const cy = this.h * 0.46;
    const count = Math.min(extra + Math.floor(a.bass * 36), PARTICLE_CAP - this.particles.length);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * (180 + a.energy * 220);
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1,
        max: 0.6 + Math.random() * 0.8,
        size: 1.2 + Math.random() * 2.8,
        hue: this.hue + Math.random() * 30 - 10,
      });
    }
  }

  private stepParticles(dt: number, a: Analysis) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const drag = 0.985 - a.energy * 0.02;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt / p.max;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      ctx.fillStyle = `hsla(${p.hue}, 90%, 78%, ${p.life * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (this.particles.length > PARTICLE_CAP) this.particles.splice(0, this.particles.length - PARTICLE_CAP);
  }

  private drawTitle(a: Analysis) {
    if (!this.title) return;
    const ctx = this.ctx;
    const cx = this.w / 2;
    const y = this.h * 0.46;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(238,240,244,${0.08 + a.energy * 0.1})`;
    ctx.font = `600 ${Math.max(18, Math.min(this.w * 0.046, 42))}px Syne, sans-serif`;
    ctx.fillText(this.title, cx, y);
    if (this.artist) {
      ctx.font = `500 ${Math.max(11, Math.min(this.w * 0.016, 14))}px Outfit, sans-serif`;
      ctx.fillStyle = `rgba(139,144,156,${0.35 + a.energy * 0.2})`;
      ctx.fillText(this.artist.toUpperCase(), cx, y + Math.max(22, this.w * 0.028));
    }
    ctx.restore();
  }

  private drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.25,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.72,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(4,4,7,0.72)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}
