# PULSE

A full-screen electronic music visualizer. Drop an MP3, search a track, or play the built-in house loop — the picture follows bass, kicks, and drops.

## What it does

- Drag and drop an MP3 (also WAV, AAC, M4A, OGG, FLAC)
- Search a song name for a 30-second catalog preview
- Play a generated 128 BPM house loop
- Visual modes: Auto, Orbital, Tunnel, Grid, Storm, Wave
- Beat-reactive particles, spectrum, and tunnel
- Keyboard: Space play/pause, F fullscreen, M mute, 1–6 modes, arrows seek

Dropped files play in full in your browser. They are not uploaded. Searched titles use short previews from the iTunes catalog.

## Run locally

Needs Node 22.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (this project binds `0.0.0.0:8080`).

## Stack

React 19, TanStack Start, Tailwind v4, Web Audio API, Canvas 2D.
