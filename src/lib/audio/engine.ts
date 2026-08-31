import { DemoLoop } from "./demo";
import { mapTrack, type TrackMap } from "./map-track";
import type { Analysis } from "./types";

const FFT = 2048;
const EMPTY: Analysis = {
  bass: 0,
  lowMid: 0,
  mid: 0,
  high: 0,
  energy: 0,
  beat: false,
  hat: false,
  drop: false,
  flux: 0,
  bpm: 128,
  beatPhase: 0,
  barBeat: 0,
  confidence: 0,
};

const TEMPOS = [100, 105, 110, 112, 115, 120, 122, 124, 126, 128, 130, 132, 135, 140, 145, 150, 160, 174];

function avgRange(data: Uint8Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, data.length);
  const start = Math.max(0, from);
  if (end <= start) return 0;
  for (let i = start; i < end; i++) sum += data[i]!;
  return sum / (end - start) / 255;
}

function mean(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function snapTempo(bpm: number) {
  let best = 128;
  let d = Infinity;
  for (const t of TEMPOS) {
    const e = Math.abs(t - bpm);
    if (e < d) {
      d = e;
      best = t;
    }
  }
  return best;
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
  private lastHat = 0;
  private lastDrop = 0;
  private lastSample = 0;
  private bpm = 128;
  private phase = 0;
  private confidence = 0;
  private iois: number[] = [];
  private highHist: number[] = [];
  private objectUrl: string | null = null;
  private volume = 0.85;
  private muted = false;
  private mapGen = 0;
  trackMap: TrackMap | null = null;
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

  private resetClock() {
    this.iois = [];
    this.highHist = [];
    this.phase = 0;
    this.bpm = 128;
    this.confidence = 0;
    this.lastBeat = 0;
    this.lastHat = 0;
    this.lastDrop = 0;
    this.lastSample = 0;
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
    this.resetClock();
    this.clearMap();
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
    this.resetClock();
    this.clearMap();
    await this.element.play();
  }

  async scanFile(file: File): Promise<TrackMap | null> {
    const id = ++this.mapGen;
    this.trackMap = null;
    try {
      this.unlock();
      const raw = await file.arrayBuffer();
      const ctx = this.ctx;
      if (!ctx || id !== this.mapGen) return null;
      const audio = await ctx.decodeAudioData(raw.slice(0));
      if (id !== this.mapGen) return null;
      const map = mapTrack(audio);
      if (id !== this.mapGen) return null;
      this.trackMap = map;
      this.bpm = map.bpm;
      return map;
    } catch {
      return null;
    }
  }

  clearMap() {
    this.mapGen += 1;
    this.trackMap = null;
  }

  playDemo() {
    this.unlock();
    this.element.pause();
    this.demoGain?.gain.setTargetAtTime(1, this.ctx!.currentTime, 0.02);
    this.demo?.start();
    this.mode = "demo";
    this.resetClock();
    this.bpm = 128;
    this.clearMap();
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
    const energy = bass * 0.72 + lowMid * 0.18 + mid * 0.07 + high * 0.03;

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
    const now = this.ctx?.currentTime ?? 0;
    const dt = this.lastSample ? Math.min(0.05, Math.max(0, now - this.lastSample)) : 0.016;
    this.lastSample = now;

    const playing = this.isPlaying();
    if (playing) this.phase += dt * (this.bpm / 60);

    const beat =
      bass > bassAvg * 1.22 + 0.05 && bass > 0.12 && now - this.lastBeat > 0.18;
    if (beat) {
      if (this.lastBeat > 0) {
        const ioi = now - this.lastBeat;
        if (ioi > 0.22 && ioi < 1.05) {
          this.iois.push(ioi);
          if (this.iois.length > 16) this.iois.shift();
          let est = 60 / Math.max(0.25, median(this.iois));
          while (est < 90) est *= 2;
          while (est > 180) est /= 2;
          const snapped = snapTempo(est);
          this.bpm += (snapped - this.bpm) * 0.08;
          const spread = mean(this.iois.map((x) => Math.abs(x - median(this.iois))));
          this.confidence = Math.max(0, 1 - spread / Math.max(median(this.iois), 0.01));
        }
      }
      this.lastBeat = now;
      const nearest = Math.round(this.phase);
      const err = this.phase - nearest;
      if (Math.abs(err) < 0.4) this.phase = nearest;
      else this.phase += (err > 0 ? 1 - err : -1 - err) * 0.45;
    }

    this.highHist.push(high);
    if (this.highHist.length > 24) this.highHist.shift();
    const highAvg = mean(this.highHist);
    const hat =
      playing && high > highAvg * 1.26 + 0.05 && high > 0.13 && now - this.lastHat > 0.1;
    if (hat) this.lastHat = now;

    const recentBass = this.bassHist.slice(-24);
    const recentBassAvg = recentBass.reduce((a, b) => a + b, 0) / Math.max(1, recentBass.length);
    const drop =
      bass > 0.22 &&
      bass > bassAvg * 1.35 &&
      bass > recentBassAvg * 1.4 &&
      now - this.lastDrop > 2.2;
    if (drop) this.lastDrop = now;

    return {
      analysis: {
        bass,
        lowMid,
        mid,
        high,
        energy,
        beat,
        hat,
        drop,
        flux,
        bpm: this.bpm,
        beatPhase: ((this.phase % 1) + 1) % 1,
        barBeat: ((Math.floor(this.phase) % 8) + 8) % 8,
        confidence: this.confidence,
      },
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
