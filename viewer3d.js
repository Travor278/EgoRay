import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COL_EXO = 0x0284c7;
const COL_EGO = 0xd97706;
const COL_RAY = 0xf59e0b;
const COL_WEARER = 0x059669;
const COL_OTHER = 0xdc2626;
const RGB_WEARER = [16, 185, 129];
const RGB_OTHER = [239, 68, 68];

function makeCircleSpriteTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const r = size * 0.5;
  const grad = ctx.createRadialGradient(r, r, r * 0.15, r, r, r);
  grad.addColorStop(0.0, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.76, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.93, "rgba(255,255,255,0.45)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeTube(a, b, radius, colorHex, opacity = 1.0) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(vb, va);
  const len = dir.length();
  if (len < 1e-5) return null;
  const geom = new THREE.CylinderGeometry(radius, radius, len, 10, 1, false);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: opacity < 1.0,
    opacity,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(va).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function makeFrustumGroup(camSpec, radius, colorHex) {
  const g = new THREE.Group();
  const o = camSpec.origin;
  const cs = camSpec.corners;
  const tip = camSpec.tip;
  const segs = [
    [o, cs[0]], [o, cs[1]], [o, cs[2]], [o, cs[3]],
    [cs[0], cs[1]], [cs[1], cs[2]], [cs[2], cs[3]], [cs[3], cs[0]],
    [[0.5 * (cs[0][0] + cs[1][0]), 0.5 * (cs[0][1] + cs[1][1]), 0.5 * (cs[0][2] + cs[1][2])], tip],
  ];
  for (const [a, b] of segs) {
    const t = makeTube(a, b, radius, colorHex);
    if (t) g.add(t);
  }
  const sp = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.5, 14, 14),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  sp.position.set(...o);
  g.add(sp);
  return g;
}

