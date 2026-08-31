import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import { getEngine } from "@/lib/audio/engine";
import { readId3 } from "@/lib/audio/id3";
import type { CoreStyle, Track, VizMode } from "@/lib/audio/types";
import { CORE_STYLES, VIZ_MODES } from "@/lib/audio/types";
import { VisualizerRenderer } from "@/lib/visualizer/renderer";
import { attachDancer, type DancerStatus } from "@/lib/dancer/kachujin-scene";
import { usePulse } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn, formatTime } from "@/lib/utils";

const DEMO_TRACK: Track = {
  id: "demo",
  title: "Warehouse Loop",
  artist: "PULSE",
  source: "demo",
};

function isAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|ogg|m4a|aac|flac|mpeg)$/i.test(file.name);
}

export function PulseApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dancerCanvasRef = useRef<HTMLCanvasElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const seekFillRef = useRef<HTMLDivElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);
  const vizRef = useRef<VisualizerRenderer | null>(null);
  const dancerRef = useRef<ReturnType<typeof attachDancer> | null>(null);
  const idleTimer = useRef<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [dancerStatus, setDancerStatus] = useState<DancerStatus>("loading");
  const [dancerDetail, setDancerDetail] = useState("Loading Mixamo Michelle…");
  const moveLabelRef = useRef<HTMLSpanElement>(null);

  const track = usePulse((s) => s.track);
  const playing = usePulse((s) => s.playing);
  const volume = usePulse((s) => s.volume);
  const muted = usePulse((s) => s.muted);
  const mode = usePulse((s) => s.mode);
  const core = usePulse((s) => s.core);
  const error = usePulse((s) => s.error);
  const dragging = usePulse((s) => s.dragging);
  const chrome = usePulse((s) => s.chrome);
  const mapping = usePulse((s) => s.mapping);
  const mapLabel = usePulse((s) => s.mapLabel);

  const bumpChrome = useCallback(() => {
    usePulse.getState().set({ chrome: true });
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      const s = usePulse.getState();
      if (s.playing && !s.dragging) s.set({ chrome: false });
    }, 2800);
  }, []);

  const syncDancerChrome = useCallback(() => {
    const dancer = dancerRef.current;
    const canvas = dancerCanvasRef.current;
    if (!dancer || !canvas) return;
    const h = canvas.clientHeight || window.innerHeight;
    const header = headerRef.current?.getBoundingClientRect().height ?? 96;
    const measured = footerRef.current?.getBoundingClientRect().height ?? 0;
    const landing = landingRef.current?.getBoundingClientRect().height ?? 0;
    const footer = (measured > 40 ? measured : Math.max(landing + 16, h * 0.3)) + 18;
    dancer.setChrome(header, footer);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pulse.mode") as VizMode | null;
      if (saved && VIZ_MODES.some((m) => m.id === saved)) {
        usePulse.setState({ mode: saved });
      }
      const savedCore = localStorage.getItem("pulse.core") as CoreStyle | null;
      if (savedCore && CORE_STYLES.some((c) => c.id === savedCore)) {
        usePulse.setState({ core: savedCore });
      }
      usePulse.setState({ core: "dancer" });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = getEngine();
    engineRef.current = engine;
    const viz = new VisualizerRenderer(canvas);
    viz.mode = usePulse.getState().mode;
    viz.hideCenter = usePulse.getState().core === "dancer";
    vizRef.current = viz;
    viz.resize();

    const dancerCanvas = dancerCanvasRef.current;
    if (dancerCanvas) {
      const dancer = attachDancer(dancerCanvas, (status, detail) => {
        setDancerStatus(status);
        if (detail) setDancerDetail(detail);
        if (status === "error") {
          usePulse.getState().set({ error: detail ?? "Michelle did not load." });
        }
      });
      dancer.enabled = usePulse.getState().core === "dancer";
      dancerRef.current = dancer;
      dancer.resize();
      const h = dancerCanvas.clientHeight || window.innerHeight;
      dancer.setChrome(96, h * 0.32);
    }

    const onResize = () => {
      viz.resize();
      dancerRef.current?.resize();
      syncDancerChrome();
    };
    window.addEventListener("resize", onResize);

    const onVis = () => {
      if (document.visibilityState === "visible") engine.resume();
    };
    document.addEventListener("visibilitychange", onVis);

    const audio = engine.element;
    const syncPlay = () => usePulse.getState().set({ playing: engine.isPlaying() });
    const onMeta = () => setDuration(engine.getDuration());
    const onEnded = () => usePulse.getState().set({ playing: false });
    const onErr = () =>
      usePulse.getState().set({ error: "Could not play that file. Try another track.", playing: false });
    audio.addEventListener("play", syncPlay);
    audio.addEventListener("pause", syncPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onErr);

    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sample = engine.sample();
      viz.frame(dt, sample.analysis, sample.freq, sample.wave, engine.isPlaying());
      const look = viz.palette;
      dancerRef.current?.frame(
        dt,
        sample.analysis,
        engine.isPlaying(),
        look.hue,
        look.flash,
        engine.getCurrentTime(),
      );
      if (moveLabelRef.current && dancerRef.current?.clipLabel) {
        moveLabelRef.current.textContent = dancerRef.current.clipLabel;
      }
      const t = engine.getCurrentTime();
      const d = engine.getDuration();
      if (seekFillRef.current && Number.isFinite(d) && d > 0) {
        seekFillRef.current.style.width = `${(t / d) * 100}%`;
      }
      if (timeLabelRef.current) timeLabelRef.current.textContent = formatTime(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      audio.removeEventListener("play", syncPlay);
      audio.removeEventListener("pause", syncPlay);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onErr);
    };
  }, []);

  useEffect(() => {
    if (vizRef.current) vizRef.current.mode = mode;
  }, [mode]);

  useEffect(() => {
    if (vizRef.current) vizRef.current.hideCenter = core === "dancer";
    const dancer = dancerRef.current;
    if (!dancer) return;
    dancer.enabled = core === "dancer";
    if (core === "dancer") {
      dancer.ensureLoaded();
      dancer.resize();
      syncDancerChrome();
    }
  }, [core]);

  useEffect(() => {
    syncDancerChrome();
  }, [track, chrome, dancerStatus, syncDancerChrome]);

  useEffect(() => {
    if (vizRef.current && track) vizRef.current.setTrack(track.title, track.artist);
  }, [track]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const engine = engineRef.current;
      if (!engine) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "KeyF") {
        void toggleFullscreen();
      } else if (e.code === "KeyM") {
        toggleMute();
      } else if (e.code === "ArrowRight") {
        engine.seek(engine.getCurrentTime() + 5);
      } else if (e.code === "ArrowLeft") {
        engine.seek(engine.getCurrentTime() - 5);
      } else if (e.key >= "1" && e.key <= "6") {
        const next = VIZ_MODES[Number(e.key) - 1];
        if (next) usePulse.getState().set({ mode: next.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, track]);

  const loadFile = useCallback(async (file: File) => {
    if (!isAudioFile(file)) {
      usePulse.getState().set({ error: "Drop an MP3, WAV, AAC, or other audio file." });
      return;
    }
    const engine = getEngine();
    engine.unlock();
    let title = file.name.replace(/\.[^.]+$/, "");
    let artist = "Local file";
    let artworkUrl: string | undefined;
    try {
      const meta = await readId3(file);
      if (meta.title) title = meta.title;
      if (meta.artist) artist = meta.artist;
      artworkUrl = meta.artworkUrl;
    } catch {
      /* filename fallback */
    }
    const next: Track = { id: file.name, title, artist, artworkUrl, source: "file" };
    usePulse.getState().set({ track: next, error: null, playing: true, chrome: true, mapping: true, mapLabel: "" });
    vizRef.current?.setTrack(title, artist);
    dancerRef.current?.setMap({ bpm: 128, duration: 0, cues: [], drops: 0 });
    try {
      await engine.loadFile(file);
      setDuration(engine.getDuration());
    } catch {
      usePulse.getState().set({ error: "Could not decode that file.", playing: false, mapping: false });
      return;
    }
    void engine.scanFile(file).then((map) => {
      if (usePulse.getState().track?.id !== file.name) return;
      if (map) {
        dancerRef.current?.setMap(map);
        usePulse.getState().set({
          mapping: false,
          mapLabel: `${Math.round(map.bpm)} BPM · ${map.drops} drop${map.drops === 1 ? "" : "s"} · ${map.cues.length} cues`,
        });
      } else {
        usePulse.getState().set({ mapping: false, mapLabel: "" });
      }
    });
  }, []);

  const playDemo = useCallback(() => {
    const engine = getEngine();
    engine.unlock();
    engine.playDemo();
    dancerRef.current?.setMap(null);
    usePulse.getState().set({
      track: DEMO_TRACK,
      playing: true,
      error: null,
      chrome: true,
      mapping: false,
      mapLabel: "",
    });
    vizRef.current?.setTrack(DEMO_TRACK.title, DEMO_TRACK.artist);
    setDuration(0);
  }, []);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current ?? getEngine();
    if (!usePulse.getState().track) {
      playDemo();
      return;
    }
    engine.unlock();
    if (engine.isPlaying()) {
      engine.pause();
      usePulse.getState().set({ playing: false, chrome: true });
    } else {
      engine.play();
      usePulse.getState().set({ playing: true });
    }
  }, [playDemo]);

  const toggleMute = useCallback(() => {
    const engine = engineRef.current ?? getEngine();
    const next = !usePulse.getState().muted;
    engine.setMuted(next);
    usePulse.getState().set({ muted: next });
  }, []);

  const onVolume = useCallback((v: number) => {
    const engine = engineRef.current ?? getEngine();
    engine.setVolume(v);
    if (v > 0 && usePulse.getState().muted) engine.setMuted(false);
    usePulse.getState().set({ volume: v, muted: v === 0 ? true : false });
  }, []);

  const onSeek = useCallback((clientX: number) => {
    const el = seekRef.current;
    const engine = engineRef.current;
    if (!el || !engine) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const d = engine.getDuration();
    if (Number.isFinite(d) && d > 0) engine.seek(t * d);
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      usePulse.getState().set({ dragging: true, chrome: true });
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget) return;
      usePulse.getState().set({ dragging: false });
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      usePulse.getState().set({ dragging: false });
      const file = e.dataTransfer?.files?.[0];
      if (file) void loadFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [loadFile]);

  const [isFs, setIsFs] = useState(false);
  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setIsFs(false);
    } else {
      await document.documentElement.requestFullscreen();
      setIsFs(true);
    }
  }, []);

  const showLanding = !track;
  const canSeek = track?.source !== "demo" && duration > 0 && Number.isFinite(duration);
  const showDancerHud = core === "dancer" && dancerStatus !== "ready";

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-bg text-fg"
      onPointerMove={bumpChrome}
      onPointerDown={bumpChrome}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <canvas
        ref={dancerCanvasRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-[2] h-full w-full",
          core === "dancer" ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      />

      {showDancerHud ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[3] flex -translate-y-1/2 flex-col items-center px-6 text-center">
          {dancerStatus === "loading" ? (
            <p className="rounded-lg bg-surface/80 px-3 py-2 text-sm text-muted backdrop-blur-sm">
              Loading Mixamo Michelle…
            </p>
          ) : (
            <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-lg bg-surface/90 px-4 py-3 backdrop-blur-sm">
              <p className="text-sm text-fg">{dancerDetail}</p>
              <Button
                variant="outline"
                className="h-9"
                onClick={() => dancerRef.current?.retry()}
              >
                Retry dancer
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {core === "dancer" && dancerStatus === "ready" ? (
        <p className="pointer-events-none absolute top-[max(1.15rem,calc(env(safe-area-inset-top)+0.6rem))] left-1/2 z-[11] -translate-x-1/2 rounded-full bg-surface/20 px-3 py-1 font-mono text-[11px] tracking-[0.18em] text-fg/50 uppercase backdrop-blur-[2px]">
          Michelle · <span ref={moveLabelRef}>Samba</span>
        </p>
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-linear-to-b from-bg/70 via-transparent to-bg/80 transition-opacity duration-200 ease-smooth-out",
          chrome || showLanding || dragging ? "opacity-100" : "opacity-0",
        )}
      />

      <header
        ref={headerRef}
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex flex-col items-stretch gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:flex-row sm:items-start sm:justify-between sm:px-6",
          "transition-[opacity,transform] duration-200 ease-smooth-out",
          chrome || showLanding || dragging
            ? "opacity-100 translate-y-0"
            : "pointer-events-none opacity-0 -translate-y-2",
        )}
      >
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold tracking-tight text-fg">PULSE</p>
          <p className="text-xs text-muted">See the sound</p>
        </div>
      </header>

      {showLanding ? (
        <div
          ref={landingRef}
          className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-center px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex w-full max-w-lg flex-col items-center pb-2 text-center">
            <p className="font-display text-3xl leading-tight font-semibold tracking-tight text-fg sm:text-4xl">
              Drop a track. Watch the room move.
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              Drag in an MP3 or start the house loop. The picture follows bass, mids, and the drop.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button onClick={playDemo} className="h-12 rounded-lg px-5">
                <Play className="size-4 translate-x-px" />
                Play house loop
              </Button>
              <Button
                variant="outline"
                className="h-12 rounded-lg px-5"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />
                Choose file
              </Button>
            </div>
            {error ? <p className="mt-4 text-sm text-muted">{error}</p> : null}
          </div>
        </div>
      ) : null}

      {!showLanding ? (
      <footer
        ref={footerRef}
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6",
          "transition-[opacity,transform] duration-200 ease-smooth-out",
          chrome || dragging
            ? "opacity-100 translate-y-0"
            : "pointer-events-none opacity-0 translate-y-2",
        )}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-xl bg-surface/90 p-3 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-fg)_12%,transparent)] backdrop-blur-sm sm:p-4">
          <div className="flex items-center gap-3">
            {track?.artworkUrl ? (
              <img
                src={track.artworkUrl}
                alt=""
                className="size-12 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-fg/10"
              />
            ) : (
              <div className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-medium text-muted">
                P
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold text-fg">{track?.title}</p>
              <p className="truncate text-xs text-muted">
                {track?.artist}
                {track?.source === "demo" ? " · generated loop" : mapping ? " · mapping drops…" : mapLabel ? ` · ${mapLabel}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <span ref={timeLabelRef} className="w-10 font-mono text-xs text-muted tabular-nums">
              0:00
            </span>
            <div
              ref={seekRef}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.floor(duration || 0)}
              tabIndex={canSeek ? 0 : -1}
              onPointerDown={(e) => {
                if (!canSeek) return;
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                onSeek(e.clientX);
              }}
              onPointerMove={(e) => {
                if (!canSeek || !e.buttons) return;
                onSeek(e.clientX);
              }}
              className={cn(
                "relative h-2 flex-1 rounded-full bg-surface-2",
                canSeek ? "cursor-pointer" : "opacity-40",
              )}
            >
              <div
                ref={seekFillRef}
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: "0%" }}
              />
            </div>
            <span className="w-10 text-right font-mono text-xs text-muted tabular-nums">
              {track?.source === "demo" ? "∞" : formatTime(duration)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {VIZ_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => usePulse.getState().set({ mode: m.id })}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150",
                    mode === m.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {CORE_STYLES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => usePulse.getState().set({ core: c.id })}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150",
                    core === c.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-9 w-20 accent-accent sm:w-28"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileRef.current?.click()}
                aria-label="Open audio file"
              >
                <Upload className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void toggleFullscreen()}
                aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFs ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            </div>
          </div>
          {error && !showLanding ? <p className="text-xs text-muted">{error}</p> : null}
        </div>
      </footer>
      ) : null}

      {dragging ? (
        <div className="absolute inset-4 z-20 grid place-items-center rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-fg)_28%,transparent)]">
          <p className="font-display text-xl font-semibold text-fg">Drop to load</p>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
