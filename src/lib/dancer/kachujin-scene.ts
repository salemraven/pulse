import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Analysis } from "@/lib/audio/types";
import type { TrackMap } from "@/lib/audio/map-track";

const HIP_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function asset(path: string) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

const MODEL_URL = asset("/models/michelle.glb?v=1");
const PACK_URLS = [asset("/models/dances.glb?v=bind")];
const FBX_PACKS = [
  { url: asset("/models/groove.fbx?v=1"), name: "Groove" },
  { url: asset("/models/running-man.fbx?v=1"), name: "RunningMan" },
  { url: asset("/models/swing.fbx?v=1"), name: "Swing" },
  { url: asset("/models/rumba.fbx?v=1"), name: "Rumba" },
  { url: asset("/models/shuffle.fbx?v=1"), name: "Shuffle" },
  { url: asset("/models/slide.fbx?v=1"), name: "Slide" },
];

export type DancerStatus = "loading" | "ready" | "error";

type LaserBeam = {
  core: THREE.Mesh;
  glow: THREE.Mesh;
  halo: THREE.Mesh;
  kiss: THREE.Mesh;
  tx: number;
  ty: number;
  tz: number;
};

type LaserHead = {
  group: THREE.Group;
  emitter: THREE.Mesh;
  light: THREE.PointLight;
  beams: LaserBeam[];
  side: number;
};

const attached = new WeakMap<HTMLCanvasElement, DancerScene>();

export function attachDancer(canvas: HTMLCanvasElement, onStatus?: (status: DancerStatus, detail?: string) => void) {
  const existing = attached.get(canvas);
  if (existing) {
    existing.setStatusHandler(onStatus);
    existing.ensureLoaded();
    return existing;
  }
  const scene = new DancerScene(canvas, onStatus);
  attached.set(canvas, scene);
  return scene;
}

function hueColor(hue: number, s = 0.75, l = 0.55) {
  const c = new THREE.Color();
  c.setHSL((((hue % 360) + 360) % 360) / 360, s, l);
  return c;
}

function laserMat(opacity: number, color = 0xffffff) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function makeQuatsContinuous(clip: THREE.AnimationClip) {
  const prev = new THREE.Quaternion();
  const next = new THREE.Quaternion();
  for (const track of clip.tracks) {
    if (!/\.quaternion$/.test(track.name)) continue;
    const v = track.values;
    for (let i = 4; i < v.length; i += 4) {
      prev.set(v[i - 4]!, v[i - 3]!, v[i - 2]!, v[i - 1]!);
      next.set(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!);
      if (prev.dot(next) < 0) {
        v[i]! *= -1;
        v[i + 1]! *= -1;
        v[i + 2]! *= -1;
        v[i + 3]! *= -1;
      }
    }
  }
  return clip;
}

function stripBind(clip: THREE.AnimationClip) {
  const fps = 30;
  const start = clip.duration > 1 ? 0.2 : 0.05;
  if (clip.duration <= start + 0.5) return makeQuatsContinuous(clip);
  const trimmed = THREE.AnimationUtils.subclip(clip, clip.name, start * fps, clip.duration * fps, fps);
  trimmed.name = clip.name;
  return makeQuatsContinuous(trimmed);
}

function boneName(raw: string) {
  return raw.replace(/^mixamorig:/, "mixamorig");
}

function sampleQuat(track: THREE.KeyframeTrack, t: number, into: THREE.Quaternion) {
  const times = track.times;
  const v = track.values;
  if (!times.length) return into.identity();
  if (t <= times[0]!) return into.set(v[0]!, v[1]!, v[2]!, v[3]!);
  const last = times.length - 1;
  if (t >= times[last]!) {
    const i = last * 4;
    return into.set(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!);
  }
  let i = 1;
  while (times[i]! < t) i += 1;
  const a = (i - 1) * 4;
  const b = i * 4;
  const u = (t - times[i - 1]!) / Math.max(1e-5, times[i]! - times[i - 1]!);
  const qa = new THREE.Quaternion(v[a]!, v[a + 1]!, v[a + 2]!, v[a + 3]!);
  const qb = new THREE.Quaternion(v[b]!, v[b + 1]!, v[b + 2]!, v[b + 3]!);
  return into.copy(qa).slerp(qb, u);
}

function quatDeltaDeg(a: THREE.Quaternion, b: THREE.Quaternion) {
  return Math.acos(Math.min(1, Math.abs(a.dot(b)))) * (360 / Math.PI);
}

function sealLoop(clip: THREE.AnimationClip) {
  const dur = clip.duration;
  if (dur < 1.2) return clip;
  const bones = clip.tracks.filter(
    (t) => /\.quaternion$/.test(t.name) && /hips|spine$|spine1|leftarm|rightarm|leftupleg|rightupleg/i.test(t.name),
  );
  if (bones.length < 3) return clip;
  const cur = new THREE.Quaternion();
  const ends = bones.map((tr) => sampleQuat(tr, dur, new THREE.Quaternion()));
  const errAt = (t: number) => {
    let s = 0;
    for (let i = 0; i < bones.length; i++) {
      sampleQuat(bones[i]!, t, cur);
      s += quatDeltaDeg(ends[i]!, cur);
    }
    return s / bones.length;
  };
  const base = errAt(0);
  let bestT = 0;
  let best = base;
  const limit = Math.min(dur * 0.5, 2.4);
  for (let t = 0; t <= limit; t += 1 / 30) {
    const e = errAt(t);
    if (e < best) {
      best = e;
      bestT = t;
    }
  }
  if (bestT < 0.08 || base - best < 6) return clip;
  if (bestT > dur * 0.22 || dur - bestT < 3) return clip;
  const fps = 30;
  const trimmed = THREE.AnimationUtils.subclip(clip, clip.name, bestT * fps, dur * fps, fps);
  trimmed.name = clip.name;
  return makeQuatsContinuous(trimmed);
}

