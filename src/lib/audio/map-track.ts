const TEMPOS = [100, 105, 110, 112, 115, 120, 122, 124, 126, 128, 130, 132, 135, 140, 145, 150, 160, 174];

export type DanceCue = {
  t: number;
  kind: "drop" | "phrase";
  energy: number;
};

export type TrackMap = {
  bpm: number;
  duration: number;
  cues: DanceCue[];
  drops: number;
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

export function mapTrack(buffer: AudioBuffer): TrackMap {
  const sr = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const hop = Math.max(256, Math.floor(sr * 0.02));
  const win = hop * 2;
  const hops = Math.max(1, Math.floor((left.length - win) / hop));
  const bass = new Float32Array(hops);
  const coef = Math.exp((-2 * Math.PI * 110) / sr);

  for (let h = 0; h < hops; h++) {
    const start = h * hop;
    let b = 0;
    let lp = 0;
    for (let i = 0; i < win; i++) {
      let s = left[start + i] ?? 0;
      if (right) s = (s + (right[start + i] ?? 0)) * 0.5;
      lp = coef * lp + (1 - coef) * s;
      b += lp * lp;
    }
    bass[h] = Math.sqrt(b / win);
  }

  const smB = smooth(bass, 4);
  const hopT = hop / sr;
  const midBass = median(Array.from(smB));
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
  if (iois.length > 6) {
    let est = 60 / Math.max(0.25, median(iois));
    while (est < 90) est *= 2;
    while (est > 180) est /= 2;
    bpm = snapTempo(est);
  }

  const beat = 60 / bpm;
  const look = Math.round(2.6 / hopT);
  const quiet = Math.round(0.5 / hopT);
  const drops: number[] = [];

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
      if (!drops.length || t - drops[drops.length - 1]! > beat * 8) drops.push(t);
    }
  }

  const cues: DanceCue[] = [];
  for (const t of drops) {
    if (t > 4 && t < buffer.duration - 3) {
      const h = Math.min(hops - 1, Math.max(0, Math.round(t / hopT)));
      cues.push({ t, kind: "drop", energy: smB[h] ?? 1 });
    }
  }

  const phrase = beat * 16;
  const offset = drops[0] != null ? drops[0] % phrase : 0;
  for (let t = Math.max(phrase, offset || phrase); t < buffer.duration - 3; t += phrase) {
    if (t < 6) continue;
    if (cues.some((c) => Math.abs(c.t - t) < beat * 6)) continue;
    const h = Math.min(hops - 1, Math.max(0, Math.round(t / hopT)));
    const local = smB[h] ?? 0;
    if (local < floor * 1.2) continue;
    cues.push({ t, kind: "phrase", energy: local });
  }
  cues.sort((a, b) => a.t - b.t);

  return { bpm, duration: buffer.duration, cues, drops: drops.length };
}