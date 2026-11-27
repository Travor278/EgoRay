import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

function makeTube(a, b, radius, colorHex, opacity = 1.0) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(vb, va);
  const len = dir.length();
  if (len < 1e-5) return null;
  const geom = new THREE.CylinderGeometry(radius, radius, len, 12, 1, false);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: opacity < 1.0,
    opacity,
    depthWrite: opacity >= 0.99,
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
    new THREE.SphereGeometry(radius * 2.1, 16, 16),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  sp.position.set(...o);
  g.add(sp);

  // Subtle translucent lens plane inside frustum
  const planeGeom = new THREE.BufferGeometry();
  const verts = new Float32Array([
    ...cs[0], ...cs[1], ...cs[2],
    ...cs[0], ...cs[2], ...cs[3],
  ]);
  planeGeom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const planeMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  g.add(new THREE.Mesh(planeGeom, planeMat));
  return g;
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
      darkBg: false,
      pointSize: 3.8,
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
    this.wearerRing2 = null;
    this.rayPulse = null;
    this.rayPulse2 = null;
    this.inspectGroup = null;
    this.highlightedId = null;
    this.candMeshes = new Map();
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
    this.controls.autoRotateSpeed = 0.50;
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

  _startFlyTo(targetPos, targetLook = new THREE.Vector3(0, 0, 0), duration = 0.65) {
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
        if (o.material) o.material.dispose();
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
    const grp = new THREE.Group();
    const rad = Math.max(this.currentMeta.cam_d * 0.044, 0.0085);
    const col = c.is_wearer ? COL_WEARER : COL_INSPECT;

    // Dashed inspection line from Exo Cam to inspected candidate
    const va = new THREE.Vector3(...this.currentMeta.exo_cam.origin);
    const vb = new THREE.Vector3(...c.pos);
    const lineGeom = new THREE.BufferGeometry().setFromPoints([va, vb]);
    const lineMat = new THREE.LineDashedMaterial({
      color: col,
      dashSize: rad * 5.0,
      gapSize: rad * 3.0,
      transparent: true,
      opacity: 0.92,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    line.computeLineDistances();
    grp.add(line);

    // Highlight halo sphere on candidate
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(rad * 5.8, 18, 18),
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
    );
    halo.position.set(...c.pos);
    grp.add(halo);

    this.inspectGroup = grp;
    this.sceneGroup.add(grp);
  }

  async loadScene(tag) {
    const token = ++this.loadSeq;
    this.statusEl.textContent = "Loading dense 3D point cloud…";
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
    this.candMeshes.clear();
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
    this.wearerRing2 = null;
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
    const c1 = this.state.darkBg ? 0x2a364c : 0xcbd5e1;
    const c2 = this.state.darkBg ? 0x1e2738 : 0xe2e8f0;
    this.gridObj = new THREE.GridHelper(gSize, 14, c1, c2);
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
    const camRad = rad * 0.34;

    this.camGroup = new THREE.Group();
    this.camGroup.add(makeFrustumGroup(meta.exo_cam, camRad, COL_EXO));
    this.camGroup.add(makeFrustumGroup(meta.ego_cam, camRad, COL_EGO));
    root.add(this.camGroup);

    this.rayGroup = new THREE.Group();
    const outerBeam = makeTube(meta.ray.start, meta.ray.end, rad * 2.4, COL_RAY, 0.28);
    const coreBeam = makeTube(meta.ray.start, meta.ray.end, rad * 1.05, COL_EGO, 0.96);
    if (outerBeam) this.rayGroup.add(outerBeam);
    if (coreBeam) this.rayGroup.add(coreBeam);
    this.rayPulse = new THREE.Mesh(
      new THREE.SphereGeometry(rad * 2.6, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
    );
    this.rayPulse2 = new THREE.Mesh(
      new THREE.SphereGeometry(rad * 2.2, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.85 })
    );
    this.rayGroup.add(this.rayPulse);
    this.rayGroup.add(this.rayPulse2);
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
      this.candMeshes.set(wCand.id, wDot);

      const ringGeom = new THREE.RingGeometry(rad * 4.2, rad * 5.6, 36);
      const ringMat = new THREE.MeshBasicMaterial({
        color: COL_WEARER,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      });
      this.wearerRing = new THREE.Mesh(ringGeom, ringMat);
      this.wearerRing.position.set(...wCand.pos);
      this.wearerGroup.add(this.wearerRing);

      const ring2Geom = new THREE.RingGeometry(rad * 5.8, rad * 6.8, 36);
      const ring2Mat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
      });
      this.wearerRing2 = new THREE.Mesh(ring2Geom, ring2Mat);
      this.wearerRing2.position.set(...wCand.pos);
      this.wearerGroup.add(this.wearerRing2);
    }
    root.add(this.wearerGroup);

    this.otherDotsGroup = new THREE.Group();
    for (const c of meta.candidates) {
      if (c.is_wearer || !c.pos) continue;
      const rDot = new THREE.Mesh(
        new THREE.SphereGeometry(rad * 2.8, 16, 16),
        new THREE.MeshBasicMaterial({ color: COL_OTHER })
      );
      rDot.position.set(...c.pos);
      this.otherDotsGroup.add(rDot);
      this.candMeshes.set(c.id, rDot);

      const rHalo = new THREE.Mesh(
        new THREE.SphereGeometry(rad * 4.3, 16, 16),
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
    addPin(meta.exo_cam.origin, "Exo Cam", "exo", "cameras");
    addPin(meta.ego_cam.origin, "Ego Cam", "ego", "cameras");
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

    if (this.wearerRing) {
      this.wearerRing.lookAt(this.camera.position);
      const s = 1.0 + 0.18 * Math.sin(t * 2.6);
      this.wearerRing.scale.set(s, s, 1);
    }
    if (this.wearerRing2) {
      this.wearerRing2.lookAt(this.camera.position);
      const phase = (t * 0.65) % 1.0;
      const s2 = 0.85 + phase * 1.15;
      this.wearerRing2.scale.set(s2, s2, 1);
      this.wearerRing2.material.opacity = 0.55 * (1.0 - phase);
    }
    if (this.rayPulse && this.currentMeta && this.state.ray) {
      const s = this.currentMeta.ray.start;
      const e = this.currentMeta.ray.end;
      const u1 = (t * 0.36) % 1.0;
      const u2 = (u1 + 0.5) % 1.0;
      this.rayPulse.position.set(s[0] + (e[0] - s[0]) * u1, s[1] + (e[1] - s[1]) * u1, s[2] + (e[2] - s[2]) * u1);
      if (this.rayPulse2) {
        this.rayPulse2.position.set(s[0] + (e[0] - s[0]) * u2, s[1] + (e[1] - s[1]) * u2, s[2] + (e[2] - s[2]) * u2);
      }
    }
    this.controls.autoRotate = Boolean(this.state.autoOrbit) && !this._userInteracting && !this._fly;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._updatePins();
  }
}