function trimHead(clip: THREE.AnimationClip, seconds: number) {
  if (seconds < 0.05 || clip.duration < seconds + 1.2) return clip;
  const fps = 30;
  const next = THREE.AnimationUtils.subclip(clip, clip.name, seconds * fps, clip.duration * fps, fps);
  next.name = clip.name;
  return makeQuatsContinuous(next);
}

function retargetClip(clip: THREE.AnimationClip) {
  const next = clip.clone();
  next.name = clip.name.replace(/\(1\)/, "").trim();
  const tracks: THREE.KeyframeTrack[] = [];
  const q = new THREE.Quaternion();
  for (const track of next.tracks) {
    const dot = track.name.lastIndexOf(".");
    const bone = boneName(dot >= 0 ? track.name.slice(0, dot) : track.name);
    const prop = dot >= 0 ? track.name.slice(dot) : "";
    const hip = /hips$/i.test(bone);
    if (prop === ".scale") continue;
    if (prop === ".position") {
      if (!hip) continue;
      const v = track.values;
      for (let i = 0; i < v.length; i += 3) {
        const y = v[i + 1];
        v[i] = 0;
        v[i + 1] = 0;
        v[i + 2] = -y;
      }
    } else if (prop === ".quaternion" && hip) {
      const v = track.values;
      for (let i = 0; i < v.length; i += 4) {
        q.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
        q.premultiply(HIP_FIX);
        v[i] = q.x;
        v[i + 1] = q.y;
        v[i + 2] = q.z;
        v[i + 3] = q.w;
      }
    }
    track.name = `${bone}${prop}`;
    tracks.push(track);
  }
  next.tracks = tracks;
  let out = stripBind(next);
  if (/swing/i.test(out.name) || /swing/i.test(clip.name)) out = trimHead(out, 0.5);
  return sealLoop(out);
}

function prettyClip(name: string) {
  const n = name.replace(/\(1\)/, "").replace(/__echo$/, "").trim();
  if (/samba/i.test(n)) return "Samba";
  if (/bboy/i.test(n)) return "B-boy";
  if (/silly/i.test(n)) return "Silly";
  if (/groove/i.test(n)) return "Groove";
  if (/running/i.test(n)) return "Running Man";
  if (/swing/i.test(n)) return "Swing";
  if (/rumba/i.test(n)) return "Rumba";
  if (/shuffle/i.test(n)) return "Shuffle";
  if (/slide/i.test(n)) return "Slide";
  if (/hip/i.test(n)) return "Hip Hop";
  return n.replace(/([a-z])([A-Z])/g, "$1 $2");
}

type ClipMeta = { bpm: number; beats: number; plants: number[] };

const TEMPOS = [90, 96, 100, 105, 108, 110, 112, 115, 120, 122, 124, 126, 128, 130, 132, 135, 140, 145, 150];

