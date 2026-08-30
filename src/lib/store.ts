import { create } from "zustand";
import type { SearchHit, Track, VizMode } from "@/lib/audio/types";

type PulseState = {
  track: Track | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  mode: VizMode;
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
  error: null,
  dragging: false,
  searching: false,
  hits: [],
  query: "",
  chrome: true,
  set: (partial) => {
    if (partial.mode && typeof window !== "undefined") {
      try {
        localStorage.setItem("pulse.mode", partial.mode);
      } catch {
        /* ignore */
      }
    }
    set(partial);
  },
}));
