import * as THREE from "./vendor/three/three.module.min.js";
import { OrbitControls } from "./vendor/three/addons/controls/OrbitControls.js";
import { LineSegments2 } from "./vendor/three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "./vendor/three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "./vendor/three/addons/lines/LineMaterial.js";

const COL_EXO = 0x0284c7;
const COL_EGO = 0xd97706;
const COL_RAY = 0xf59e0b;
const COL_WEARER = 0x059669;
const COL_OTHER = 0xdc2626;
const COL_INSPECT = 0xf43f5e;
const RGB_WEARER = [16, 185, 129];
const RGB_OTHER = [239, 68, 68];

function makeCircleSpriteTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const r = size * 0.5;
  const grad = ctx.createRadialGradient(r, r, r * 0.14, r, r, r);
  grad.addColorStop(0.0, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.75, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.92, "rgba(255,255,255,0.45)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Marker sprite: filled dot with a white rim, or a hollow ring.
function makeMarkerTexture(fill, ring = false) {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const r = size * 0.5;
  ctx.beginPath();
  if (ring) {
    ctx.arc(r, r, r * 0.8, 0, Math.PI * 2);
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = fill;
    ctx.stroke();
  } else {
    ctx.arc(r, r, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r, r, r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeMarker(pos, tex, sizePx, opacity = 1.0) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,
    map: tex,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
  const pts = new THREE.Points(geom, mat);
  pts.renderOrder = 20;
  return pts;
}

export class EgoRay3DViewer {
  constructor(hostEl, labelsEl, statusEl, onPinSelect = null) {
    this.hostEl = hostEl;
    this.labelsEl = labelsEl;
    this.statusEl = statusEl;
    this.onPinSelect = onPinSelect;
    this.cache = new Map();
    this.state = {
      redDots: true,
      tint: true,
      cameras: true,
      ray: true,
      includeEgo: true,
      autoOrbit: true,
      pointSize: 3.6,
    };
    this.currentMeta = null;
    this.rawScene = null;
    this.sceneGroup = null;
    this.gridObj = null;
    this.pointsObj = null;
    this.camGroup = null;
    this.rayGroup = null;
    this.otherDotsGroup = null;
    this.wearerGroup = null;
    this.wearerPulse = null;
    this.rayPulse = null;
    this.rayPulse2 = null;
    this.inspectGroup = null;
    this.highlightedId = null;
    this.lineMats = new Set();
    this.pins = [];
    this.loadSeq = 0;
    this._fly = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.02, 400);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.hostEl.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.85;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.addEventListener("start", () => {
      this._userInteracting = true;
      this._fly = null;
    });
    this.controls.addEventListener("end", () => {
      this._userInteracting = false;
    });

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.hostEl);
    }
    this._inView = true;
    if (typeof IntersectionObserver !== "undefined") {
      this._io = new IntersectionObserver(
        (entries) => {
          this._inView = entries.some((e) => e.isIntersecting);
        },
        { threshold: 0.01 }
      );
      this._io.observe(this.hostEl);
    }
    this.resize();
    this.clock = new THREE.Clock();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  resize() {
    const w = Math.max(10, this.hostEl.clientWidth);
    const h = Math.max(10, this.hostEl.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, true);
    for (const m of this.lineMats) m.resolution.set(w, h);
  }

  // Screen-space lines: constant pixel width at any zoom, plus a faint copy that shows through the cloud.
  _lines(positions, color, width, opacity = 1.0, xray = 0.32) {
    const g = new THREE.Group();
    const geom = new LineSegmentsGeometry().setPositions(positions);
    const w = Math.max(10, this.hostEl.clientWidth);
    const h = Math.max(10, this.hostEl.clientHeight);
    const solid = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity });
    solid.resolution.set(w, h);
    this.lineMats.add(solid);
    g.add(new LineSegments2(geom, solid));
    if (xray > 0) {
      const ghost = new LineMaterial({ color, linewidth: width, transparent: true, opacity: xray, depthTest: false, depthWrite: false });
      ghost.resolution.set(w, h);
      this.lineMats.add(ghost);
      const l = new LineSegments2(geom, ghost);
      l.renderOrder = 10;
      g.add(l);
    }
    return g;
  }

  _frustum(camSpec, color) {
    const o = camSpec.origin;
    const cs = camSpec.corners;
    const tip = camSpec.tip;
    const mid = [0.5 * (cs[0][0] + cs[1][0]), 0.5 * (cs[0][1] + cs[1][1]), 0.5 * (cs[0][2] + cs[1][2])];
    const segs = [
      o, cs[0], o, cs[1], o, cs[2], o, cs[3],
      cs[0], cs[1], cs[1], cs[2], cs[2], cs[3], cs[3], cs[0],
      mid, tip,
    ];
    const g = this._lines(segs.flat(), color, 1.6, 1.0, 0.3);

    const planeGeom = new THREE.BufferGeometry();
    planeGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      ...cs[0], ...cs[1], ...cs[2],
      ...cs[0], ...cs[2], ...cs[3],
    ]), 3));
    g.add(new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false,
    })));
    const tex = makeMarkerTexture(color === COL_EXO ? "#0284c7" : "#d97706");
    this._textures.push(tex);
    g.add(makeMarker(o, tex, 11));
    return g;
  }

  setOption(key, value) {
    this.state[key] = value;
    if (key === "autoOrbit") {
      this.controls.autoRotate = Boolean(value);
    }
    if (key === "pointSize" && this.pointsObj) {
      this.pointsObj.material.size = Number(value) * 1.24;
    }
    if (key === "tint" || key === "includeEgo") {
      this._rebuildPointCloud();
    }
    this._syncVisibility();
  }

  _startFlyTo(targetPos, targetLook = new THREE.Vector3(0, 0, 0), duration = 0.7) {
    this._fly = {
      startPos: this.camera.position.clone(),
      endPos: targetPos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: targetLook.clone(),
      t0: this.clock.getElapsedTime(),
      dur: duration,
    };
  }

  flyToPreset(preset = "default") {
    if (!this.currentMeta) return;
    const m = this.currentMeta;
    const exo = new THREE.Vector3(...m.exo_cam.origin);
    const ego = new THREE.Vector3(...m.ego_cam.origin);
    const mid = exo.clone().lerp(ego, 0.55);
    const r = Math.max(m.orbit_r || 3.2, 2.0);

    if (preset === "default") {
      const eye = new THREE.Vector3(m.init_eye[0] * 1.10, m.init_eye[1] * 1.10, m.init_eye[2] * 1.10);
      this._startFlyTo(eye, new THREE.Vector3(0, 0, 0));
    } else if (preset === "exo") {
      const rayDir = ego.clone().sub(exo).normalize();
      const pos = exo.clone().addScaledVector(rayDir, -Math.max(0.45, r * 0.28)).add(new THREE.Vector3(0, r * 0.08, 0));
      this._startFlyTo(pos, ego.clone());
    } else if (preset === "top") {
      const pos = new THREE.Vector3(mid.x, mid.y + r * 1.18, mid.z + r * 0.22);
      this._startFlyTo(pos, mid);
    } else if (preset === "side") {
      const rayDir = ego.clone().sub(exo);
      rayDir.y = 0;
      if (rayDir.lengthSq() < 1e-4) rayDir.set(0, 0, -1);
      rayDir.normalize();
      const perp = new THREE.Vector3(-rayDir.z, 0, rayDir.x).normalize();
      const pos = mid.clone().addScaledVector(perp, r * 0.96).add(new THREE.Vector3(0, r * 0.24, 0));
      this._startFlyTo(pos, mid);
    }
  }

  resetCamera() {
    this.flyToPreset("default");
  }

  highlightCandidate(candId) {
    this.highlightedId = candId;
    if (this.inspectGroup && this.sceneGroup) {
      this.sceneGroup.remove(this.inspectGroup);
      this.inspectGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          this.lineMats.delete(o.material);
          o.material.dispose();
        }
      });
      this.inspectGroup = null;
    }
    for (const p of this.pins) {
      const isHi = candId !== null && p.candId === candId;
      p.el.classList.toggle("highlighted", isHi);
    }
    if (candId === null || !this.currentMeta || !this.sceneGroup) return;
    const c = (this.currentMeta.candidates || []).find((x) => x.id === candId && x.pos);
    if (!c) return;
    const col = c.is_wearer ? COL_WEARER : COL_INSPECT;
    const grp = this._lines([...this.currentMeta.exo_cam.origin, ...c.pos], col, 1.4, 0.9, 0.5);
    const tex = makeMarkerTexture(c.is_wearer ? "#10b981" : "#f43f5e", true);
    this._textures.push(tex);
    grp.add(makeMarker(c.pos, tex, 30));
    this.inspectGroup = grp;
    this.sceneGroup.add(grp);
  }

  async loadScene(tag) {
    const token = ++this.loadSeq;
    this.statusEl.textContent = "Loading 3D point cloud…";
    this.statusEl.classList.remove("hidden");

    try {
      let entry = this.cache.get(tag);
      if (!entry) {
        const [metaRes, binRes] = await Promise.all([
          fetch(`./assets/scenes/${tag}.json`),
          fetch(`./assets/scenes/${tag}.bin`),
        ]);
        if (!metaRes.ok || !binRes.ok) throw new Error("Failed to fetch 3D scene");
        const meta = await metaRes.json();
        const buf = await binRes.arrayBuffer();
        const n = meta.n_points;
        let pos;
        if (meta.pos_quant) {
          const qpos = new Int16Array(buf, meta.offsets.pos, n * 3);
          pos = new Float32Array(n * 3);
          const mn = meta.pos_quant.min;
          const sc = meta.pos_quant.scale;
          for (let i = 0; i < n; i++) {
            const j = i * 3;
            pos[j] = mn[0] + (qpos[j] + 32768) * sc[0];
            pos[j + 1] = mn[1] + (qpos[j + 1] + 32768) * sc[1];
            pos[j + 2] = mn[2] + (qpos[j + 2] + 32768) * sc[2];
          }
        } else {
          pos = new Float32Array(buf, meta.offsets.pos, n * 3);
        }
        const rgb = new Uint8Array(buf, meta.offsets.rgb, n * 3);
        const view = new Uint8Array(buf, meta.offsets.view, n);
        const cand = new Int16Array(buf, meta.offsets.cand, n);
        entry = { meta, pos, rgb, view, cand };
        this.cache.set(tag, entry);
      }
      if (token !== this.loadSeq) return null;
      this._mountScene(entry);
      this.statusEl.classList.add("hidden");
      return entry.meta;
    } catch (err) {
      if (token === this.loadSeq) {
        this.statusEl.textContent = "3D scene load error: " + err.message;
      }
      return null;
    }
  }

  _clearCurrent() {
    this._fly = null;
    this.highlightedId = null;
    if (this.sceneGroup) {
      this.scene.remove(this.sceneGroup);
      this.sceneGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.sceneGroup = null;
    }
    for (const t of this._textures || []) t.dispose();
    this._textures = [];
    this.lineMats.clear();
    this.gridObj = null;
    this.pointsObj = null;
    this.camGroup = null;
    this.rayGroup = null;
    this.otherDotsGroup = null;
    this.wearerGroup = null;
    this.wearerPulse = null;
    this.rayPulse = null;
    this.rayPulse2 = null;
    this.inspectGroup = null;
    this.labelsEl.innerHTML = "";
    this.pins = [];
  }

  _rebuildGrid() {
    if (!this.sceneGroup || !this.currentMeta) return;
    if (this.gridObj) {
      this.sceneGroup.remove(this.gridObj);
      this.gridObj.geometry.dispose();
      this.gridObj.material.dispose();
      this.gridObj = null;
    }
    const gSize = Math.max(this.currentMeta.orbit_r * 1.45, 2.5);
    this.gridObj = new THREE.GridHelper(gSize, 14, 0xd5dde8, 0xe8edf3);
    this.gridObj.position.y = this.currentMeta.y_floor;
    this.sceneGroup.add(this.gridObj);
  }

  _mountScene(entry) {
    this._clearCurrent();
    this.currentMeta = entry.meta;
    this.rawScene = entry;

    const meta = entry.meta;
    const root = new THREE.Group();
    this.sceneGroup = root;
    this.scene.add(root);

    this._rebuildGrid();
    this._rebuildPointCloud();

    this.camGroup = new THREE.Group();
    this.camGroup.add(this._frustum(meta.exo_cam, COL_EXO));
    this.camGroup.add(this._frustum(meta.ego_cam, COL_EGO));
    root.add(this.camGroup);

    this.rayGroup = new THREE.Group();
    const rs = meta.ray.start;
    const re = meta.ray.end;
    this.rayGroup.add(this._lines([...rs, ...re], COL_RAY, 7, 0.16, 0));
    this.rayGroup.add(this._lines([...rs, ...re], COL_EGO, 2.2, 1.0, 0.55));
    const goldTex = makeMarkerTexture("#f59e0b");
    const greenTex = makeMarkerTexture("#10b981");
    this._textures.push(goldTex, greenTex);
    this.rayPulse = makeMarker(rs, goldTex, 10);
    this.rayPulse2 = makeMarker(rs, greenTex, 8, 0.9);
    this.rayGroup.add(this.rayPulse);
    this.rayGroup.add(this.rayPulse2);
    root.add(this.rayGroup);

    this.wearerGroup = new THREE.Group();
    const wCand = meta.candidates.find((c) => c.is_wearer && c.pos);
    if (wCand) {
      const wTex = makeMarkerTexture("#059669");
      const ringTex = makeMarkerTexture("#10b981", true);
      this._textures.push(wTex, ringTex);
      this.wearerGroup.add(makeMarker(wCand.pos, wTex, 15));
      this.wearerPulse = makeMarker(wCand.pos, ringTex, 26, 0.8);
      this.wearerGroup.add(this.wearerPulse);
    }
    root.add(this.wearerGroup);

    this.otherDotsGroup = new THREE.Group();
    const redTex = makeMarkerTexture("#dc2626");
    this._textures.push(redTex);
    for (const c of meta.candidates) {
      if (c.is_wearer || !c.pos) continue;
      this.otherDotsGroup.add(makeMarker(c.pos, redTex, 12));
    }
    root.add(this.otherDotsGroup);

    const addPin = (pos, text, cls, groupKey, candId = null) => {
      const el = document.createElement("div");
      el.className = `i3d-pin ${cls}`;
      el.textContent = text;
      if (candId !== null) {
        el.style.pointerEvents = "auto";
        el.style.cursor = "pointer";
        el.addEventListener("mouseenter", () => {
          this.highlightCandidate(candId);
          if (this.onPinSelect) this.onPinSelect(candId);
        });
        el.addEventListener("mouseleave", () => {
          this.highlightCandidate(null);
          if (this.onPinSelect) this.onPinSelect(null);
        });
      }
      this.labelsEl.appendChild(el);
      this.pins.push({ pos: new THREE.Vector3(...pos), el, groupKey, candId });
    };
    addPin(meta.exo_cam.origin, "Exo cam", "exo", "cameras");
    addPin(meta.ego_cam.origin, "Ego cam", "ego", "cameras");
    if (wCand) {
      addPin(wCand.pos, `Wearer #${wCand.id}`, "wearer", "ray", wCand.id);
    }
    for (const c of meta.candidates) {
      if (c.is_wearer || !c.pos) continue;
      addPin(c.pos, `#${c.id}`, "other", "redDots", c.id);
    }

    this.controls.minDistance = Math.max(0.25, meta.orbit_r * 0.22);
    this.controls.maxDistance = Math.max(4.0, meta.orbit_r * 3.2);
    const eye = meta.init_eye;
    this.camera.position.set(eye[0] * 1.10, eye[1] * 1.10, eye[2] * 1.10);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this._syncVisibility();
  }

  _rebuildPointCloud() {
    if (!this.rawScene || !this.sceneGroup) return;
    if (this.pointsObj) {
      this.sceneGroup.remove(this.pointsObj);
      this.pointsObj.geometry.dispose();
      this.pointsObj.material.dispose();
      this.pointsObj = null;
    }
    const { meta, pos, rgb, view, cand } = this.rawScene;
    const includeEgo = this.state.includeEgo;
    const tint = this.state.tint;
    const wearer = meta.wearer;
    const n = meta.n_points;

    let count = 0;
    for (let i = 0; i < n; i++) {
      if (includeEgo || view[i] === 0) count++;
    }
    const outPos = new Float32Array(count * 3);
    const outCol = new Float32Array(count * 3);
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (!includeEgo && view[i] !== 0) continue;
      const i3 = i * 3;
      const j3 = j * 3;
      outPos[j3] = pos[i3];
      outPos[j3 + 1] = pos[i3 + 1];
      outPos[j3 + 2] = pos[i3 + 2];
      let r = rgb[i3];
      let g = rgb[i3 + 1];
      let b = rgb[i3 + 2];
      if (tint && cand[i] >= 0) {
        if (cand[i] === wearer) {
          r = r * 0.48 + RGB_WEARER[0] * 0.52;
          g = g * 0.48 + RGB_WEARER[1] * 0.52;
          b = b * 0.48 + RGB_WEARER[2] * 0.52;
        } else {
          r = r * 0.58 + RGB_OTHER[0] * 0.42;
          g = g * 0.58 + RGB_OTHER[1] * 0.42;
          b = b * 0.58 + RGB_OTHER[2] * 0.42;
        }
      }
      const m = (r + g + b) / 3.0;
      r = Math.max(0, Math.min(255, m + (r - m) * 1.18));
      g = Math.max(0, Math.min(255, m + (g - m) * 1.18));
      b = Math.max(0, Math.min(255, m + (b - m) * 1.18));
      outCol[j3] = r / 255;
      outCol[j3 + 1] = g / 255;
      outCol[j3 + 2] = b / 255;
      j++;
    }
    if (!this._circleTex) this._circleTex = makeCircleSpriteTexture();
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(outCol, 3));
    const mat = new THREE.PointsMaterial({
      size: Number(this.state.pointSize) * 1.24,
      sizeAttenuation: false,
      vertexColors: true,
      map: this._circleTex,
      alphaTest: 0.28,
      transparent: false,
    });
    this.pointsObj = new THREE.Points(geom, mat);
    this.sceneGroup.add(this.pointsObj);
  }

  _syncVisibility() {
    if (this.camGroup) this.camGroup.visible = Boolean(this.state.cameras);
    if (this.rayGroup) this.rayGroup.visible = Boolean(this.state.ray);
    if (this.wearerGroup) this.wearerGroup.visible = Boolean(this.state.ray || this.state.redDots);
    if (this.otherDotsGroup) this.otherDotsGroup.visible = Boolean(this.state.redDots);
  }

  _updatePins() {
    if (!this.pins.length) return;
    const w = this.hostEl.clientWidth;
    const h = this.hostEl.clientHeight;
    const v = new THREE.Vector3();
    for (const p of this.pins) {
      let show = true;
      if (p.groupKey === "cameras" && !this.state.cameras) show = false;
      if (p.groupKey === "ray" && !(this.state.ray || this.state.redDots)) show = false;
      if (p.groupKey === "redDots" && !this.state.redDots) show = false;
      if (!show) {
        p.el.style.display = "none";
        continue;
      }
      v.copy(p.pos).project(this.camera);
      if (v.z < -1 || v.z > 1) {
        p.el.style.display = "none";
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      if (x < -40 || x > w + 40 || y < 40 || y > h - 56) {
        p.el.style.display = "none";
        continue;
      }
      p.el.style.display = "";
      p.el.style.left = `${x.toFixed(1)}px`;
      p.el.style.top = `${y.toFixed(1)}px`;
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if (!this._inView) return;
    const t = this.clock.getElapsedTime();

    if (this._fly) {
      const raw = Math.min(1.0, (t - this._fly.t0) / this._fly.dur);
      const u = 1.0 - Math.pow(1.0 - raw, 3);
      this.camera.position.lerpVectors(this._fly.startPos, this._fly.endPos, u);
      this.controls.target.lerpVectors(this._fly.startTarget, this._fly.endTarget, u);
      if (raw >= 1.0) this._fly = null;
    }

    if (this.wearerPulse) {
      const phase = (t * 0.6) % 1.0;
      this.wearerPulse.material.size = 18 + phase * 26;
      this.wearerPulse.material.opacity = 0.85 * (1.0 - phase);
    }
    if (this.rayPulse && this.currentMeta && this.state.ray) {
      const s = this.currentMeta.ray.start;
      const e = this.currentMeta.ray.end;
      const u1 = (t * 0.32) % 1.0;
      const u2 = (u1 + 0.5) % 1.0;
      const p1 = this.rayPulse.geometry.attributes.position;
      p1.setXYZ(0, s[0] + (e[0] - s[0]) * u1, s[1] + (e[1] - s[1]) * u1, s[2] + (e[2] - s[2]) * u1);
      p1.needsUpdate = true;
      const p2 = this.rayPulse2.geometry.attributes.position;
      p2.setXYZ(0, s[0] + (e[0] - s[0]) * u2, s[1] + (e[1] - s[1]) * u2, s[2] + (e[2] - s[2]) * u2);
      p2.needsUpdate = true;
    }
    this.controls.autoRotate = Boolean(this.state.autoOrbit) && !this._userInteracting && !this._fly;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._updatePins();
  }
}
