# Adding Mixamo dances to PULSE

New Mixamo loops ride the same blender as Samba, B-boy, Hip Hop, and Silly. You do not retarget in Blender or author transition clips.

## What blends well

| Use | Skip |
|---|---|
| In-place grooves (house, locking, salsa, waving, hip hop) | Floorwork, flares, windmills |
| Standing start and end | Clips that start/end in T-pose or on the ground |
| Same `mixamorig` skeleton (Michelle or any Mixamo body) | A different bone naming scheme |

The mixer slerps each bone from pose A to pose B for ~1s. Extreme pose changes still look like a morph; standing-to-standing is the sweet spot.

## Mixamo export

1. Open [mixamo.com](https://www.mixamo.com), pick **Michelle** (or any Mixamo character — we only keep the animation).
2. Pick an **in-place** dance. Check **In Place**.
3. Download **FBX** at 30 fps. Skin optional (animation-only is fine).
4. Convert FBX → GLB (`Blender`, `fbx2gltf`, or ask Grok in this repo).

Name the clip so it is obviously a dance, e.g. `HouseDancing`, `SalsaDancing`, `LockingDance`. Avoid `TPose`, `Flair`, `Idle`.

## Drop it in

- Easiest: put the GLB in [`public/models/`](public/models/) and add its URL to `PACK_URLS` in [`src/lib/dancer/kachujin-scene.ts`](src/lib/dancer/kachujin-scene.ts).
- Or merge the clip into [`public/models/dances.glb`](public/models/dances.glb).

The loader already:

1. Renames `mixamorig:` → `mixamorig` so tracks bind to Michelle  
2. Converts hip space (Y-up Mixamo → Michelle’s −90° X)  
3. Pins hip X/Z so she stays on the stage  
4. Trims the T-pose intro and fixes quaternion sign flips  
5. Builds a loop echo so the last frame melts into the first  
6. Joins the round-robin (pause in place, ~1s smoothstep into the next move)

Clip BPM is estimated from duration. No hand timing.

## Check it

Hard-refresh, watch the pill: `Michelle · House`. First visit starts at the trimmed intro; the next time that move comes around it resumes where it paused. If you see a T-pose, the clip name failed the dance filter or the bones are not `mixamorig`.

## Filter

Pack clips are kept when the name matches `dance|hip|bboy|silly|chicken|pocket|lock|wave|salsa|jazz|rumba|house|swing` and skipped when it matches `flair|tpose|idle|walk|run`.