function snapClipTempo(bpm: number) {
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

const CLIP_BPM: [RegExp, number][] = [
  [/samba/i, 120],
  [/groove/i, 128],
  [/running/i, 128],
  [/swing/i, 100],
  [/rumba/i, 108],
  [/shuffle/i, 112],
  [/slide/i, 128],
  [/silly/i, 120],
  [/bboy/i, 120],
  [/hip/i, 96],
];

function clipMeta(clip: THREE.AnimationClip): ClipMeta {
  const dur = Math.max(clip.duration, 0.1);
  const track = clip.tracks.find((t) => /hips\.position$/i.test(t.name));
  const plants: number[] = [];
  if (track) {
    const { times, values } = track;
    for (let i = 1; i < times.length - 1; i++) {
      const y = values[i * 3 + 2] ?? 0;
      const prev = values[(i - 1) * 3 + 2] ?? 0;
      const next = values[(i + 1) * 3 + 2] ?? 0;
      if (y > prev && y > next) plants.push(times[i] ?? 0);
    }
    const spaced: number[] = [];
    for (const t of plants) {
      if (!spaced.length || t - spaced[spaced.length - 1]! > 0.18) spaced.push(t);
    }
    plants.length = 0;
    plants.push(...spaced);
  }

  let bpm = 120;
  const iois: number[] = [];
  for (let i = 1; i < plants.length; i++) {
    const d = plants[i]! - plants[i - 1]!;
    if (d > 0.32 && d < 0.72) iois.push(d);
  }
  if (iois.length >= 3) {
    iois.sort((a, b) => a - b);
    let est = 60 / iois[Math.floor(iois.length / 2)]!;
    while (est < 90) est *= 2;
    while (est > 180) est /= 2;
    bpm = snapClipTempo(est);
  } else {
    const beatsGuess = Math.max(4, Math.round((dur * 2) / 4) * 4);
    bpm = snapClipTempo((beatsGuess * 60) / dur);
  }
  for (const [re, lock] of CLIP_BPM) {
    if (re.test(clip.name)) {
      bpm = lock;
      break;
    }
  }
  const beats = Math.max(4, Math.round((dur * bpm) / 60 / 4) * 4);
  return { bpm, beats, plants };
}

function isPackDance(clip: THREE.AnimationClip) {
  const n = clip.name;
  if (/flair|samba|tpose|t-pose|t pose|idle|walk|run|chicken|pocket|maras/i.test(n)) return false;
  return /dance|hip|bboy|silly|lock|wave|salsa|jazz|rumba|house|swing|groove|shuffle|slide/i.test(n) && clip.tracks.length > 10;
}

function isTPose(clip: THREE.AnimationClip | string) {
  const name = typeof clip === "string" ? clip : clip.name;
  return /tpose|t-pose|t pose/i.test(name);
}

function loadPack(loader: GLTFLoader) {
  const fbxLoader = new FBXLoader();
  const gltfPacks = PACK_URLS.map((url) =>
    loader
      .loadAsync(url)
      .then((gltf) => gltf.animations.filter(isPackDance).map(retargetClip))
      .catch((err) => {
        console.error("Dance pack failed", url, err);
        return [] as THREE.AnimationClip[];
      }),
  );
  const fbxPacks = FBX_PACKS.map(({ url, name }) =>
    fbxLoader
      .loadAsync(url)
      .then((fbx) => {
        const clips = fbx.animations.filter((c) => c.tracks.length > 10 && !isTPose(c));
        return clips.map((clip) => {
          clip.name = name;
          return retargetClip(clip);
        });
      })
      .catch((err) => {
        console.error("FBX dance failed", url, err);
        return [] as THREE.AnimationClip[];
      }),
  );
  return Promise.all([...gltfPacks, ...fbxPacks]).then((packs) => packs.flat());
}

export class DancerScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  private loader = new GLTFLoader();
  private mixer: THREE.AnimationMixer | null = null;
  private actions: THREE.AnimationAction[] = [];
  private action: THREE.AnimationAction | null = null;
  private root = new THREE.Group();
  private key = new THREE.PointLight(0x7cf0ff, 22, 11);
  private rim = new THREE.PointLight(0xff4fd8, 16, 11);
  private fill = new THREE.DirectionalLight(0x3a4a88, 0.18);
  private front = new THREE.DirectionalLight(0x5ce0ff, 0.2);
  private hemi = new THREE.HemisphereLight(0x3a6888, 0x120814, 0.22);
  private ambient = new THREE.AmbientLight(0x1a1528, 0.12);
  private strobe = new THREE.PointLight(0x88f0ff, 0, 9);
  private floods: THREE.SpotLight[] = [];
  private pars: THREE.PointLight[] = [];
  private lasers: LaserHead[] = [];
  private laserPat = 0;
  private laserPatHold = 0;
  private laserShutter = 0.4;
  private laserY = new THREE.Vector3(0, 1, 0);
  private laserDir = new THREE.Vector3();
  private laserFrom = new THREE.Vector3();
  private laserTo = new THREE.Vector3();
  private laserHit = new THREE.Vector3();
  private club = new THREE.Group();
  private t = 0;
  private kick = 0;
  private kickWant = 0;
  private hatPulse = 0;
  private hatWant = 0;
  private bassSmooth = 0;
  private bounceY = 0;
  private squashAmt = 1;
  private keyGlow = 8;
  private rimGlow = 6;
  private flashAmt = 0;
  private lightHue = 186;
  private floodSlot = 0;
  private floodPair = 1;
  private floodHold = 0;
  private speed = 0.9;
  private loadId = 0;
  private loading = false;
  private headerPx = 96;
  private footerPx = 200;
  private bodyH = 1.65;
  private beats = 0;
  private held = 0;
  private untilSwitch = 18;
  private untilHold = 8;
  private fadeFrom: THREE.AnimationAction | null = null;
  private fadeT = 0;
  private fadeDur = 1.05;
  private cursor = 0;
  private bag: number[] = [];
  private map: TrackMap | null = null;
  private queued = 0;
  private pending: { reason: string } | null = null;
  private pendingT = 0;
  private cueI = 0;
  private lastSong = 0;
  private centerX = 0;
  private aim = new THREE.Vector3();
  private meta: ClipMeta[] = [];
  private echoes: THREE.AnimationAction[] = [];
  private hips: THREE.Object3D | null = null;
  private spine: THREE.Object3D | null = null;
  private leftArm: THREE.Object3D | null = null;
  private rightArm: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private leftUp: THREE.Object3D | null = null;
  private rightUp: THREE.Object3D | null = null;
  private ax = new THREE.Vector3(1, 0, 0);
  private onStatus: ((status: DancerStatus, detail?: string) => void) | undefined;
  status: DancerStatus = "loading";
  detail = "Loading Mixamo Michelle…";
  enabled = true;
  ready = false;
  clipLabel = "Samba";

  constructor(
    private canvas: HTMLCanvasElement,
    onStatus?: (status: DancerStatus, detail?: string) => void,
  ) {
    this.onStatus = onStatus;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.08;
    this.scene.add(this.hemi, this.ambient, this.fill, this.front, this.key, this.rim, this.strobe, this.club, this.root);
    this.buildClub();
    this.buildFloods();
    this.report("loading", "Loading Mixamo Michelle…");
    this.fitCamera();
    void this.load();
  }

  setStatusHandler(onStatus?: (status: DancerStatus, detail?: string) => void) {
    this.onStatus = onStatus;
    onStatus?.(this.status, this.detail);
  }

  private report(status: DancerStatus, detail: string) {
    this.status = status;
    this.detail = detail;
    this.onStatus?.(status, detail);
  }

  ensureLoaded() {
    if (this.ready) {
      this.report("ready", "Michelle ready");
      return;
    }
    if (!this.loading) void this.load();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  setChrome(headerPx: number, footerPx: number) {
    this.headerPx = Math.max(0, headerPx);
    this.footerPx = Math.max(0, footerPx);
    this.fitCamera();
  }

  private fitCamera() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = w / h;

    const header = Math.min(this.headerPx, h * 0.28);
    const footer = Math.min(this.footerPx, h * 0.42);
    const stageTop = header;
    const stageBot = h - footer;
    const stageH = Math.max(160, stageBot - stageTop);
    const stageMid = stageTop + stageH * 0.5;

    const bodyH = this.bodyH;
    const chest = bodyH * 0.52;
    const padded = bodyH * 1.28;
    const fullVisible = padded * (h / stageH);
    this.camera.fov = 26;
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const z = fullVisible / 2 / Math.tan(half);

    this.camera.position.set(0, chest, z);
    this.camera.lookAt(0, chest * 0.92, 0);
    this.fill.position.set(-0.9, chest + 1.2, z * 0.15);
    this.front.position.set(0.15, chest + 0.25, z * 0.28);
    this.key.position.set(-0.72, chest + 0.7, z * 0.16);
    this.rim.position.set(0.78, chest + 0.85, -0.55);
    this.strobe.position.set(0.08, chest + 1.35, 0.18);

    const offsetY = h / 2 - stageMid;
    this.camera.setViewOffset(w, h, 0, offsetY, w, h);
    this.camera.updateProjectionMatrix();
  }

  async load() {
    if (this.ready || this.loading) return;
    const id = ++this.loadId;
    this.loading = true;
    this.report("loading", "Loading Mixamo Michelle…");
    try {
      const [gltf, pack] = await Promise.all([this.loader.loadAsync(MODEL_URL), loadPack(this.loader)]);
      if (id !== this.loadId) return;
      this.mount(gltf, pack);
      this.report("ready", "Michelle ready");
    } catch (err) {
      console.error("Dancer failed to load", err);
      if (id === this.loadId) {
        this.ready = false;
        this.report("error", "Michelle did not load. Check /models/michelle.glb.");
      }
    } finally {
      if (id === this.loadId) this.loading = false;
    }
  }

  retry() {
    this.ready = false;
    this.loading = false;
    this.loadId += 1;
    void this.load();
  }

  private mount(gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>, pack: THREE.AnimationClip[]) {
    this.mixer?.stopAllAction();
    this.root.clear();
    const model = gltf.scene;
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if ("metalness" in mat) {
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
          mat.metalness = 0.14;
          mat.roughness = 0.55;
          mat.envMapIntensity = 0.04;
          mat.emissive = new THREE.Color(0x030206);
          mat.emissiveIntensity = 0.04;
          mat.side = THREE.FrontSide;
          mat.needsUpdate = true;
        }
      }
    });

    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.hips = model.getObjectByName("mixamorigHips") ?? null;
    this.spine = model.getObjectByName("mixamorigSpine") ?? model.getObjectByName("mixamorigSpine1") ?? null;
    this.leftArm = model.getObjectByName("mixamorigLeftArm") ?? null;
    this.rightArm = model.getObjectByName("mixamorigRightArm") ?? null;
    this.head = model.getObjectByName("mixamorigHead") ?? model.getObjectByName("mixamorigNeck") ?? null;
    this.leftUp = model.getObjectByName("mixamorigLeftUpLeg") ?? null;
    this.rightUp = model.getObjectByName("mixamorigRightUpLeg") ?? null;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (size.y < 0.2) {
      throw new Error(`Model too small to frame (${size.y.toFixed(3)}m).`);
    }
    if (size.y < size.z * 0.55) {
      throw new Error("Model is sideways or top-down. Rejected.");
    }
    const targetH = 1.65;
    model.scale.setScalar(targetH / Math.max(size.y, 0.01));
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x += -center.x;
    model.position.z += -center.z;
    model.position.y += -box.min.y;
    this.bodyH = targetH;

    this.actions = [];
    this.echoes = [];
    this.meta = [];
    const dances = gltf.animations
      .filter((c) => !isTPose(c) && /samba|dance|hip|bboy|silly/i.test(c.name) && c.tracks.length > 10)
      .map(stripBind);
    const samba = dances.find((c) => /samba/i.test(c.name)) ?? dances[0];
    if (samba) {
      this.armClip(samba, true);
      this.action = this.actions[0] ?? null;
    }

    const seen = new Set(this.actions.map((a) => a.getClip().name.replace(/__echo$/, "").replace(/\(1\)/, "").toLowerCase()));
    for (const clip of pack) {
      if (isTPose(clip) || !clip.tracks.length) continue;
      const key = clip.name.replace(/__echo$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      this.armClip(clip, false);
    }

    for (const clip of gltf.animations) {
      if (isTPose(clip)) this.mixer.uncacheClip(clip);
    }

    this.beats = 0;
    this.held = 0;
    this.cursor = 0;
    this.bag = [];
    this.queued = 0;
    this.untilSwitch = 32;
    this.untilHold = 8;
    this.fadeFrom = null;
    this.fadeT = 0;
    this.clipLabel = prettyClip(this.action?.getClip().name ?? "Samba");
    this.ready = true;
    this.fitCamera();
  }

  private armClip(clip: THREE.AnimationClip, startPlaying: boolean) {
    if (!this.mixer) return;
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    const echoClip = clip.clone();
    echoClip.name = `${clip.name}__echo`;
    const echo = this.mixer.clipAction(echoClip);
    echo.setLoop(THREE.LoopRepeat, Infinity);
    echo.enabled = true;
    echo.setEffectiveWeight(0);
    echo.paused = true;
    action.enabled = true;
    action.play();
    if (!startPlaying) {
      action.time = 0.05;
      action.setEffectiveWeight(0);
      action.paused = true;
    }
    this.actions.push(action);
    this.echoes.push(echo);
    this.meta.push(clipMeta(clip));
  }

  private beginLoopBlend() {
    if (this.fadeFrom || !this.action) return;
    const dur = this.action.getClip().duration;
    if (dur < 0.75) {
      this.action.setLoop(THREE.LoopRepeat, Infinity);
      this.action.clampWhenFinished = false;
      return;
    }
    const rate = Math.max(0.35, Math.abs(this.action.timeScale) || this.speed);
    const remaining = (dur - this.action.time) / rate;
    if (remaining > Math.min(1.25, dur * 0.42)) return;
    if (this.actions.length > 1 && this.held >= 4 && !this.pending) {
      this.switchMove();
      return;
    }
    const echo = this.echoes[this.cursor];
    if (!echo || echo === this.action) return;
    const prev = this.action;
    prev.clampWhenFinished = true;
    prev.setLoop(THREE.LoopOnce, 1);
    echo.enabled = true;
    echo.paused = false;
    echo.clampWhenFinished = false;
    echo.setLoop(THREE.LoopRepeat, Infinity);
    const minT = /swing/i.test(echo.getClip().name) ? 0.22 : 0.08;
    echo.time = minT;
    echo.setEffectiveTimeScale(this.speed);
    echo.setEffectiveWeight(0);
    if (!echo.isRunning()) echo.play();
    this.fadeFrom = prev;
    this.fadeT = 0;
    this.fadeDur = Math.min(1.2, Math.max(0.7, remaining * 0.82));
    this.action = echo;
    this.echoes[this.cursor] = prev;
    this.actions[this.cursor] = echo;
  }

  private nextIndex() {
    const n = this.actions.length;
    if (n < 2) return 0;
    if (!this.bag.length) {
      const idxs = Array.from({ length: n }, (_, i) => i).filter((i) => i !== this.cursor);
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = idxs[i]!;
        idxs[i] = idxs[j]!;
        idxs[j] = a;
      }
      this.bag = idxs;
    }
    return this.bag.shift() ?? (this.cursor + 1) % n;
  }

  private switchMove() {
    if (this.actions.length < 2 || !this.action) return;
    if (this.fadeFrom) return;
    this.cursor = this.nextIndex();
    const pick = this.actions[this.cursor];
    if (!pick || pick === this.action || isTPose(pick.getClip())) {
      this.cursor = this.actions.indexOf(this.action);
      if (this.cursor < 0) this.cursor = 0;
      return;
    }
    const prev = this.action;
    const durPick = Math.max(pick.getClip().duration, 0.1);
    const minT = /swing/i.test(pick.getClip().name) ? 0.22 : 0.08;
    let t = pick.time;
    if (!Number.isFinite(t) || t < minT) t = minT;
    else if (t > durPick - 0.3) t = minT + ((t - minT) % Math.max(0.2, durPick - minT - 0.3));
    pick.enabled = true;
    pick.clampWhenFinished = false;
    pick.setLoop(THREE.LoopRepeat, Infinity);
    pick.setEffectiveTimeScale(this.speed);
    pick.setEffectiveWeight(0);
    if (!pick.isRunning()) pick.play();
    pick.paused = false;
    pick.time = t;
    prev.enabled = true;
    prev.paused = false;
    prev.clampWhenFinished = true;
    prev.setLoop(THREE.LoopOnce, 1);
    prev.setEffectiveWeight(1);
    const rate = Math.max(0.35, Math.abs(prev.timeScale) || this.speed);
    const remaining = (prev.getClip().duration - prev.time) / rate;
    this.fadeFrom = prev;
    this.fadeT = 0;
    this.fadeDur = remaining < 1.4 ? Math.min(1.2, Math.max(0.75, remaining * 0.8)) : 1.35;
    this.action = pick;
    this.clipLabel = prettyClip(pick.getClip().name);
    this.beats = 0;
    this.held = 0;
    this.pending = null;
    this.pendingT = 0;
    this.untilSwitch = 16 + Math.floor(Math.random() * 4);
    this.untilHold = 8;
  }

  setMap(map: TrackMap | null) {
    this.map = map;
    this.cueI = 0;
    this.pending = null;
    this.pendingT = 0;
    if (map && map.duration > 1) {
      this.held = 0;
      this.beats = 0;
    }
  }

  private currentMeta() {
    return this.meta[this.cursor] ?? this.meta[0];
  }

  private applyHits(a: Analysis) {
    const fade = this.fadeFrom ? 0.12 : 1;
    const k = this.kick * fade;
    const h = this.hatPulse * fade;
    if (this.spine) this.spine.rotateOnAxis(this.ax, k * 0.05);
    if (this.head) this.head.rotateOnAxis(this.ax, h * 0.04 - k * 0.015);
    const sy = THREE.MathUtils.clamp(this.squashAmt, 0.94, 1.03);
    const sx = THREE.MathUtils.clamp(1 + (1 - sy) * 0.35, 0.97, 1.06);
    this.root.scale.set(sx, sy, sx);
  }

  frame(dt: number, a: Analysis, playing: boolean, vizHue = 186, vizFlash = 0, songTime = 0) {
    if (!this.enabled) {
      this.renderer.clear();
      return;
    }
    const dHue = ((vizHue - this.lightHue + 540) % 360) - 180;
    this.lightHue += dHue * Math.min(1, dt * 7);
    this.flashAmt += (vizFlash - this.flashAmt) * (vizFlash > this.flashAmt ? 0.9 : Math.min(1, dt * 9));
    const hue = this.lightHue;
    const flash = Math.max(this.flashAmt, this.kick * 0.35, a.drop ? 0.5 : 0);
    const follow = 1 - Math.exp(-dt * 9);
    const fall = Math.exp(-dt * 4.2);
    if (a.beat || a.drop) {
      this.floodSlot = (this.floodSlot + 1 + (Math.random() < 0.35 ? 1 : 0)) % Math.max(1, this.floods.length || 3);
      this.floodPair = Math.random() < 0.62 ? (this.floodSlot + 1 + (Math.random() < 0.5 ? 0 : 1)) % 3 : -1;
      if (this.floodPair === this.floodSlot) this.floodPair = (this.floodSlot + 1) % 3;
      this.floodHold = 0;
      this.kickWant = 1;
    } else if (a.bass > 0.55) {
      this.kickWant = Math.max(this.kickWant, 0.7 + a.bass * 0.3);
    } else this.kickWant *= fall;
    if (a.hat) this.hatWant = 1;
    else this.hatWant *= Math.exp(-dt * 6);
    this.kick += (this.kickWant - this.kick) * follow;
    this.hatPulse += (this.hatWant - this.hatPulse) * (1 - Math.exp(-dt * 11));
    this.bassSmooth += (a.bass - this.bassSmooth) * (1 - Math.exp(-dt * 5));
    const bounceT = this.kick * 0.034 + this.bassSmooth * 0.028;
    this.bounceY += (bounceT - this.bounceY) * (1 - Math.exp(-dt * 8));
    this.squashAmt += (1 - this.kick * 0.035 - this.bassSmooth * 0.02 - this.squashAmt) * (1 - Math.exp(-dt * 7));

    const meta = this.currentMeta();
    const clipBpm = Math.max(80, meta?.bpm ?? 120);
    const mapped = this.map && this.map.duration > 1;
    const songBpm = mapped ? this.map!.bpm : playing && a.bpm > 80 ? a.bpm : 128;
    const pump = THREE.MathUtils.clamp(a.energy * 0.5 + a.bass * 0.55 + (a.drop ? 0.3 : 0), 0, 1);
    const feel = playing ? 0.78 + pump * 0.22 : 0.52;
    const scale = (songBpm / clipBpm) * feel;
    this.speed += (scale - this.speed) * 0.08;
    for (const action of this.actions) action.timeScale = this.speed;
    for (const echo of this.echoes) echo.timeScale = this.speed;

    this.lastSong = songTime;
    this.held += dt;
    if (this.pending) this.pendingT += dt;
    if (playing && a.beat) this.beats += 1;
    this.floodHold += dt;
    if (this.floodHold > 0.5) {
      this.floodSlot = (this.floodSlot + 1) % 3;
      this.floodPair = Math.random() < 0.5 ? (this.floodSlot + 2) % 3 : -1;
      this.floodHold = 0;
    }

    if (this.pending && !this.fadeFrom && this.held >= 4) {
      if (!playing || a.beat || a.drop || this.pendingT > 0.7) this.switchMove();
    }

    if (!this.fadeFrom && !this.pending) {
      if (playing && this.map && this.map.cues.length) {
        while (this.cueI < this.map.cues.length && this.map.cues[this.cueI]!.t <= songTime) {
          const cue = this.map.cues[this.cueI]!;
          this.cueI += 1;
          if (this.held < 4) continue;
          if (cue.kind === "drop" || cue.kind === "build") {
            this.switchMove();
            break;
          }
          if ((cue.kind === "phrase" || cue.kind === "break") && this.held >= 4) {
            this.pending = { reason: cue.kind };
            this.pendingT = 0;
            break;
          }
        }
      }
      if (!this.fadeFrom && !this.pending && this.held > 8) {
        this.switchMove();
      }
    }
    if (!this.fadeFrom) this.beginLoopBlend();
    if (this.fadeFrom && this.action) {
      const from = this.fadeFrom;
      this.fadeT += dt;
      const u = Math.min(1, this.fadeT / this.fadeDur);
      const s = u * u * u * (u * (u * 6 - 15) + 10);
      this.action.enabled = true;
      this.action.paused = false;
      from.enabled = true;
      from.paused = false;
      this.action.setEffectiveWeight(s);
      from.setEffectiveWeight(1 - s);
      for (const other of [...this.actions, ...this.echoes]) {
        if (other !== this.action && other !== from) {
          other.setEffectiveWeight(0);
          other.paused = true;
        }
      }
      if (u >= 1) {
        this.action.setEffectiveWeight(1);
        from.setEffectiveWeight(0);
        from.paused = true;
        from.clampWhenFinished = false;
        from.setLoop(THREE.LoopRepeat, Infinity);
        this.fadeFrom = null;
      }
    } else if (this.action) {
      this.action.setEffectiveWeight(1);
    }
    this.mixer?.update(dt);
    if (this.hips) {
      this.hips.getWorldPosition(this.aim);
      const target = this.centerX - this.aim.x;
      const k = this.fadeFrom ? 2.1 : 6.5;
      this.centerX += (target - this.centerX) * (1 - Math.exp(-dt * k));
      this.root.position.x = this.centerX;
    }
    this.root.position.y = this.bounceY;
    this.applyHits(a);
    const wash = Math.max(this.kick, flash, a.drop ? 0.6 : 0);
    const glowFollow = 1 - Math.exp(-dt * 6);
    const keyT = 11 + a.bass * 10 + this.kick * 5 - wash * 7;
    const rimT = 9 + a.high * 8 + this.hatPulse * 6 - wash * 3;
    this.keyGlow += (keyT - this.keyGlow) * (wash > 0.2 ? 0.7 : glowFollow);
    this.rimGlow += (rimT - this.rimGlow) * (wash > 0.2 ? 0.7 : glowFollow);
    this.key.color.copy(hueColor(hue, 1, 0.38));
    this.rim.color.copy(hueColor(hue + 168, 1, 0.36));
    this.strobe.color.copy(hueColor(hue + 32, 1, 0.4));
    this.fill.color.copy(hueColor(hue + 210, 0.9, 0.28));
    this.front.color.copy(hueColor(hue, 1, 0.34));
    this.hemi.color.copy(hueColor(hue, 0.65, 0.22));
    this.ambient.color.copy(hueColor(hue, 0.4, 0.12));
    this.key.intensity = Math.max(4, this.keyGlow);
    this.rim.intensity = Math.max(3, this.rimGlow);
    this.strobe.intensity = 0.6 + this.kick * 3.5;
    this.fill.intensity = 0.04 + a.bass * 0.04;
    this.front.intensity = 0.03;
    this.hemi.intensity = 0.08;
    this.ambient.intensity = 0.04;
    this.scene.environmentIntensity = 0.02;
    this.renderer.toneMappingExposure = 0.95;
    this.driveClub(hue, flash, a, dt);
    this.driveFloods(hue, flash, a);
    this.renderer.render(this.scene, this.camera);
  }

  private buildClub() {
    const spots = [
      [-0.45, 2.1, 0.35],
      [0.45, 2.1, 0.35],
    ];
    for (const [x, y, z] of spots) {
      const par = new THREE.PointLight(0xffffff, 5, 7);
      par.position.set(x!, y!, z!);
      this.pars.push(par);
      this.club.add(par);
    }
    this.buildLasers();
  }

  private buildLasers() {
    const LEN = 8;
    const coreGeo = new THREE.CylinderGeometry(0.0036, 0.0014, LEN, 6, 1, true);
    const glowGeo = new THREE.CylinderGeometry(0.014, 0.007, LEN, 8, 1, true);
    const haloGeo = new THREE.CylinderGeometry(0.038, 0.02, LEN, 8, 1, true);
    coreGeo.translate(0, -LEN / 2, 0);
    glowGeo.translate(0, -LEN / 2, 0);
    haloGeo.translate(0, -LEN / 2, 0);
    const kissGeo = new THREE.SphereGeometry(0.045, 10, 8);
    const emitGeo = new THREE.SphereGeometry(0.028, 10, 8);

    for (const side of [-1, 1]) {
      const group = new THREE.Group();
      const emitter = new THREE.Mesh(emitGeo, laserMat(0.95, 0xffffff));
      const light = new THREE.PointLight(0x88f0ff, 0.8, 5, 2);
      group.add(emitter, light);
      const beams: LaserBeam[] = [];
      for (let i = 0; i < 2; i++) {
        const core = new THREE.Mesh(coreGeo, laserMat(0.8, 0xffffff));
        const glow = new THREE.Mesh(glowGeo, laserMat(0.22, 0x66e8ff));
        const halo = new THREE.Mesh(haloGeo, laserMat(0.07, 0x66e8ff));
        const kiss = new THREE.Mesh(kissGeo, laserMat(0.0, 0xffffff));
        this.club.add(core, glow, halo, kiss);
        beams.push({ core, glow, halo, kiss, tx: 0, ty: 0.8, tz: 0 });
      }
      this.club.add(group);
      this.lasers.push({ group, emitter, light, beams, side });
    }
  }

  private laserTarget(head: LaserHead, i: number, chest: number, t: number, scan: number, into: THREE.Vector3) {
    const pat = this.laserPat;
    const cx = this.centerX;
    const a = t * scan + i * 1.05 + head.side * 0.7;
    const b = t * scan * 0.73 + i * 0.8;
    if (pat === 0) {
      const r = 0.55 + Math.sin(b) * 0.12;
      into.set(cx + Math.cos(a) * r, chest + Math.sin(b * 1.3) * 0.38, Math.sin(a) * 0.28);
    } else if (pat === 1) {
      into.set(cx + Math.sin(a) * 1.05, 0.04 + Math.abs(Math.sin(b)) * 0.08, Math.cos(a * 0.7) * 0.55);
    } else if (pat === 2) {
      const pan = Math.sin(t * scan * 0.42 + head.side * 0.4) * 0.95;
      into.set(cx + pan + i * 0.04 * head.side, chest * (0.25 + i * 0.22), 0.15 + Math.sin(b) * 0.12);
    } else if (pat === 3) {
      const ang = (i / 2) * Math.PI + t * 0.35 + (head.side < 0 ? 0 : 0.4);
      into.set(cx + Math.cos(ang) * 0.62, 0.12 + (i % 2) * chest * 0.55, Math.sin(ang) * 0.42);
    } else if (pat === 4) {
      into.set(cx - head.side * 0.15, chest * (0.35 + 0.4 * Math.sin(a)), 0.35 + Math.sin(b) * 0.2);
    } else {
      into.set(
        cx + Math.sin(a * 1.7) * 0.85,
        chest + Math.sin(b * 2.1) * 0.55,
        Math.sin(a * 1.1 + b) * 0.45,
      );
    }
  }

  private aimBeam(beam: LaserBeam, from: THREE.Vector3, to: THREE.Vector3, live: number, color: THREE.Color) {
    this.laserDir.copy(to).sub(from);
    const len = Math.max(0.6, this.laserDir.length());
    this.laserDir.multiplyScalar(1 / len);
    const q = beam.core.quaternion;
    if (this.laserDir.y < -0.995) q.setFromAxisAngle(this.ax, Math.PI);
    else q.setFromUnitVectors(this.laserY, this.laserDir);
    const sy = len / 8;
    for (const mesh of [beam.core, beam.glow, beam.halo]) {
      mesh.position.copy(from);
      mesh.quaternion.copy(q);
      mesh.scale.set(1, sy, 1);
      mesh.visible = live > 0.04;
    }
    const coreMat = beam.core.material as THREE.MeshBasicMaterial;
    const glowMat = beam.glow.material as THREE.MeshBasicMaterial;
    const haloMat = beam.halo.material as THREE.MeshBasicMaterial;
    coreMat.color.setRGB(0.92, 0.97, 1);
    glowMat.color.copy(color);
    haloMat.color.copy(color);
    coreMat.opacity = 0.55 * live;
    glowMat.opacity = 0.2 * live;
    haloMat.opacity = 0.07 * live;

    const hips = this.hips;
    if (hips) {
      hips.getWorldPosition(this.aim);
      this.laserHit.copy(this.aim).sub(from);
      const tHit = THREE.MathUtils.clamp(this.laserHit.dot(this.laserDir), 0.25, len * 0.85);
      beam.kiss.position.copy(from).addScaledVector(this.laserDir, tHit);
      const dist = beam.kiss.position.distanceTo(this.aim);
      const near = dist < 0.55 ? 1 - dist / 0.55 : 0;
      const kissMat = beam.kiss.material as THREE.MeshBasicMaterial;
      kissMat.color.copy(color);
      kissMat.opacity = live * (0.08 + near * 0.7);
      const s = 0.35 + near * 1.4 + live * 0.3;
      beam.kiss.scale.setScalar(s);
      beam.kiss.visible = kissMat.opacity > 0.03;
    } else {
      beam.kiss.visible = false;
    }
  }

  private driveClub(hue: number, flash: number, a: Analysis, dt: number) {
    this.t += dt;
    const chest = this.bodyH * 0.52;
    this.pars.forEach((par, i) => {
      par.color.copy(hueColor(hue + i * 160, 1, 0.55));
      const pulse = i % 2 === 0 ? this.kick : this.hatPulse;
      par.intensity = 1.2 + a.bass * 1.4 + pulse * 4 + flash * 3.5;
      par.position.set(i === 0 ? -0.4 : 0.4, chest + 1.35, 0.3);
    });
    this.driveLasers(hue, flash, a, dt, chest);
  }

  private driveLasers(hue: number, flash: number, a: Analysis, dt: number, chest: number) {
    this.laserPatHold += dt;
    if ((a.drop && this.laserPatHold > 0.9) || (a.beat && this.laserPatHold > 6.5)) {
      this.laserPat = (this.laserPat + 1 + (a.drop ? Math.floor(Math.random() * 2) : 0)) % 6;
      this.laserPatHold = 0;
    }
    const pump = THREE.MathUtils.clamp(a.energy * 0.55 + a.bass * 0.45 + (a.drop ? 0.35 : 0), 0, 1);
    const wantShut = a.drop ? 1 : this.hatPulse > 0.55 ? 1 : 0.12 + pump * 0.78;
    const shutFollow = a.hat || a.drop ? 0.92 : 1 - Math.exp(-dt * 7);
    this.laserShutter += (wantShut - this.laserShutter) * shutFollow;
    if (a.beat && !a.drop) this.laserShutter *= 0.35;
    const scan = 0.45 + pump * 2.1 + (this.laserPat === 5 ? 1.1 : 0);
    const liveBase = this.laserShutter * (0.35 + pump * 0.65 + flash * 0.35);
    const follow = a.drop ? 1 : 1 - Math.exp(-dt * (11 + pump * 8));

    this.lasers.forEach((head) => {
      head.group.position.set(head.side * 1.22, chest + 1.78, -0.42);
      const headHue = hue + (head.side < 0 ? 0 : 155);
      const col = hueColor(headHue, 1, 0.58);
      head.light.color.copy(col);
      head.light.intensity = 0.4 + liveBase * 3.5 + this.kick * 2;
      const emitMat = head.emitter.material as THREE.MeshBasicMaterial;
      emitMat.color.copy(col);
      emitMat.opacity = 0.35 + liveBase * 0.65;
      head.emitter.scale.setScalar(0.7 + liveBase * 0.8 + this.kick * 0.4);

      head.beams.forEach((beam, i) => {
        this.laserFrom.copy(head.group.position);
        this.laserTarget(head, i, chest, this.t, scan, this.laserTo);
        beam.tx += (this.laserTo.x - beam.tx) * follow;
        beam.ty += (this.laserTo.y - beam.ty) * follow;
        beam.tz += (this.laserTo.z - beam.tz) * follow;
        this.laserTo.set(beam.tx, beam.ty, beam.tz);
        const live = liveBase * (0.82 + (i % 2 === 0 ? this.kick : this.hatPulse) * 0.18);
        this.laserDir.copy(this.laserTo).sub(this.laserFrom);
        if (this.laserDir.lengthSq() < 0.01) this.laserDir.set(0, -1, 0.2);
        this.laserDir.normalize();
        this.laserTo.copy(this.laserFrom).addScaledVector(this.laserDir, 8.5);
        this.aimBeam(beam, this.laserFrom, this.laserTo, live, col);
      });
    });
  }

  private buildFloods() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShadowMaterial({ opacity: 0.5, color: 0x000000 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const spots = [
      { x: -0.85, z: 0.45 },
      { x: 0.1, z: 0.7 },
      { x: 0.9, z: 0.35 },
    ];
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i]!;
      const flood = new THREE.SpotLight(0xffffff, 18, 12, 0.48, 0.32, 1.6);
      flood.position.set(p.x, 3.6, p.z);
      flood.target.position.set(0, 0.85, 0);
      flood.castShadow = i !== 2;
      if (flood.castShadow) {
        flood.shadow.mapSize.set(1024, 1024);
        flood.shadow.bias = -0.003;
        flood.shadow.normalBias = 0.04;
        flood.shadow.camera.near = 0.6;
        flood.shadow.camera.far = 12;
      }
      this.scene.add(flood);
      this.scene.add(flood.target);
      this.floods.push(flood);
    }
  }

  private driveFloods(hue: number, flash: number, a: Analysis) {
    const chest = this.bodyH * 0.52;
    this.floods.forEach((flood, i) => {
      flood.color.copy(hueColor(hue + i * 120, 1, 0.52));
      const primary = i === this.floodSlot;
      const pair = i === this.floodPair;
      const on = primary || pair;
      const kickHit = primary ? Math.max(this.kick, flash, a.drop ? 0.7 : 0) : pair ? flash * 0.55 : 0;
      flood.intensity = on ? 5 + kickHit * 48 + this.hatPulse * (pair ? 18 : 8) : 1.4;
      flood.position.y = chest + 2.15;
      flood.target.position.set(0, chest * 0.85, 0);
    });
  }

  dispose() {
    this.loadId += 1;
    this.mixer?.stopAllAction();
  }
}
