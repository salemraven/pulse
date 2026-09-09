const TEMPOS = [100, 105, 110, 112, 115, 120, 122, 124, 126, 128, 130, 132, 135, 140, 145, 150, 160, 174];

export type CueKind = "drop" | "phrase" | "break" | "build";

export type DanceCue = {
  t: number;
  kind: CueKind;
  energy: number;
};

export type TrackMap = {
  bpm: number;
  duration: number;
  cues: DanceCue[];
  drops: number;
  beats: number[];
  confidence: number;
};

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

function smooth(src: Float32Array, radius: number) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= src.length) continue;
      s += src[j]!;
      n += 1;
    }
    out[i] = s / Math.max(1, n);
  }
  return out;
}

export function gridBeats(seconds: number, bpm: number) {
  const beat = 60 / Math.max(60, bpm);
  const out: number[] = [];
  for (let t = 0; t < seconds; t += beat) out.push(t);
  return out;
}

export function beatAt(map: TrackMap, t: number) {
  const bpm = Math.max(60, map.bpm);
  const period = 60 / bpm;
  if (!map.beats.length) {
    const i = Math.round(t / period);
    const at = i * period;
    return { at, next: at + period, phase: ((t / period) % 1 + 1) % 1, i };
  }
  let lo = 0;
  let hi = map.beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map.beats[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(0, lo);
  const at = map.beats[i] ?? t;
  const prev = map.beats[Math.max(0, i - 1)] ?? at - period;
  const next = map.beats[Math.min(map.beats.length - 1, i + (at < t ? 1 : 0))] ?? at + period;
  const nearest = Math.abs(t - at) <= Math.abs(t - prev) ? at : prev;
  const span = Math.max(1e-4, next - nearest);
  return { at: nearest, next, phase: (t - nearest) / span, i };
}

export function houseLoopMap(seconds = 600): TrackMap {
  const bpm = 128;
  const beat = 60 / bpm;
  const cues: DanceCue[] = [];
  let drops = 0;
  for (let i = 16; i * beat < seconds; i += 16) {
    const t = i * beat;
    const isDrop = i % 32 === 0;
    cues.push({ t, kind: isDrop ? "drop" : "phrase", energy: isDrop ? 1 : 0.55 });
    if (isDrop) drops += 1;
  }
  return { bpm, duration: seconds, cues, drops, beats: gridBeats(seconds, bpm), confidence: 1 };
}

export function mapTrack(buffer: AudioBuffer): TrackMap {
  const sr = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const hop = Math.max(256, Math.floor(sr * 0.02));
  const win = hop * 2;
  const hops = Math.max(1, Math.floor((left.length - win) / hop));
  const bass = new Float32Array(hops);
  const rms = new Float32Array(hops);
  const coef = Math.exp((-2 * Math.PI * 110) / sr);

  for (let h = 0; h < hops; h++) {
    const start = h * hop;
    let b = 0;
    let e = 0;
    let lp = 0;
    for (let i = 0; i < win; i++) {
      let s = left[start + i] ?? 0;
      if (right) s = (s + (right[start + i] ?? 0)) * 0.5;
      lp = coef * lp + (1 - coef) * s;
      b += lp * lp;
      e += s * s;
    }
    bass[h] = Math.sqrt(b / win);
    rms[h] = Math.sqrt(e / win);
  }

  const smB = smooth(bass, 4);
  const smE = smooth(rms, 8);
  const hopT = hop / sr;
  const midBass = median(Array.from(smB));
  const midE = median(Array.from(smE));
  const floor = Math.max(0.008, midBass * 0.35);

  const onsets: number[] = [];
  for (let i = 2; i < hops - 2; i++) {
    const v = smB[i]!;
    if (v > smB[i - 1]! && v > smB[i + 1]! && v > smB[i - 2]! * 1.18 && v > floor) {
      const t = i * hopT;
      if (!onsets.length || t - onsets[onsets.length - 1]! > 0.18) onsets.push(t);
    }
  }

  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i]! - onsets[i - 1]!;
    if (d > 0.22 && d < 1.05) iois.push(d);
  }
  let bpm = 128;
  let confidence = 0.35;
  if (iois.length > 6) {
    let est = 60 / Math.max(0.25, median(iois));
    while (est < 90) est *= 2;
    while (est > 180) est /= 2;
    bpm = snapTempo(est);
    confidence = Math.min(1, 0.45 + iois.length / 80);
  }

  const beat = 60 / bpm;
  const look = Math.round(2.6 / hopT);
  const quiet = Math.round(0.5 / hopT);
  const dropTs: number[] = [];

  for (let i = look; i < hops - 4; i++) {
    const now = smB[i]!;
    let prev = 0;
    const end = i - quiet;
    const start = i - look;
    for (let j = start; j < end; j++) prev += smB[j]!;
    prev /= Math.max(1, end - start);
    const rising = smB[i]! > smB[i - 3]! * 1.12;
    if (now > prev * 1.5 && now > midBass * 1.05 && now > 0.016 && rising) {
      const t = Math.round((i * hopT) / beat) * beat;
      if (!dropTs.length || t - dropTs[dropTs.length - 1]! > beat * 8) dropTs.push(t);
    }
  }

  const cues: DanceCue[] = [];
  const addCue = (t: number, kind: CueKind, energy: number) => {
    if (t < 2 || t > buffer.duration - 2) return;
    if (cues.some((c) => Math.abs(c.t - t) < beat * 4 && c.kind === kind)) return;
    cues.push({ t, kind, energy });
  };

  for (const t of dropTs) {
    const h = Math.min(hops - 1, Math.max(0, Math.round(t / hopT)));
    addCue(t, "drop", smB[h] ?? 1);
  }

  const winH = Math.max(8, Math.round(2.5 / hopT));
  for (let i = winH; i < hops - winH; i += Math.max(4, Math.round(0.5 / hopT))) {
    let before = 0;
    let now = 0;
    let after = 0;
    for (let k = 0; k < winH; k++) {
      before += smE[i - winH + k] ?? 0;
      now += smE[i + k] ?? 0;
      after += smE[Math.min(hops - 1, i + winH + k)] ?? 0;
    }
    before /= winH;
    now /= winH;
    after /= winH;
    const t = i * hopT;
    if (now < midE * 0.45 && before > midE * 0.7) addCue(t, "break", now);
    else if (now > before * 1.35 && after > now * 1.08 && now > midE * 0.8) addCue(t, "build", now);
  }

  const phrase = beat * 16;
  const offset = dropTs[0] != null ? dropTs[0] % phrase : 0;
  for (let t = Math.max(phrase, offset || phrase); t < buffer.duration - 3; t += phrase) {
    if (t < 6) continue;
    if (cues.some((c) => Math.abs(c.t - t) < beat * 6)) continue;
    const h = Math.min(hops - 1, Math.max(0, Math.round(t / hopT)));
    const local = smB[h] ?? 0;
    if (local < floor * 1.2) continue;
    addCue(t, "phrase", local);
  }
  cues.sort((a, b) => a.t - b.t);

  const beats: number[] = [];
  const period = beat;
  let t0 = onsets[0] ?? 0;
  t0 = t0 - Math.round(t0 / period) * period;
  if (t0 < 0) t0 += period;
  for (let t = t0; t < buffer.duration; t += period) beats.push(t);

  return {
    bpm,
    duration: buffer.duration,
    cues,
    drops: cues.filter((c) => c.kind === "drop").length,
    beats,
    confidence,
  };
}
