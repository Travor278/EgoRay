// Canvas 2D point-cloud viewer used when WebGL is unavailable. Same interface as EgoRay3DViewer.
const RGB_WEARER = [16, 185, 129];
const RGB_OTHER = [239, 68, 68];
const MAX_POINTS = 80000;
const FOV = (44 * Math.PI) / 180;
const NEAR = 0.05;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class SoftCloudViewer {
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
    this.cloud = null;
    this.pins = [];
    this.highlightedId = null;
    this.loadSeq = 0;
    this.fly = null;
    this.target = [0, 0, 0];
    this.sph = { r: 4, az: 0, el: 0.3 };
    this.dragging = false;
    this.t = 0;

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.hostEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.layer = document.createElement("canvas");
    this.layerCtx = this.layer.getContext("2d");
    this.buf = null;

    this._bindPointer();
    this._inView = true;
    if (typeof IntersectionObserver !== "undefined") {
      this._io = new IntersectionObserver((es) => {
        this._inView = es.some((e) => e.isIntersecting);
      }, { threshold: 0.01 });
      this._io.observe(this.hostEl);
    }
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _bindPointer() {
    const c = this.canvas;
    let lx = 0, ly = 0;
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.fly = null;
      lx = e.clientX;
      ly = e.clientY;
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      this.sph.az -= dx * 0.008;
      this.sph.el = clamp(this.sph.el + dy * 0.008, -0.2, 1.48);
    });
    const end = () => { this.dragging = false; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("wheel", (e) => {
      if (!this.currentMeta) return;
      e.preventDefault();
      this.fly = null;
      const r0 = this.currentMeta.orbit_r;
      this.sph.r = clamp(this.sph.r * Math.exp(e.deltaY * 0.0012), Math.max(0.25, r0 * 0.22), Math.max(4, r0 * 3.2));
    }, { passive: false });
  }

  _eye() {
    const { r, az, el } = this.sph;
    return [
      this.target[0] + r * Math.cos(el) * Math.sin(az),
      this.target[1] + r * Math.sin(el),
      this.target[2] + r * Math.cos(el) * Math.cos(az),
    ];
  }

  _setView(eye, target) {
    this.target = target.slice();
    const d = sub(eye, target);
    const r = Math.hypot(d[0], d[1], d[2]) || 1;
    this.sph = { r, az: Math.atan2(d[0], d[2]), el: Math.asin(clamp(d[1] / r, -1, 1)) };
  }

  setOption(key, value) {
    this.state[key] = value;
    if (key === "tint" || key === "includeEgo") this._buildColors();
  }

  flyToPreset(preset = "default") {
    const m = this.currentMeta;
    if (!m) return;
    const exo = m.exo_cam.origin, ego = m.ego_cam.origin;
    const mid = lerp3(exo, ego, 0.55);
    const r = Math.max(m.orbit_r || 3.2, 2.0);
    let eye, look;
    if (preset === "exo") {
      const dir = norm(sub(ego, exo));
      const back = Math.max(0.45, r * 0.28);
      eye = [exo[0] - dir[0] * back, exo[1] - dir[1] * back + r * 0.08, exo[2] - dir[2] * back];
      look = ego.slice();
    } else if (preset === "top") {
      eye = [mid[0], mid[1] + r * 1.18, mid[2] + r * 0.22];
      look = mid;
    } else if (preset === "side") {
      let d = sub(ego, exo);
      d[1] = 0;
      if (Math.hypot(d[0], d[2]) < 1e-2) d = [0, 0, -1];
      d = norm(d);
      const perp = norm([-d[2], 0, d[0]]);
      eye = [mid[0] + perp[0] * r * 0.96, mid[1] + r * 0.24, mid[2] + perp[2] * r * 0.96];
      look = mid;
    } else {
      eye = m.init_eye.map((v) => v * 1.1);
      look = [0, 0, 0];
    }
    this.fly = { e0: this._eye(), t0: this.target.slice(), e1: eye, t1: look, start: this.t, dur: 0.7 };
  }

  resetCamera() {
    this.flyToPreset("default");
  }

  highlightCandidate(candId) {
    this.highlightedId = candId;
    for (const p of this.pins) p.el.classList.toggle("highlighted", candId !== null && p.candId === candId);
  }

  async loadScene(tag) {
    const token = ++this.loadSeq;
    this.statusEl.textContent = "Loading 3D point cloud…";
    this.statusEl.classList.remove("hidden");
    try {
      let entry = this.cache.get(tag);
      if (!entry) {
        const [mRes, bRes] = await Promise.all([fetch(`./assets/scenes/${tag}.json`), fetch(`./assets/scenes/${tag}.bin`)]);
        if (!mRes.ok || !bRes.ok) throw new Error("Failed to fetch 3D scene");
        const meta = await mRes.json();
        const buf = await bRes.arrayBuffer();
        const n = meta.n_points;
        const qpos = new Int16Array(buf, meta.offsets.pos, n * 3);
        const rgb = new Uint8Array(buf, meta.offsets.rgb, n * 3);
        const view = new Uint8Array(buf, meta.offsets.view, n);
        const cand = new Int16Array(buf, meta.offsets.cand, n);
        let nCand = 0;
        for (let i = 0; i < n; i++) if (cand[i] >= 0) nCand++;
        const stride = Math.max(1, Math.ceil((n - nCand) / Math.max(1, MAX_POINTS - nCand)));
        const keep = [];
        for (let i = 0; i < n; i++) if (cand[i] >= 0 || i % stride === 0) keep.push(i);
        const m = keep.length;
        const pos = new Float32Array(m * 3);
        const mn = meta.pos_quant.min, sc = meta.pos_quant.scale;
        const kRgb = new Uint8Array(m * 3), kView = new Uint8Array(m), kCand = new Int16Array(m);
        for (let k = 0; k < m; k++) {
          const i = keep[k], i3 = i * 3, k3 = k * 3;
          pos[k3] = mn[0] + (qpos[i3] + 32768) * sc[0];
          pos[k3 + 1] = mn[1] + (qpos[i3 + 1] + 32768) * sc[1];
          pos[k3 + 2] = mn[2] + (qpos[i3 + 2] + 32768) * sc[2];
          kRgb[k3] = rgb[i3];
          kRgb[k3 + 1] = rgb[i3 + 1];
          kRgb[k3 + 2] = rgb[i3 + 2];
          kView[k] = view[i];
          kCand[k] = cand[i];
        }
        entry = { meta, pos, rgb: kRgb, view: kView, cand: kCand, count: m };
        this.cache.set(tag, entry);
      }
      if (token !== this.loadSeq) return null;
      this._mount(entry);
      this.statusEl.classList.add("hidden");
      return entry.meta;
    } catch (err) {
      if (token === this.loadSeq) this.statusEl.textContent = "3D scene load error: " + err.message;
      return null;
    }
  }

  _mount(entry) {
    this.cloud = entry;
    this.currentMeta = entry.meta;
    this.fly = null;
    this.highlightedId = null;
    this._buildColors();
    this._setView(entry.meta.init_eye.map((v) => v * 1.1), [0, 0, 0]);

    this.labelsEl.innerHTML = "";
    this.pins = [];
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
      this.pins.push({ pos, el, groupKey, candId });
    };
    const meta = entry.meta;
    addPin(meta.exo_cam.origin, "Exo cam", "exo", "cameras");
    addPin(meta.ego_cam.origin, "Ego cam", "ego", "cameras");
    const w = meta.candidates.find((c) => c.is_wearer && c.pos);
    if (w) addPin(w.pos, `Wearer #${w.id}`, "wearer", "ray", w.id);
    for (const c of meta.candidates) {
      if (c.is_wearer || !c.pos) continue;
      addPin(c.pos, `#${c.id}`, "other", "redDots", c.id);
    }
  }

  _buildColors() {
    const e = this.cloud;
    if (!e) return;
    const { rgb, view, cand, count, meta } = e;
    const col = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      if (!this.state.includeEgo && view[i] !== 0) {
        col[i] = 0;
        continue;
      }
      const i3 = i * 3;
      let r = rgb[i3], g = rgb[i3 + 1], b = rgb[i3 + 2];
      if (this.state.tint && cand[i] >= 0) {
        const t = cand[i] === meta.wearer ? RGB_WEARER : RGB_OTHER;
        const a = cand[i] === meta.wearer ? 0.52 : 0.42;
        r = r * (1 - a) + t[0] * a;
        g = g * (1 - a) + t[1] * a;
        b = b * (1 - a) + t[2] * a;
      }
      const m = (r + g + b) / 3;
      r = clamp(m + (r - m) * 1.18, 0, 255) | 0;
      g = clamp(m + (g - m) * 1.18, 0, 255) | 0;
      b = clamp(m + (b - m) * 1.18, 0, 255) | 0;
      col[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    e.col32 = col;
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const cssW = Math.max(10, this.hostEl.clientWidth);
    const cssH = Math.max(10, this.hostEl.clientHeight);
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (this.buf && this.buf.pw === pw && this.buf.ph === ph) return this.buf;
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.layer.width = pw;
    this.layer.height = ph;
    const img = this.layerCtx.createImageData(pw, ph);
    this.buf = { pw, ph, cssW, cssH, dpr, img, px: new Uint32Array(img.data.buffer), z: new Float32Array(pw * ph) };
    return this.buf;
  }

  _camera(eye, target, cssW, cssH) {
    const f = norm(sub(target, eye));
    let r = cross(f, [0, 1, 0]);
    if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0];
    r = norm(r);
    const u = cross(r, f);
    const fl = (cssH * 0.5) / Math.tan(FOV / 2);
    return { eye, f, r, u, fl, cx: cssW * 0.5, cy: cssH * 0.5 };
  }

  _proj(cam, p) {
    const d = sub(p, cam.eye);
    const z = dot(d, cam.f);
    if (z <= NEAR) return null;
    return [cam.cx + (dot(d, cam.r) / z) * cam.fl, cam.cy - (dot(d, cam.u) / z) * cam.fl, z];
  }

  _seg(cam, a, b) {
    const za = dot(sub(a, cam.eye), cam.f), zb = dot(sub(b, cam.eye), cam.f);
    if (za <= NEAR && zb <= NEAR) return null;
    let p = a, q = b;
    if (za <= NEAR) p = lerp3(a, b, (NEAR - za) / (zb - za) + 1e-4);
    if (zb <= NEAR) q = lerp3(b, a, (NEAR - zb) / (za - zb) + 1e-4);
    const pa = this._proj(cam, p), pb = this._proj(cam, q);
    return pa && pb ? [pa, pb] : null;
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    const dt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    if (!this._inView || !this.cloud || document.hidden) return;
    this.t += dt;

    let eye, target;
    if (this.fly) {
      const raw = Math.min(1, (this.t - this.fly.start) / this.fly.dur);
      const u = 1 - Math.pow(1 - raw, 3);
      eye = lerp3(this.fly.e0, this.fly.e1, u);
      target = lerp3(this.fly.t0, this.fly.t1, u);
      if (raw >= 1) {
        this._setView(this.fly.e1, this.fly.t1);
        this.fly = null;
      }
    } else {
      if (this.state.autoOrbit && !this.dragging) this.sph.az += dt * 0.06;
      eye = this._eye();
      target = this.target;
    }
    this._render(eye, target);
  }

  _render(eye, target) {
    const B = this._resize();
    const { pw, ph, cssW, cssH, dpr, img, px, z } = B;
    const ctx = this.ctx;
    const cam = this._camera(eye, target, cssW, cssH);
    const { pos, col32, count, meta } = this.cloud;

    px.fill(0);
    z.fill(1e9);
    const fx = cam.f[0], fy = cam.f[1], fz = cam.f[2];
    const rx = cam.r[0], ry = cam.r[1], rz = cam.r[2];
    const ux = cam.u[0], uy = cam.u[1], uz = cam.u[2];
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const flP = cam.fl * dpr, cxP = cam.cx * dpr, cyP = cam.cy * dpr;
    const rad = Math.max(1, Math.round(this.state.pointSize * 0.4 * dpr));
    const rr = rad * rad + rad;
    for (let i = 0; i < count; i++) {
      const c = col32[i];
      if (!c) continue;
      const i3 = i * 3;
      const dx = pos[i3] - ex, dy = pos[i3 + 1] - ey, dz = pos[i3 + 2] - ez;
      const zz = dx * fx + dy * fy + dz * fz;
      if (zz <= NEAR) continue;
      const k = flP / zz;
      const sx = (cxP + (dx * rx + dy * ry + dz * rz) * k) | 0;
      const sy = (cyP - (dx * ux + dy * uy + dz * uz) * k) | 0;
      if (sx < rad || sx >= pw - rad || sy < rad || sy >= ph - rad) continue;
      for (let oy = -rad; oy <= rad; oy++) {
        const row = (sy + oy) * pw + sx;
        for (let ox = -rad; ox <= rad; ox++) {
          if (ox * ox + oy * oy > rr) continue;
          const idx = row + ox;
          if (zz < z[idx]) {
            z[idx] = zz;
            px[idx] = c;
          }
        }
      }
    }
    this.layerCtx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // floor grid
    const gs = Math.max(meta.orbit_r * 1.45, 2.5) / 2;
    const yf = meta.y_floor;
    ctx.lineWidth = 1;
    for (let k = -7; k <= 7; k++) {
      const o = (k / 7) * gs;
      ctx.strokeStyle = k === 0 ? "rgba(203,213,225,0.9)" : "rgba(226,232,240,0.9)";
      ctx.beginPath();
      for (const [a, b] of [[[-gs, yf, o], [gs, yf, o]], [[o, yf, -gs], [o, yf, gs]]]) {
        const s = this._seg(cam, a, b);
        if (s) { ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); }
      }
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const line = (a, b, color, width, alpha = 1) => {
      const s = this._seg(cam, a, b);
      if (!s) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      ctx.lineTo(s[1][0], s[1][1]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const dotAt = (p, fill, r, ring = "#ffffff") => {
      const q = this._proj(cam, p);
      if (!q) return null;
      ctx.beginPath();
      ctx.arc(q[0], q[1], r + 1.6, 0, Math.PI * 2);
      ctx.fillStyle = ring;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      return q;
    };

    if (this.state.cameras) {
      for (const [spec, color] of [[meta.exo_cam, "#0284c7"], [meta.ego_cam, "#d97706"]]) {
        const o = spec.origin, cs = spec.corners;
        const pc = cs.map((c) => this._proj(cam, c));
        if (pc.every(Boolean)) {
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(pc[0][0], pc[0][1]);
          for (let i = 1; i < 4; i++) ctx.lineTo(pc[i][0], pc[i][1]);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        for (let i = 0; i < 4; i++) {
          line(o, cs[i], color, 1.6);
          line(cs[i], cs[(i + 1) % 4], color, 1.6);
        }
        const mid = lerp3(cs[0], cs[1], 0.5);
        line(mid, spec.tip, color, 1.6);
        dotAt(o, color, 3.4);
      }
    }

    if (this.state.ray) {
      const s = meta.ray.start, e = meta.ray.end;
      line(s, e, "#f59e0b", 7, 0.16);
      line(s, e, "#d97706", 2.2);
      const u1 = (this.t * 0.32) % 1, u2 = (u1 + 0.5) % 1;
      dotAt(lerp3(s, e, u1), "#f59e0b", 3.2);
      dotAt(lerp3(s, e, u2), "#10b981", 2.6);
    }

    const showW = this.state.ray || this.state.redDots;
    for (const c of meta.candidates) {
      if (!c.pos) continue;
      if (c.is_wearer) {
        if (!showW) continue;
        const q = dotAt(c.pos, "#059669", 4.6);
        if (q) {
          const ph2 = (this.t * 0.6) % 1;
          ctx.globalAlpha = 0.85 * (1 - ph2);
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(q[0], q[1], 9 + ph2 * 13, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (this.state.redDots) {
        dotAt(c.pos, "#dc2626", 3.6);
      }
    }

    if (this.highlightedId !== null) {
      const c = meta.candidates.find((x) => x.id === this.highlightedId && x.pos);
      if (c) {
        const col = c.is_wearer ? "#059669" : "#f43f5e";
        ctx.setLineDash([5, 4]);
        line(meta.exo_cam.origin, c.pos, col, 1.4, 0.9);
        ctx.setLineDash([]);
        const q = this._proj(cam, c.pos);
        if (q) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(q[0], q[1], 13, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    for (const p of this.pins) {
      let show = true;
      if (p.groupKey === "cameras" && !this.state.cameras) show = false;
      if (p.groupKey === "ray" && !showW) show = false;
      if (p.groupKey === "redDots" && !this.state.redDots) show = false;
      const q = show ? this._proj(cam, p.pos) : null;
      if (!q || q[0] < -40 || q[0] > cssW + 40 || q[1] < 40 || q[1] > cssH - 56) {
        p.el.style.display = "none";
        continue;
      }
      p.el.style.display = "";
      p.el.style.left = `${q[0].toFixed(1)}px`;
      p.el.style.top = `${q[1].toFixed(1)}px`;
    }
  }
}
