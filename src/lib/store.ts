import { create } from "zustand";
import type { CoreStyle, Track, VizMode } from "@/lib/audio/types";

type PulseState = {
  track: Track | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  mode: VizMode;
  core: CoreStyle;
  error: string | null;
  dragging: boolean;
  chrome: boolean;
  mapping: boolean;
  mapLabel: string;
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
  chrome: true,
  mapping: false,
  mapLabel: "",
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