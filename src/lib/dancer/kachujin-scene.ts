import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Analysis } from "@/lib/audio/types";

const MODEL_URL = "/models/kachujin.glb";
const PACK_URL = "/models/dances.glb";

function hueColor(hue: number, s = 0.75, l = 0.55) {
  const c = new THREE.Color();
  c.setHSL((((hue % 360) + 360) % 360) / 360, s, l);
  return c;
}

function retargetClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const next = clip.clone();
  next.name = clip.name;
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of next.tracks) {
    const dot = track.name.lastIndexOf(".");
    const bone = (dot >= 0 ? track.name.slice(0, dot) : track.name)
      .replace(/^mixamorig:/, "")
      .replace(/^mixamorig/, "");
    const prop = dot >= 0 ? track.name.slice(dot) : "";
    if (prop === ".position") continue;
    track.name = `${bone}${prop}`;
    tracks.push(track);
  }
  next.tracks = tracks;
  return next;
}

function isDanceClip(clip: THREE.AnimationClip) {
  return /dance|samba|hip|flair|bboy|silly/i.test(clip.name);
}

let packPromise: Promise<THREE.AnimationClip[]> | null = null;

function loadPack(loader: GLTFLoader) {
  packPromise ??= loader.loadAsync(PACK_URL).then((gltf) => gltf.animations.filter(isDanceClip)).catch(() => []);
  return packPromise;
}

export class DancerScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  private loader = new GLTFLoader();
  private mixer: THREE.AnimationMixer | null = null;
  private actions: THREE.AnimationAction[] = [];
  private action: THREE.AnimationAction | null = null;
  private root = new THREE.Group();
  private key = new THREE.PointLight(0x7cf0ff, 6, 22);
  private rim = new THREE.PointLight(0xff4fd8, 5, 22);
  private fill = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xc8e8ff, 0x1a1020, 1.5);
  private kick = 0;
  private speed = 0.9;
  private loadId = 0;
  private beats = 0;
  private untilSwitch = 8;
  private fadeLeft = 0;
  private loading = false;
  private headerPx = 96;
  private footerPx = 200;
  private model: THREE.Object3D | null = null;
  enabled = true;
  ready = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.7;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 1.1;
    this.scene.add(this.hemi, this.fill, this.key, this.rim, this.root);
    this.fitCamera();
    void this.load();
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

    const bodyH = 1.42;
    const chest = bodyH * 0.55;
    const padded = bodyH * 1.12;
    const fullVisible = padded * (h / stageH);
    this.camera.fov = 28;
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const z = fullVisible / 2 / Math.tan(half);

    this.camera.position.set(0, chest, z);
    this.camera.lookAt(0, chest, 0);
    this.fill.position.set(0.3, chest + 0.5, z + 0.4);
    this.key.position.set(-1.6, chest + 0.7, z * 0.55);
    this.rim.position.set(1.1, chest + 0.4, -z * 0.45);

    const offsetY = h / 2 - stageMid;
    this.camera.setViewOffset(w, h, 0, offsetY, w, h);
    this.camera.updateProjectionMatrix();
  }

  async load() {
    if (this.ready || this.loading) return;
    const id = ++this.loadId;
    this.loading = true;
    try {
      const [gltf, pack] = await Promise.all([this.loader.loadAsync(MODEL_URL), loadPack(this.loader)]);
      if (id !== this.loadId) return;
      this.mount(gltf, pack);
    } catch (err) {
      console.error("Dancer failed to load", err);
    } finally {
      if (id === this.loadId) this.loading = false;
    }
  }

  private mount(gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>, pack: THREE.AnimationClip[]) {
    this.mixer?.stopAllAction();
    this.root.clear();
    const model = gltf.scene;
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if ("metalness" in mat) {
          mat.metalness = 0;
          mat.roughness = 0.62;
          mat.envMapIntensity = 0.8;
          mat.emissive = new THREE.Color(0x3a4658);
          mat.emissiveIntensity = 0.45;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      }
    });

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(1.42 / Math.max(size.y, 0.01));
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x += -center.x;
    model.position.z += -center.z;
    model.position.y += -box.min.y;
    this.root.add(model);
    this.model = model;

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = [];
    const native = gltf.animations.find((c) => c.tracks.length);
    if (native) {
      const idle = this.mixer.clipAction(native);
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.setEffectiveWeight(1);
      idle.play();
      this.actions.push(idle);
      this.action = idle;
    }

    const seen = new Set(this.actions.map((a) => a.getClip().name.toLowerCase()));
    for (const clip of pack) {
      const key = clip.name.replace(/\(1\)/, "").toLowerCase();
      if (seen.has(key)) continue;
      const next = retargetClip(clip);
      if (!next.tracks.length) continue;
      seen.add(key);
      const action = this.mixer.clipAction(next);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.setEffectiveWeight(0);
      this.actions.push(action);
    }

    this.beats = 0;
    this.untilSwitch = 8 + Math.floor(Math.random() * 8);
    this.fadeLeft = 0;
    this.ready = true;
    this.fitCamera();
  }

  private switchMove(force = false) {
    if (this.actions.length < 2 || !this.action) return;
    if (!force && this.fadeLeft > 0) return;
    const others = this.actions.filter((a) => a !== this.action);
    const next = others[Math.floor(Math.random() * others.length)];
    if (!next) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    this.action.crossFadeTo(next, 0.38, true);
    this.action = next;
    this.fadeLeft = 0.4;
    this.beats = 0;
    this.untilSwitch = 8 + Math.floor(Math.random() * 8);
  }

  frame(dt: number, a: Analysis, playing: boolean) {
    if (!this.enabled) {
      this.renderer.clear();
      return;
    }
    const hue = 186 + a.high * 36 + a.mid * 12;
    this.kick = a.beat || a.drop ? 1 : this.kick * 0.82;
    const target = playing
      ? 0.72 + a.energy * 1.05 + (a.beat ? 0.25 : 0) + (a.drop ? 0.35 : 0)
      : 0.35;
    this.speed += (target - this.speed) * 0.18;
    for (const action of this.actions) action.timeScale = this.speed;
    if (playing && a.beat) this.beats += 1;
    if (playing && a.drop) this.switchMove(true);
    else if (playing && this.beats >= this.untilSwitch) this.switchMove();
    if (this.fadeLeft > 0) {
      this.fadeLeft -= dt;
      if (this.fadeLeft <= 0) {
        for (const action of this.actions) {
          if (action !== this.action) action.stop();
        }
      }
    }
    this.mixer?.update(dt);
    this.root.position.set(0, a.bass * 0.02 + this.kick * 0.018, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.key.color.copy(hueColor(hue));
    this.rim.color.copy(hueColor(hue + 40, 0.85, 0.62));
    this.key.intensity = 4 + a.bass * 5 + this.kick * 3;
    this.rim.intensity = 3 + a.high * 3;
    this.fill.intensity = 2.4 + a.energy * 1.1;
    this.hemi.intensity = 1.4 + a.energy * 0.5;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.loadId += 1;
    this.mixer?.stopAllAction();
  }
}
