export type VizMode = "auto" | "orbital" | "tunnel" | "grid" | "storm" | "wave";

export const VIZ_MODES: { id: VizMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "orbital", label: "Orbital" },
  { id: "tunnel", label: "Tunnel" },
  { id: "grid", label: "Grid" },
  { id: "storm", label: "Storm" },
  { id: "wave", label: "Wave" },
];

export type CoreStyle = "ring" | "dancer";

export const CORE_STYLES: { id: CoreStyle; label: string }[] = [
  { id: "ring", label: "Ring" },
  { id: "dancer", label: "Michelle" },
];

export type TrackSource = "file" | "demo";

export type Track = {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  source: TrackSource;
};

export type Analysis = {
  bass: number;
  lowMid: number;
  mid: number;
  high: number;
  energy: number;
  beat: boolean;
  hat: boolean;
  drop: boolean;
  flux: number;
  bpm: number;
  beatPhase: number;
  barBeat: number;
  confidence: number;
};
