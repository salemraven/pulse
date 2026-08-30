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
  { id: "dancer", label: "Kachujin" },
];

export type TrackSource = "file" | "search" | "demo";

export type Track = {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  source: TrackSource;
  preview?: boolean;
};

export type SearchHit = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  previewUrl: string;
};

export type Analysis = {
  bass: number;
  lowMid: number;
  mid: number;
  high: number;
  energy: number;
  beat: boolean;
  drop: boolean;
  flux: number;
};
