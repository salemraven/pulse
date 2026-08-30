import { DemoLoop } from "./demo";
import type { Analysis } from "./types";

const FFT = 2048;
const EMPTY: Analysis = {
  bass: 0,
  lowMid: 0,
  mid: 0,
  high: 0,
  energy: 0,
  beat: false,
  drop: false,
  flux: 0,
};

function avgRange(data: Uint8Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, data.length);
  const start = Math.max(0, from);
  if (end <= start) return 0;
  for (let i = start; i < end; i++) sum += data[i]!;
  return sum / (end - start) / 255;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  readonly element: HTMLAudioElement;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private master: GainNode | null = null;
  private demo: DemoLoop | null = null;
  private demoGain: GainNode | null = null;
  private freq = new Uint8Array(FFT / 2);
  private wave = new Uint8Array(FFT);
  private prevSpectrum = new Float32Array(FFT / 2);
  private bassHist: number[] = [];
  private energyHist: number[] = [];
  private lastBeat = 0;
  private lastDrop = 0;
  private objectUrl: string | null = null;
  private volume = 0.85;
  private muted = false;
  mode: "idle" | "file" | "demo" = "idle";

  constructor() {
    this.element = document.createElement("audio");
    this.element.crossOrigin = "anonymous";
    this.element.preload = "auto";
    this.element.setAttribute("playsinline", "true");
  }

  get ready() {
    return this.ctx != null;
  }

  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "playback" });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0.62;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -18;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume * this.volume;
      analyser.connect(master);
      master.connect(ctx.destination);

      const media = ctx.createMediaElementSource(this.element);
      media.connect(analyser);

      const demoGain = ctx.createGain();
      demoGain.gain.value = 0;
      demoGain.connect(analyser);

      this.ctx = ctx;
      this.analyser = analyser;
      this.master = master;
      this.mediaSource = media;
      this.demoGain = demoGain;
      this.demo = new DemoLoop(ctx, demoGain);
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.wave = new Uint8Array(analyser.fftSize);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyGain();
  }

  getVolume() {
    return this.volume;
  }

  isMuted() {
    return this.muted;
  }

  private applyGain() {
    const g = this.master?.gain;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const target = this.muted ? 0 : this.volume * this.volume;
    g.setTargetAtTime(target, ctx.currentTime, 0.03);
  }

  async loadUrl(url: string) {
    this.unlock();
    this.stopDemo();
    this.revoke();
    this.element.src = url;
    this.element.load();
    this.mode = "file";
    await this.element.play();
  }

  async loadFile(file: File) {
    this.unlock();
    this.stopDemo();
    this.revoke();
    this.objectUrl = URL.createObjectURL(file);
    this.element.src = this.objectUrl;
    this.element.load();
    this.mode = "file";
    await this.element.play();
  }

  playDemo() {
    this.unlock();
    this.element.pause();
    this.demoGain?.gain.setTargetAtTime(1, this.ctx!.currentTime, 0.02);
    this.demo?.start();
    this.mode = "demo";
  }

  private stopDemo() {
    this.demo?.stop();
    if (this.demoGain && this.ctx) {
      this.demoGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
  }

  play() {
    this.unlock();
    if (this.mode === "demo") {
      this.playDemo();
      return;
    }
    void this.element.play();
  }

  pause() {
    if (this.mode === "demo") {
      this.stopDemo();
      return;
    }
    this.element.pause();
  }

  seek(t: number) {
    if (this.mode === "demo") return;
    if (Number.isFinite(this.element.duration)) {
      this.element.currentTime = Math.max(0, Math.min(t, this.element.duration));
    }
  }

  getCurrentTime() {
    if (this.mode === "demo") return this.ctx?.currentTime ?? 0;
    return this.element.currentTime || 0;
  }

  getDuration() {
    if (this.mode === "demo") return Infinity;
    const d = this.element.duration;
    return Number.isFinite(d) ? d : 0;
  }

  isPlaying() {
    if (this.mode === "demo") return this.demo?.playing ?? false;
    return !this.element.paused && !this.element.ended;
  }

  sample(): { analysis: Analysis; freq: Uint8Array; wave: Uint8Array } {
    const analyser = this.analyser;
    if (!analyser) {
      return { analysis: { ...EMPTY }, freq: this.freq, wave: this.wave };
    }
    analyser.getByteFrequencyData(this.freq);
    analyser.getByteTimeDomainData(this.wave);

    const bass = avgRange(this.freq, 1, 6);
    const lowMid = avgRange(this.freq, 6, 18);
    const mid = avgRange(this.freq, 18, 60);
    const high = avgRange(this.freq, 60, 180);
    const energy = bass * 0.45 + lowMid * 0.25 + mid * 0.2 + high * 0.1;

    let flux = 0;
    const bins = Math.min(80, this.freq.length);
    for (let i = 0; i < bins; i++) {
      const v = this.freq[i]! / 255;
      const d = v - this.prevSpectrum[i]!;
      if (d > 0) flux += d;
      this.prevSpectrum[i] = v;
    }
    flux /= bins;

    this.bassHist.push(bass);
    this.energyHist.push(energy);
    if (this.bassHist.length > 32) this.bassHist.shift();
    if (this.energyHist.length > 180) this.energyHist.shift();

    const bassAvg = this.bassHist.reduce((a, b) => a + b, 0) / this.bassHist.length;
    const energyAvg = this.energyHist.reduce((a, b) => a + b, 0) / this.energyHist.length;
    const now = this.ctx?.currentTime ?? 0;
    const beat =
      bass > bassAvg * 1.32 + 0.08 && bass > 0.18 && now - this.lastBeat > 0.2;
    if (beat) this.lastBeat = now;

    const recent = this.energyHist.slice(-48);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
    const quietBefore = energyAvg < 0.38;
    const drop =
      energy > 0.48 &&
      energy > recentAvg * 1.45 &&
      quietBefore &&
      now - this.lastDrop > 2.4;
    if (drop) this.lastDrop = now;

    return {
      analysis: { bass, lowMid, mid, high, energy, beat, drop, flux },
      freq: this.freq,
      wave: this.wave,
    };
  }

  private revoke() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  dispose() {
    this.stopDemo();
    this.element.pause();
    this.element.removeAttribute("src");
    this.revoke();
    void this.ctx?.close();
    this.ctx = null;
  }
}

let singleton: AudioEngine | null = null;

export function getEngine(): AudioEngine {
  if (!singleton) singleton = new AudioEngine();
  return singleton;
}
