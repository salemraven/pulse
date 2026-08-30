/**
 * A looping 128 BPM house sketch — kick, clap, hats, bass, and a minor stab —
 * so PULSE has a real signal the moment someone hits play.
 */

const BPM = 128;
const BEAT = 60 / BPM;

type Voice = {
  stop: () => void;
};

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function envGain(
  ctx: AudioContext,
  dest: AudioNode,
  start: number,
  attack: number,
  decay: number,
  peak = 1,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  g.connect(dest);
  return g;
}

export class DemoLoop {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private nextBar = 0;
  private voices: Voice[] = [];
  private bar = 0;
  playing = false;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(dest);
    this.noise = noiseBuffer(ctx, 1);
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.bar = 0;
    this.nextBar = this.ctx.currentTime + 0.05;
    this.schedule();
  }

  stop() {
    this.playing = false;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const v of this.voices) v.stop();
    this.voices = [];
  }

  private schedule = () => {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    while (this.nextBar < now + 0.6) {
      this.scheduleBar(this.nextBar, this.bar);
      this.nextBar += BEAT * 4;
      this.bar += 1;
    }
    this.timer = window.setTimeout(this.schedule, 120);
  };

  private track(node: AudioScheduledSourceNode): void {
    const voice: Voice = {
      stop: () => {
        try {
          node.stop();
        } catch {
          /* already stopped */
        }
      },
    };
    this.voices.push(voice);
    node.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }

  private scheduleBar(t0: number, bar: number) {
    const ctx = this.ctx;
    const drop = bar % 8 >= 4;
    const build = bar % 8 === 3;

    for (let beat = 0; beat < 4; beat++) {
      const t = t0 + beat * BEAT;
      this.kick(t);
      if (beat === 1 || beat === 3) this.clap(t, drop ? 0.55 : 0.38);
      this.hat(t, 0.22);
      this.hat(t + BEAT / 2, beat % 2 === 1 ? 0.16 : 0.1);
      if (drop) {
        this.hat(t + BEAT / 4, 0.07);
        this.hat(t + (BEAT * 3) / 4, 0.07);
      }
    }

    const bassNotes = [36, 36, 39, 31];
    for (let i = 0; i < 4; i++) {
      const note = bassNotes[(bar + i) % 4]!;
      this.bass(t0 + i * BEAT, note, drop ? 0.42 : 0.32);
    }

    if (drop || bar % 2 === 0) {
      const chord = [60, 63, 67];
      this.stab(t0 + BEAT * 1.5, chord, drop ? 0.14 : 0.09);
    }

    if (drop) {
      const arp = [72, 75, 79, 75, 72, 70, 67, 70];
      for (let i = 0; i < 8; i++) {
        this.arp(t0 + i * (BEAT / 2), arp[i]!, 0.07);
      }
    }

    if (build) {
      this.riser(t0, BEAT * 4);
    }
  }

  private kick(time: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.08);
    const g = envGain(this.ctx, this.out, time, 0.004, 0.28, 1);
    osc.connect(g);
    osc.start(time);
    osc.stop(time + 0.32);
    this.track(osc);

    const click = this.ctx.createBufferSource();
    click.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;
    const cg = envGain(this.ctx, this.out, time, 0.001, 0.02, 0.22);
    click.connect(hp);
    hp.connect(cg);
    click.start(time);
    click.stop(time + 0.03);
    this.track(click);
  }

  private clap(time: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = envGain(this.ctx, this.out, time, 0.002, 0.18, peak);
    src.connect(bp);
    bp.connect(g);
    src.start(time);
    src.stop(time + 0.22);
    this.track(src);
  }

  private hat(time: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 8000;
    const g = envGain(this.ctx, this.out, time, 0.001, 0.045, peak);
    src.connect(hp);
    hp.connect(g);
    src.start(time);
    src.stop(time + 0.06);
    this.track(src);
  }

  private bass(time: number, midi: number, peak: number) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, time);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(420, time);
    lp.frequency.exponentialRampToValueAtTime(140, time + 0.28);
    const g = envGain(this.ctx, this.out, time, 0.01, 0.32, peak);
    osc.connect(lp);
    lp.connect(g);
    osc.start(time);
    osc.stop(time + 0.36);
    this.track(osc);
  }

  private stab(time: number, midis: number[], peak: number) {
    for (const midi of midis) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1200;
      const g = envGain(this.ctx, this.out, time, 0.005, 0.22, peak);
      osc.connect(lp);
      lp.connect(g);
      osc.start(time);
      osc.stop(time + 0.28);
      this.track(osc);
    }
  }

  private arp(time: number, midi: number, peak: number) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 400;
    const g = envGain(this.ctx, this.out, time, 0.004, 0.12, peak);
    osc.connect(hp);
    hp.connect(g);
    osc.start(time);
    osc.stop(time + 0.16);
    this.track(osc);
  }

  private riser(time: number, dur: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(80, time);
    osc.frequency.exponentialRampToValueAtTime(900, time + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.08, time + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(this.out);
    osc.start(time);
    osc.stop(time + dur + 0.02);
    this.track(osc);
  }
}