export class EgoRay3DViewer {
  constructor(hostEl, labelsEl, statusEl) {
    this.hostEl = hostEl;
    this.labelsEl = labelsEl;
    this.statusEl = statusEl;
    this.cache = new Map();
    this.state = {
      redDots: true,
      tint: true,
      cameras: true,
      ray: true,
      includeEgo: true,
      autoOrbit: true,
      darkBg: false,
      pointSize: 3.5,
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
    this.wearerRing = null;
    this.rayPulse = null;
    this.pins = [];
    this.loadSeq = 0;

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
    this.controls.autoRotateSpeed = 0.55;
    this.controls.addEventListener("start", () => {
      this._userInteracting = true;
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
    this.resize();
    this.clock = new THREE.Clock();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  resize() {
    const w = Math.max(10, this.hostEl.clientWidth);
    const h = Math.max(10, this.hostEl.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setOption(key, value) {
    this.state[key] = value;
    if (key === "autoOrbit") {
      this.controls.autoRotate = Boolean(value);
    }
    if (key === "pointSize" && this.pointsObj) {
      this.pointsObj.material.size = Number(value) * 1.18;
    }
    if (key === "darkBg") {
      this._rebuildGrid();
    }
    if (key === "tint" || key === "includeEgo") {
      this._rebuildPointCloud();
    }
    this._syncVisibility();
  }

  resetCamera() {
    if (!this.currentMeta) return;
    const eye = this.currentMeta.init_eye;
    this.camera.position.set(eye[0] * 1.08, eye[1] * 1.08, eye[2] * 1.08);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
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
    if (this.sceneGroup) {
      this.scene.remove(this.sceneGroup);
      this.sceneGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.sceneGroup = null;
    }
    this.gridObj = null;
    this.pointsObj = null;
    this.camGroup = null;
    this.rayGroup = null;
    this.otherDotsGroup = null;
    this.wearerGroup = null;
    this.wearerRing = null;
    this.rayPulse = null;
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
    const gSize = Math.max(this.currentMeta.orbit_r * 1.4, 2.5);
    const c1 = this.state.darkBg ? 0x2a364c : 0xcbd5e1;
    const c2 = this.state.darkBg ? 0x1e2738 : 0xe2e8f0;
    this.gridObj = new THREE.GridHelper(gSize, 12, c1, c2);
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

    const rad = Math.max(meta.cam_d * 0.044, 0.0085);

    this.camGroup = new THREE.Group();
    this.camGroup.add(makeFrustumGroup(meta.exo_cam, rad, COL_EXO));
    this.camGroup.add(makeFrustumGroup(meta.ego_cam, rad, COL_EGO));
    root.add(this.camGroup);

    this.rayGroup = new THREE.Group();
    const outerBeam = makeTube(meta.ray.start, meta.ray.end, rad * 2.2, COL_RAY, 0.34);
    const coreBeam = makeTube(meta.ray.start, meta.ray.end, rad * 1.05, COL_EGO, 0.96);
    if (outerBeam) this.rayGroup.add(outerBeam);
    if (coreBeam) this.rayGroup.add(coreBeam);
    this.rayPulse = new THREE.Mesh(
      new THREE.SphereGeometry(rad * 2.5, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    );
    this.rayGroup.add(this.rayPulse);
    root.add(this.rayGroup);

    this.wearerGroup = new THREE.Group();
    const wCand = meta.candidates.find((c) => c.is_wearer && c.pos);
    if (wCand) {
      const wDot = new THREE.Mesh(
        new THREE.SphereGeometry(rad * 3.1, 18, 18),
        new THREE.MeshBasicMaterial({ color: COL_WEARER })
      );
      wDot.position.set(...wCand.pos);
      this.wearerGroup.add(wDot);

      const ringGeom = new THREE.RingGeometry(rad * 4.3, rad * 5.8, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: COL_WEARER,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      });
      this.wearerRing = new THREE.Mesh(ringGeom, ringMat);
      this.wearerRing.position.set(...wCand.pos);
      this.wearerGroup.add(this.wearerRing);
    }
    root.add(this.wearerGroup);

    this.otherDotsGroup = new THREE.Group();
    for (const c of meta.candidates) {
      if (c.is_wearer || !c.pos) continue;
      const rDot = new THREE.Mesh(
        new THREE.SphereGeometry(rad * 2.9, 16, 16),
        new THREE.MeshBasicMaterial({ color: COL_OTHER })
      );
      rDot.position.set(...c.pos);
      this.otherDotsGroup.add(rDot);

      const rHalo = new THREE.Mesh(
        new THREE.SphereGeometry(rad * 4.4, 16, 16),
        new THREE.MeshBasicMaterial({
          color: COL_OTHER,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
        })
      );
      rHalo.position.set(...c.pos);
      this.otherDotsGroup.add(rHalo);
    }
    root.add(this.otherDotsGroup);

    const addPin = (pos, text, cls, groupKey) => {
      const el = document.createElement("div");
      el.className = `i3d-pin ${cls}`;
      el.textContent = text;
      this.labelsEl.appendChild(el);
      this.pins.push({ pos: new THREE.Vector3(...pos), el, groupKey });
    };
    addPin(meta.exo_cam.origin, "Exo Cam", "exo", "cameras");
    addPin(meta.ego_cam.origin, "Ego Cam", "ego", "cameras");
    if (wCand) {
      addPin(wCand.pos, `Wearer #${wCand.id}`, "wearer", "ray");
    }
    for (const c of meta.candidates) {
      if (c.is_wearer || !c.pos) continue;
      addPin(c.pos, `#${c.id}`, "other", "redDots");
    }

    this.controls.minDistance = Math.max(0.25, meta.orbit_r * 0.25);
    this.controls.maxDistance = Math.max(4.0, meta.orbit_r * 3.0);
    this.resetCamera();
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
          r = r * 0.50 + RGB_WEARER[0] * 0.50;
          g = g * 0.50 + RGB_WEARER[1] * 0.50;
          b = b * 0.50 + RGB_WEARER[2] * 0.50;
        } else {
          r = r * 0.60 + RGB_OTHER[0] * 0.40;
          g = g * 0.60 + RGB_OTHER[1] * 0.40;
          b = b * 0.60 + RGB_OTHER[2] * 0.40;
        }
      }
      const m = (r + g + b) / 3.0;
      r = Math.max(0, Math.min(255, m + (r - m) * 1.12));
      g = Math.max(0, Math.min(255, m + (g - m) * 1.12));
      b = Math.max(0, Math.min(255, m + (b - m) * 1.12));
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
      size: Number(this.state.pointSize) * 1.18,
      sizeAttenuation: false,
      vertexColors: true,
      map: this._circleTex,
      alphaTest: 0.35,
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
      if (x < -40 || x > w + 40 || y < 40 || y > h - 54) {
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
    const t = this.clock.getElapsedTime();
    if (this.wearerRing) {
      this.wearerRing.lookAt(this.camera.position);
      const s = 1.0 + 0.20 * Math.sin(t * 2.6);
      this.wearerRing.scale.set(s, s, 1);
    }
    if (this.rayPulse && this.currentMeta && this.state.ray) {
      const u = (t * 0.35) % 1.0;
      const s = this.currentMeta.ray.start;
      const e = this.currentMeta.ray.end;
      this.rayPulse.position.set(
        s[0] + (e[0] - s[0]) * u,
        s[1] + (e[1] - s[1]) * u,
        s[2] + (e[2] - s[2]) * u
      );
    }
    this.controls.autoRotate = Boolean(this.state.autoOrbit) && !this._userInteracting;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._updatePins();
  }
}
