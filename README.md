# PULSE

A full-screen **electronic music visualizer**. Drop an MP3, search a song, or play the built-in house loop — the room follows the kick, the mids, and the drop. In the middle of the stage, Mixamo’s **Kachujin** dances to the beat.

Live source: [github.com/salemraven/pulse](https://github.com/salemraven/pulse)

---

## What you can do

- **Drag and drop** an MP3 (also WAV, AAC, M4A, OGG, FLAC)
- **Search a song name** for a 30-second catalog preview
- **Play a generated 128 BPM house loop** (kick, clap, hats, bass, stab)
- Switch **room modes**: Auto, Orbital, Tunnel, Grid, Storm, Wave
- Switch the **center**: **Kachujin** (3D dancer) or **Ring** (classic glow)
- Fullscreen, volume, seek on local files and previews

Dropped files play in the browser. They are **not uploaded**. Search uses short previews from the iTunes catalog.

---

## How the visualizer thinks

PULSE is built like a club visualizer, not a waveform widget.

1. Web Audio FFT (2048 bins) splits the signal into **bass, low-mid, mid, high, energy**.
2. A short history of bass/energy detects **beats** (kicks) and **drops** (quiet then surge).
3. Spectral **flux** (how fast the spectrum is changing) feeds particle bursts.
4. The 2D room — bars, orbital ring, tunnel, grid, storm, stars — is redrawn every frame from that analysis.
5. The 3D dancer’s animation **speed**, **kick pulse**, and **move switches** are driven by the same analysis.

Auto mode picks a room based on energy: orbital when it’s calm, grid when it builds, tunnel on the drop.

The 2D “center of the room” is not the geometric middle of the window. It sits at about **46% of canvas height** so the picture lives in the stage **above the player bar**.

---

## Kachujin

Kachujin G Rosales stands in that stage. She is a Mixamo character (GLB, PNG textures). A transparent Three.js canvas is layered over the 2D visualizer.

### Camera / framing

The 3D camera does **not** frame the full window. It frames the **free rectangle between the header and the footer**.

| Space | Center | Why |
|---|---|---|
| 2D room | `width/2`, `height × 0.46` | Optical center of the club picture |
| Player bar | Bottom ~28% of the screen | Must not cover her legs |
| 3D camera | Chest look-at, FOV fitted to the stage | Full body, feet above the bar |

Beat squash used to scale her around her **feet**, which shoved her into the footer. That motion is gone. She only gets a small kick bounce.

### Dance rotation

She starts on idle, then **crossfades** to another clip every **8–16 beats**, or immediately on a **drop**. Playback `timeScale` follows energy, so she speeds up when the track does.

| Clip | Mixamo name |
|---|---|
| Idle | Kachujin’s own `mixamo.com` idle |
| Flair | Flair |
| B-boy hip hop | BboyHipHopMove |
| Hip hop | HipHopDancing |
| Silly dancing | SillyDancing |
| Samba | SambaDancing |

`HipHopDancing(1)` is in the pack and skipped as a duplicate. Root-position tracks on pack clips are stripped so Mixamo root motion cannot throw her off-stage.

Files:

- [`public/models/kachujin.glb`](public/models/kachujin.glb)
- [`public/models/dances.glb`](public/models/dances.glb)
- [`src/lib/dancer/kachujin-scene.ts`](src/lib/dancer/kachujin-scene.ts)

Characters and motions © Adobe Mixamo.

---

## Keyboard

| Key | Action |
|---|---|
| Space | Play / pause |
| F | Fullscreen |
| M | Mute |
| ← → | Seek (local files and previews) |

---

## Architecture

```
src/
  components/pulse/pulse-app.tsx   UI, drag-drop, search, player, canvases
  lib/audio/engine.ts              Web Audio graph, FFT, beat / drop
  lib/audio/demo.ts                128 BPM house loop
  lib/audio/search.ts              iTunes search (server function)
  lib/audio/id3.ts                 local file tags + artwork
  lib/visualizer/renderer.ts       Canvas 2D room
  lib/dancer/kachujin-scene.ts     Three.js dancer
  lib/store.ts                     Zustand (mode, core, track)
```

- **2D canvas** — full viewport, opaque club picture
- **3D canvas** — full viewport, transparent, `z-index: 2`, only visible when Core is Kachujin
- Preview search is proxied so the audio element can play cross-origin catalog clips

Stack: React 19, TanStack Start, Tailwind v4, Zustand, Web Audio API, Canvas 2D, Three.js.

---

## Run locally

Needs Node 22.

```bash
npm install
npm run dev
```

Open the URL Vite prints (this project binds `0.0.0.0:8080`).

```bash
npm run typecheck
npm run build
```

---

## Privacy

- Local files never leave the browser (`blob:` URLs).
- Search sends only the typed title to iTunes Search, then streams a short preview.
- Volume, room mode, and center style are stored in `localStorage` on this device.

---

## License

App code is yours in this repo. Kachujin and the dance clips remain Mixamo / Adobe property; keep the attribution in [`public/models/README.txt`](public/models/README.txt) if you redistribute the models.
