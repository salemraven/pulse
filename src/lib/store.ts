import { create } from "zustand";
import type { CoreStyle, SearchHit, Track, VizMode } from "@/lib/audio/types";

type PulseState = {
  track: Track | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  mode: VizMode;
  core: CoreStyle;
  error: string | null;
  dragging: boolean;
  searching: boolean;
  hits: SearchHit[];
  query: string;
  chrome: boolean;
  set: (partial: Partial<PulseState>) => void;
};

export const usePulse = create<PulseState>((set) => ({
  track: null,
  playing: false,
  volume: 0.85,
  muted: false,
  mode: "auto",
  core: "dancer",
  error: null,
  dragging: false,
  searching: false,
  hits: [],
  query: "",
  chrome: true,
  set: (partial) => {
    if (typeof window !== "undefined") {
      try {
        if (partial.mode) localStorage.setItem("pulse.mode", partial.mode);
        if (partial.core) localStorage.setItem("pulse.core", partial.core);
      } catch {
        /* ignore */
      }
    }
    set(partial);
  },
}));
