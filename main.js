const DEFAULT_SCENES = [
  { tag: "egohumans", title: "Real Humans · Outdoor Tagging", short: "Real Humans", badge: "Real · L2", isReal: true },
  { tag: "wild_animals", title: "Wild Animals · Lions", short: "Wild Lions", badge: "Unseen Wearer · L3", isReal: false },
  { tag: "indoor_humans", title: "Indoor Multi-Person", short: "Indoor Humans", badge: "Simulated · L1", isReal: false },
  { tag: "robot_vacuum", title: "Robot Vacuums", short: "Robot Vacuums", badge: "Unseen Wearer · L3", isReal: false },
  { tag: "outdoor_humans", title: "Outdoor Forest", short: "Outdoor Forest", badge: "Simulated · L1", isReal: false },
  { tag: "underwater", title: "Underwater Sea Turtles", short: "Sea Turtles", badge: "Unseen Wearer · L3", isReal: false },
];

// Short names for the scene strip and the 3D HUD.
const SCENE_INFO = {
  egohumans: { label: "Humans", name: "EgoHumans", lvl: "L2" },
  v2xreal: { label: "Vehicles", name: "V2X-Real", lvl: "L3" },
  droid: { label: "Robot arm", name: "DROID", lvl: "L3" },
  egohumans_fencing: { label: "Fencing", name: "EgoHumans · fencing", lvl: "L2" },
  aloha: { label: "Dual arms", name: "ALOHA", lvl: "L3" },
  wild_animals: { label: "Lions", name: "Lions", lvl: "L3" },
  indoor_humans: { label: "Indoor", name: "Indoor room", lvl: "L1" },
  robot_vacuum: { label: "Vacuums", name: "Robot vacuums", lvl: "L3" },
  outdoor_humans: { label: "Forest", name: "Forest", lvl: "L1" },
  underwater: { label: "Sea turtles", name: "Sea turtles", lvl: "L3" },
};

let SCENES = [...DEFAULT_SCENES];

const $ = (id) => document.getElementById(id);
const clamp = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => {
  const c = clamp(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
const sceneInfo = (sc) => SCENE_INFO[sc.tag] || { label: sc.short, name: sc.title, lvl: "" };

/* ============================================================
   LIGHTBOX
============================================================ */
const lightbox = {
  el: $("lightbox"),
  img: $("lightboxImg"),
  title: $("lightboxTitle"),
  sub: $("lightboxSub"),
  open(src, title, sub = "") {
    if (!this.el) return;
    this.img.src = src;
    this.title.textContent = title || "";
    this.sub.textContent = sub || "";
    this.el.classList.add("open");
    document.body.style.overflow = "hidden";
  },
  close() {
    if (!this.el) return;
    this.el.classList.remove("open");
    document.body.style.overflow = "";
  },
};

function initLightbox() {
  const closeBtn = $("lightboxClose");
  if (closeBtn) closeBtn.addEventListener("click", () => lightbox.close());
  if (lightbox.el) {
    lightbox.el.addEventListener("click", (e) => {
      if (e.target === lightbox.el) lightbox.close();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") lightbox.close();
  });
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-lightbox]");
    if (!target) return;
    lightbox.open(
      target.getAttribute("data-lightbox"),
      target.getAttribute("data-lb-title") || "",
      target.getAttribute("data-lb-sub") || ""
    );
  });
}

/* ============================================================
   3D DEMO
============================================================ */
function buildSceneStrip(container, onSelect) {
  container.innerHTML = "";
  return SCENES.map((sc, idx) => {
    const info = sceneInfo(sc);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scene-btn";
    btn.setAttribute("aria-label", `Show ${sc.title}`);
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `
      <span class="scene-thumb"><img src="./assets/cards/${sc.tag}_exo_raw.jpg" alt="" loading="lazy">${sc.isReal ? '<i class="real-tag">REAL</i>' : ""}</span>
      <span class="scene-name">${info.label}</span>
    `;
    btn.addEventListener("click", () => onSelect(idx));
    container.appendChild(btn);
    return btn;
  });
}

async function initDemo() {
  const host = $("i3dCanvasHost");
  const labels = $("i3dLabelsLayer");
  const status = $("i3dStatus");
  const stageWrap = $("i3dStageWrap");
  const strip = $("i3dThumbs");
  const exoImg = $("i3dExoImg");
  const egoImg = $("i3dEgoImg");
  const readoutList = $("i3dReadoutList");
  const sceneTitle = $("i3dSceneTitle");
  const overlayBtn = $("btn2DOverlay");
  if (!host || !strip) return;

  const rows = new Map();
  let viewer = null;
  try {
    const { EgoRay3DViewer } = await import("./viewer3d.js");
    viewer = new EgoRay3DViewer(host, labels, status, (candId) => {
      rows.forEach((el, id) => el.classList.toggle("active-hi", candId !== null && id === candId));
    });
  } catch (_) {
    viewer = null;
  }

  let activeIdx = 0;
  let show2DAnn = true;

  function update2DImages() {
    const sc = SCENES[activeIdx];
    const suf = show2DAnn ? "ann" : "raw";
    exoImg.src = `./assets/cards/${sc.tag}_exo_${suf}.jpg`;
    egoImg.src = `./assets/cards/${sc.tag}_ego_${suf}.jpg`;
  }

  function renderReadout(meta) {
    readoutList.innerHTML = "";
    rows.clear();
    const cands = (meta.candidates || []).slice(0, 4);
    const maxScore = Math.max(1.0, ...cands.map((c) => (Number.isFinite(c.score) ? c.score : 0)));
    for (const c of cands) {
      const pct = Math.max(4, Math.min(100, (c.score / maxScore) * 100));
      const row = document.createElement("div");
      row.className = `i3d-row ${c.is_wearer ? "wearer" : "other"}`;
      row.innerHTML = `
        <span class="cid">#${c.id}</span>
        <div class="i3d-bar-track"><div class="i3d-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="val">${c.angle.toFixed(1)}° · ${c.score.toFixed(2)}</span>
      `;
      if (viewer) {
        row.addEventListener("mouseenter", () => {
          row.classList.add("active-hi");
          viewer.highlightCandidate(c.id);
        });
        row.addEventListener("mouseleave", () => {
          row.classList.remove("active-hi");
          viewer.highlightCandidate(null);
        });
      }
      readoutList.appendChild(row);
      rows.set(c.id, row);
    }
  }

  const buttons = buildSceneStrip(strip, (idx) => select(idx));

  async function select(idx) {
    activeIdx = (idx + SCENES.length) % SCENES.length;
    const sc = SCENES[activeIdx];
    const info = sceneInfo(sc);
    if (sceneTitle) {
      sceneTitle.innerHTML = `${info.name}<span>${sc.isReal ? "Real" : "Sim"}${info.lvl ? " · " + info.lvl : ""}</span>`;
    }
    update2DImages();
    buttons.forEach((b, i) => {
      const on = i === activeIdx;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    document.querySelectorAll(".i3d-preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === "default"));
    if (viewer) {
      const meta = await viewer.loadScene(sc.tag);
      if (meta) renderReadout(meta);
    } else {
      host.innerHTML = `<img class="s3-fallback" src="./assets/cards/${sc.tag}_poster.jpg" alt="">`;
      status.classList.add("hidden");
      try {
        const meta = await (await fetch(`./assets/scenes/${sc.tag}.json`)).json();
        renderReadout(meta);
      } catch (_) {}
    }
  }

  if (overlayBtn) {
    overlayBtn.addEventListener("click", () => {
      show2DAnn = !show2DAnn;
      overlayBtn.classList.toggle("on", show2DAnn);
      overlayBtn.setAttribute("aria-pressed", String(show2DAnn));
      update2DImages();
    });
  }

  document.querySelectorAll(".i3d-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!viewer) return;
      document.querySelectorAll(".i3d-preset-btn").forEach((b) => b.classList.toggle("active", b === btn));
      viewer.flyToPreset(btn.dataset.preset);
    });
  });

  for (const def of [
    { id: "togRay", key: "ray" },
    { id: "togCams", key: "cameras" },
    { id: "togOrbit", key: "autoOrbit" },
  ]) {
    const el = $(def.id);
    if (!el) continue;
    el.addEventListener("click", () => {
      if (!viewer) return;
      const next = !viewer.state[def.key];
      viewer.setOption(def.key, next);
      el.classList.toggle("on", next);
      el.setAttribute("aria-pressed", String(next));
    });
  }

  const resetBtn = $("btnResetView");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!viewer) return;
      document.querySelectorAll(".i3d-preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === "default"));
      viewer.resetCamera();
    });
  }

  const fsBtn = $("btnFullscreen");
  if (fsBtn && stageWrap) {
    fsBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        stageWrap.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  }

  select(0);
}

/* ============================================================
   METHOD WALKTHROUGH (A)-(E)
============================================================ */
const THEATER_ACTS = [
  { dur: 8.5, caption: "VGGT-Ω turns the image pair into both camera poses and an exo depth map." },
  { dur: 10.0, caption: "Training-free readout: cast the epipole ray into 3D and score each candidate by angle and distance." },
  { dur: 7.0, caption: "The lowest score answers all three tracks." },
  { dur: 8.5, caption: "LoRA adapters learn from pose labels and transfer zero-shot to unseen wearers." },
  { dur: 8.0, caption: "At test time, unlabeled queries pull the epipole onto a candidate; a frozen copy anchors the pose." },
];

function loadMathImage(name) {
  const img = new Image();
  img.src = `./assets/math/${name}.svg`;
  return img;
}

function createActBPointCloud(canvas) {
  let state = { loaded: false };
  const mathImgs = {
    e: loadMathImage("e_exo"),
    phi: loadMathImage("phi_u"),
    d: loadMathImage("d_u"),
    c: loadMathImage("c_hat"),
  };
  (async () => {
    try {
      const [mRes, bRes] = await Promise.all([
        fetch("./assets/scenes/egohumans.json"),
        fetch("./assets/scenes/egohumans.bin"),
      ]);
      if (!mRes.ok || !bRes.ok) return;
      const meta = await mRes.json();
      const buf = await bRes.arrayBuffer();
      const n = meta.n_points;
      const qpos = new Int16Array(buf, meta.offsets.pos, n * 3);
      const rgbAll = new Uint8Array(buf, meta.offsets.rgb, n * 3);
      const candAll = new Int16Array(buf, meta.offsets.cand, n);
      const mn = meta.pos_quant.min;
      const sc = meta.pos_quant.scale;

      const idxs = [];
      for (let i = 0; i < n; i++) {
        const y = mn[1] + (qpos[i * 3 + 1] + 32768) * sc[1];
        const z = mn[2] + (qpos[i * 3 + 2] + 32768) * sc[2];
        if (y > 1.45 || z < -2.3 || z > 2.6) continue;
        if (candAll[i] >= 0 || i % 4 === 0) idxs.push(i);
      }
      const m = idxs.length;
      const pts = new Float32Array(m * 3);
      const col32 = new Uint32Array(m);
      const cand = new Int16Array(m);
      const wId = meta.wearer;
      for (let k = 0; k < m; k++) {
        const i = idxs[k];
        const i3 = i * 3, k3 = k * 3;
        pts[k3] = mn[0] + (qpos[i3] + 32768) * sc[0];
        pts[k3 + 1] = mn[1] + (qpos[i3 + 1] + 32768) * sc[1];
        pts[k3 + 2] = mn[2] + (qpos[i3 + 2] + 32768) * sc[2];
        let r = rgbAll[i3], g = rgbAll[i3 + 1], b = rgbAll[i3 + 2];
        const cid = candAll[i];
        cand[k] = cid;
        if (cid === wId) {
          r = r * 0.3 + 16 * 0.7; g = g * 0.3 + 185 * 0.7; b = b * 0.3 + 129 * 0.7;
        } else if (cid >= 0) {
          r = r * 0.42 + 225 * 0.58; g = g * 0.42 + 45 * 0.58; b = b * 0.42 + 45 * 0.58;
        } else {
          r = r * 0.7 + 246 * 0.3; g = g * 0.7 + 248 * 0.3; b = b * 0.7 + 251 * 0.3;
        }
        const ri = Math.min(255, r | 0), gi = Math.min(255, g | 0), bi = Math.min(255, b | 0);
        col32[k] = (255 << 24) | (bi << 16) | (gi << 8) | ri;
      }
      state = { loaded: true, pts, col32, cand, meta, count: m, imgBuf: null, buf32: null, zBuf: null, bg32: null, lastW: 0, lastH: 0 };
    } catch (_) {}
  })();

  const ctx = canvas ? canvas.getContext("2d") : null;

  function render(p, globalTime) {
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(300, canvas.clientWidth || 720);
    const cssH = Math.max(220, canvas.clientHeight || 430);
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }

    if (!state.loaded) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#f6f8fb";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#94a3b8";
      ctx.font = '500 13px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("Loading point cloud…", cssW * 0.5, cssH * 0.5);
      return;
    }

    if (state.lastW !== pw || state.lastH !== ph) {
      state.imgBuf = ctx.createImageData(pw, ph);
      state.buf32 = new Uint32Array(state.imgBuf.data.buffer);
      state.zBuf = new Float32Array(pw * ph);
      state.bg32 = new Uint32Array(pw * ph);
      for (let y = 0; y < ph; y++) {
        const dy = (y - ph * 0.42) / (ph * 0.7);
        for (let x = 0; x < pw; x++) {
          const dx = (x - pw * 0.5) / (pw * 0.7);
          const t = Math.min(1, Math.hypot(dx, dy));
          const r = (255 * (1 - t) + 240 * t) | 0;
          const g = (255 * (1 - t) + 244 * t) | 0;
          const b = (255 * (1 - t) + 249 * t) | 0;
          state.bg32[y * pw + x] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
      state.lastW = pw;
      state.lastH = ph;
    }

    const { pts, col32, cand, meta, count, imgBuf, buf32, zBuf, bg32 } = state;
    buf32.set(bg32);
    zBuf.fill(1e9);

    const az = 0.24 + 0.34 * Math.sin(globalTime * 0.38);
    const el = 0.46 + 0.06 * Math.sin(globalTime * 0.29 + 0.7);
    const R = 4.55;
    const tx = 0.32, ty = -0.06, tz = 0.32;
    const ex = tx + R * Math.cos(el) * Math.sin(az);
    const ey = ty + R * Math.sin(el);
    const ez = tz + R * Math.cos(el) * Math.cos(az);

    let fx = tx - ex, fy = ty - ey, fz = tz - ez;
    const fLen = Math.hypot(fx, fy, fz);
    fx /= fLen; fy /= fLen; fz /= fLen;
    let rx = -fz, ry = 0, rz = fx;
    const rLen = Math.hypot(rx, rz);
    rx /= rLen; rz /= rLen;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const flP = (ph * 0.5) / Math.tan((42 * Math.PI) / 360);
    const cxP = pw * 0.5, cyP = ph * 0.52;
    const splatBase = dpr >= 1.5 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const dx = pts[i3] - ex, dy = pts[i3 + 1] - ey, dz = pts[i3 + 2] - ez;
      const z = dx * fx + dy * fy + dz * fz;
      if (z <= 0.2) continue;
      const invZ = flP / z;
      const px = (cxP + (dx * rx + dy * ry + dz * rz) * invZ) | 0;
      const py = (cyP - (dx * ux + dy * uy + dz * uz) * invZ) | 0;
      const rad = cand[i] >= 0 ? splatBase + 1 : splatBase;
      if (px < rad || px >= pw - rad || py < rad || py >= ph - rad) continue;
      const c = col32[i];
      for (let oy = -rad; oy <= rad; oy++) {
        const row = (py + oy) * pw;
        for (let ox = -rad; ox <= rad; ox++) {
          if (ox * ox + oy * oy > rad * rad + 1) continue;
          const idx = row + px + ox;
          if (z < zBuf[idx]) {
            zBuf[idx] = z;
            buf32[idx] = c;
          }
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(imgBuf, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const fl = (cssH * 0.5) / Math.tan((42 * Math.PI) / 360);
    const cx0 = cssW * 0.5, cy0 = cssH * 0.52;
    const proj = (pt) => {
      const dx = pt[0] - ex, dy = pt[1] - ey, dz = pt[2] - ez;
      const z = dx * fx + dy * fy + dz * fz;
      if (z <= 0.1) return null;
      return [cx0 + ((dx * rx + dy * ry + dz * rz) / z) * fl, cy0 - ((dx * ux + dy * uy + dz * uz) / z) * fl, z];
    };

    const yf = meta.y_floor;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -4; k <= 4; k++) {
      const o = k * 0.52;
      const a1 = proj([-2.08, yf, o]), b1 = proj([2.08, yf, o]);
      if (a1 && b1) { ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); }
      const a2 = proj([o, yf, -2.08]), b2 = proj([o, yf, 2.08]);
      if (a2 && b2) { ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); }
    }
    ctx.stroke();

    const drawFrustum = (cam, col, alpha) => {
      if (alpha <= 0.01) return null;
      const po = proj(cam.origin);
      const pcs = cam.corners.map(proj);
      const ptip = proj(cam.tip);
      if (!po || pcs.some((c) => !c)) return null;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (const pc of pcs) { ctx.moveTo(po[0], po[1]); ctx.lineTo(pc[0], pc[1]); }
      ctx.moveTo(pcs[0][0], pcs[0][1]);
      for (let i = 1; i <= 4; i++) ctx.lineTo(pcs[i % 4][0], pcs[i % 4][1]);
      if (ptip) {
        ctx.moveTo((pcs[0][0] + pcs[1][0]) * 0.5, (pcs[0][1] + pcs[1][1]) * 0.5);
        ctx.lineTo(ptip[0], ptip[1]);
      }
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(po[0], po[1], 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return po;
    };

    const tag = (x, y, text, color, dx = 10, dy = -10) => {
      ctx.save();
      ctx.font = '600 13px "Inter Variable", Inter, sans-serif';
      const tw = ctx.measureText(text).width;
      const w = tw + 16, h = 24;
      const bx = Math.max(6, Math.min(cssW - w - 6, x + dx));
      const by = Math.max(40, Math.min(cssH - h - 6, y + dy - h * 0.5));
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 7, by + h * 0.5 + 0.5);
      ctx.restore();
    };

    const mathTag = (x, y, img, color, hPx, dx = 10, dy = -10, alpha = 1) => {
      if (!img.complete || !img.naturalWidth) return;
      const iw = (img.naturalWidth / img.naturalHeight) * hPx;
      const w = iw + 12, h = hPx + 8;
      const bx = Math.max(6, Math.min(cssW - w - 6, x + dx));
      const by = Math.max(40, Math.min(cssH - h - 6, y + dy - h * 0.5));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.drawImage(img, bx + 6, by + 4, iw, hPx);
      ctx.restore();
    };

    const pExo = drawFrustum(meta.exo_cam, "#0284c7", easeOut(p / 0.1));
    const pEgo = drawFrustum(meta.ego_cam, "#d97706", easeOut((p - 0.04) / 0.12));

    const rayProg = easeOut((p - 0.1) / 0.22);
    const rs = meta.ray.start, re = meta.ray.end;
    if (rayProg > 0.01) {
      const curE = [rs[0] + (re[0] - rs[0]) * rayProg, rs[1] + (re[1] - rs[1]) * rayProg, rs[2] + (re[2] - rs[2]) * rayProg];
      const ps = proj(rs), pe = proj(curE);
      if (ps && pe) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(16, 185, 129, 0.18)";
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(ps[0], ps[1]); ctx.lineTo(pe[0], pe[1]); ctx.stroke();
        ctx.strokeStyle = "#059669";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ps[0], ps[1]); ctx.lineTo(pe[0], pe[1]); ctx.stroke();
        const up = ((globalTime * 0.55) % 1.0) * rayProg;
        const pp = proj([rs[0] + (re[0] - rs[0]) * up, rs[1] + (re[1] - rs[1]) * up, rs[2] + (re[2] - rs[2]) * up]);
        if (pp) {
          ctx.fillStyle = "#fbbf24";
          ctx.beginPath(); ctx.arc(pp[0], pp[1], 4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
        if (rayProg > 0.6) {
          mathTag((ps[0] + pe[0]) * 0.5, (ps[1] + pe[1]) * 0.5, mathImgs.e, "#059669", 18, -62, 6, clamp((rayProg - 0.6) / 0.3));
        }
      }
    }

    const measProg = easeOut((p - 0.26) / 0.22);
    const cands = meta.candidates || [];
    if (measProg > 0.01 && pExo) {
      ctx.save();
      ctx.globalAlpha = measProg;
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(100, 116, 139, 0.6)";
      ctx.lineWidth = 1.2;
      for (const c of cands) {
        if (c.is_wearer || !c.pos) continue;
        const pc = proj(c.pos);
        if (pc) { ctx.beginPath(); ctx.moveTo(pExo[0], pExo[1]); ctx.lineTo(pc[0], pc[1]); ctx.stroke(); }
      }
      ctx.setLineDash([]);
      const c1 = cands.find((c) => c.id === 1 && c.pos);
      if (c1 && pEgo) {
        const pc1 = proj(c1.pos);
        if (pc1) {
          const a0 = Math.atan2(pEgo[1] - pExo[1], pEgo[0] - pExo[0]);
          const a1 = Math.atan2(pc1[1] - pExo[1], pc1[0] - pExo[0]);
          let da = a1 - a0;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const R_arc = 74;
          ctx.strokeStyle = "#be185d";
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(pExo[0], pExo[1], R_arc, a0, a0 + da * measProg, da < 0);
          ctx.stroke();
          if (measProg > 0.7) {
            const am = a0 + da * 0.5;
            mathTag(pExo[0] + (R_arc + 16) * Math.cos(am), pExo[1] + (R_arc + 16) * Math.sin(am), mathImgs.phi, "#be185d", 15.5, -14, -2);
          }
        }
      }
      const c3 = cands.find((c) => c.id === 3 && c.pos);
      if (c3 && pEgo) {
        const pc3 = proj(c3.pos);
        if (pc3) {
          ctx.strokeStyle = "#0d9488";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pEgo[0], pEgo[1]);
          ctx.lineTo(pEgo[0] + (pc3[0] - pEgo[0]) * measProg, pEgo[1] + (pc3[1] - pEgo[1]) * measProg);
          ctx.stroke();
          if (measProg > 0.7) {
            mathTag((pEgo[0] + pc3[0]) * 0.5, (pEgo[1] + pc3[1]) * 0.5, mathImgs.d, "#0d9488", 18, -8, -24);
          }
        }
      }
      ctx.restore();
    }

    const lockProg = easeOut((p - 0.44) / 0.16);
    for (const c of cands) {
      if (!c.pos) continue;
      const pc = proj(c.pos);
      if (!pc) continue;
      if (c.is_wearer) {
        if (lockProg > 0.01) {
          const pulseR = 14 + 5 * Math.sin(globalTime * 3.6);
          ctx.save();
          ctx.globalAlpha = lockProg;
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(pc[0], pc[1], pulseR, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = "#059669";
        ctx.beginPath(); ctx.arc(pc[0], pc[1], 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
        if (lockProg > 0.3) tag(pc[0], pc[1], "wearer #4", "#047857", -100, -6);
      } else if (measProg > 0.1) {
        ctx.save();
        ctx.globalAlpha = measProg;
        ctx.fillStyle = "#dc2626";
        ctx.beginPath(); ctx.arc(pc[0], pc[1], 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        tag(pc[0], pc[1], `#${c.id}`, "#dc2626", 9, -8);
        ctx.restore();
      }
    }
    if (pExo) tag(pExo[0], pExo[1], "exo", "#0284c7", 12, 12);
    if (pEgo && p > 0.14) mathTag(pEgo[0], pEgo[1], mathImgs.c, "#b45309", 18, -12, -28);
  }

  return { render };
}

function pointOnPath(path, u) {
  if (!path || !path.getTotalLength) return null;
  const L = path.getTotalLength();
  return path.getPointAtLength(clamp(u) * L);
}

function initMethodExplorer() {
  const shell = $("methodTheater");
  const acts = Array.from(document.querySelectorAll("#theaterStage .theater-act"));
  const steps = Array.from(document.querySelectorAll("#theaterStepper .th-step"));
  const fills = steps.map((s) => s.querySelector(".th-fill"));
  const capEl = $("theaterCaption");
  const playBtn = $("thPlayPause");
  const playIcon = $("thPlayIcon");
  if (!shell || !acts.length) return;

  const actB = createActBPointCloud($("actBPointCanvas"));
  const actBPhase = $("actBPhaseLbl");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // (A)
  const aIn = $("aIn");
  const aTokens = $("aTokens");
  const aCols = [0, 1, 2, 3].map((i) => $(`aCol${i}`));
  const aLora = $("aLora");
  const aDots = [0, 1, 2, 3].map((i) => $(`aDot${i}`));
  const aWires = Array.from(document.querySelectorAll('#theaterStage [data-act="0"] path.wire'));
  const aFrExo = $("aFrExo");
  const aFrEgo = $("aFrEgo");
  const aArc = $("aArc");
  const aLabels = [$("aRt"), $("aFexo"), $("aFego")];
  const aDepthReveal = $("aDepthReveal");
  const aDepthScan = $("aDepthScan");

  // (B)
  const bBars = Array.from(document.querySelectorAll("#actBScoreTable .actb-bar i"));
  const bWin = $("actBWinRow");

  // (C)
  const cCards = [0, 1, 2].map((i) => $(`actCCard${i}`));

  // (D)
  const dPred = $("dPred");
  const dPredRay = $("dPredRay");
  const dPredLbl = $("dPredLbl");
  const dErr = $("dErr");
  const dLosses = [0, 1, 2].map((i) => $(`dLoss${i}`));
  const dGradPath = $("dGradPath");
  const dGradDot = $("dGradDot");
  const dLora = $("dLora");
  const dWearers = Array.from(document.querySelectorAll("#dTransfer .d-wearer"));

  // (E)
  const eTrail = $("eTrail");
  const eMarker = $("eMarker");
  const eCards = [$("eCard0"), $("eCard1")];
  const eGain = $("eGain");
  const eWearer = $("eWearer");

  let activeAct = 0;
  let elapsed = 0;
  let globalT = 0;
  let playing = !reduced;
  let inView = true;

  const op = (el, v) => { if (el) el.style.opacity = v.toFixed(3); };
  const moveDot = (dot, path, u, vis) => {
    if (!dot) return;
    const pt = pointOnPath(path, u);
    if (pt) { dot.setAttribute("cx", pt.x.toFixed(1)); dot.setAttribute("cy", pt.y.toFixed(1)); }
    dot.style.opacity = vis.toFixed(3);
  };

  function setAct(idx) {
    activeAct = (idx + THEATER_ACTS.length) % THEATER_ACTS.length;
    elapsed = 0;
    shell.dataset.activeAct = String(activeAct);
    if (capEl) capEl.textContent = THEATER_ACTS[activeAct].caption;
    acts.forEach((a, i) => a.classList.toggle("active", i === activeAct));
    steps.forEach((s, i) => {
      s.classList.toggle("active", i === activeAct);
      s.classList.toggle("done", i < activeAct);
      if (fills[i]) fills[i].style.width = i < activeAct ? "100%" : "0%";
    });
    renderAct(reduced ? 1 : 0);
  }

  function animateA(p) {
    op(aIn, 0.25 + 0.75 * easeOut(p / 0.1));
    const inU = (p - 0.06) / 0.2;
    moveDot(aDots[0], aWires[0], easeInOut(inU), inU > 0 && inU < 1 ? Math.sin(clamp(inU) * Math.PI) : 0);
    moveDot(aDots[1], aWires[1], easeInOut(inU - 0.08), inU > 0.08 && inU < 1.08 ? Math.sin(clamp(inU - 0.08) * Math.PI) : 0);
    op(aTokens, 0.3 + 0.7 * easeOut((p - 0.14) / 0.12));
    aCols.forEach((g, i) => {
      if (!g) return;
      const center = 0.32 + i * 0.085;
      g.classList.toggle("hot", Math.abs(p - center) < 0.05);
      g.classList.toggle("seen", p > center);
    });
    if (aLora) aLora.classList.toggle("hot", (p > 0.36 && p < 0.44) || (p > 0.53 && p < 0.61));
    const outU = (p - 0.62) / 0.16;
    const outVis = outU > 0 && outU < 1 ? Math.sin(clamp(outU) * Math.PI) : 0;
    moveDot(aDots[2], aWires[4], easeInOut(outU), outVis);
    moveDot(aDots[3], aWires[5], easeInOut(outU), outVis);
    const head = easeOut((p - 0.7) / 0.12);
    op(aFrExo, 0.22 + 0.78 * head);
    op(aFrEgo, 0.22 + 0.78 * easeOut((p - 0.74) / 0.12));
    op(aArc, 0.15 + 0.85 * easeOut((p - 0.78) / 0.1));
    aLabels.forEach((l) => op(l, 0.2 + 0.8 * easeOut((p - 0.8) / 0.1)));
    const dw = 326 * easeInOut((p - 0.72) / 0.2);
    if (aDepthReveal) aDepthReveal.setAttribute("width", Math.max(0.01, dw).toFixed(1));
    if (aDepthScan) {
      aDepthScan.setAttribute("x1", (764 + dw).toFixed(1));
      aDepthScan.setAttribute("x2", (764 + dw).toFixed(1));
      aDepthScan.setAttribute("opacity", dw > 2 && dw < 324 ? "0.95" : "0");
    }
  }

  function animateB(p) {
    actB.render(p, globalT);
    if (actBPhase) {
      actBPhase.textContent =
        p < 0.24 ? "camera poses" :
        p < 0.46 ? "epipole ray" :
        p < 0.68 ? "angle & distance" :
                   "wearer found";
    }
    const barU = easeOut((p - 0.2) / 0.3);
    bBars.forEach((b) => { b.style.width = `${(Number(b.dataset.w || 20) * barU).toFixed(1)}%`; });
    if (bWin) bWin.classList.toggle("locked", p >= 0.46);
  }

  function animateC(p) {
    const starts = [0.04, 0.3, 0.56];
    cCards.forEach((c, i) => {
      if (!c) return;
      c.classList.toggle("shown", p >= starts[i]);
      c.classList.toggle("spotlight", p >= starts[i] && (i === 2 || p < starts[i + 1]));
    });
  }

  function animateD(p) {
    const conv = easeInOut((p - 0.12) / 0.6);
    const px = 668 + 48 * conv;
    const py = 96 + 64 * conv;
    if (dPred) dPred.setAttribute("transform", `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${(-24 * (1 - conv)).toFixed(1)})`);
    if (dPredRay) { dPredRay.setAttribute("x2", px.toFixed(1)); dPredRay.setAttribute("y2", py.toFixed(1)); }
    if (dPredLbl) {
      dPredLbl.setAttribute("x", (px - 118).toFixed(1));
      dPredLbl.setAttribute("y", (py - 44).toFixed(1));
      op(dPredLbl, 1 - clamp((conv - 0.7) / 0.25));
    }
    if (dErr) {
      dErr.textContent = `${(18.4 * Math.pow(1 - conv, 2) + 0.2).toFixed(1)}°`;
      dErr.classList.toggle("ok", conv > 0.85);
    }
    dLosses.forEach((el, i) => el && el.classList.toggle("on", p >= 0.16 + i * 0.12));
    const gU = (p * 3) % 1;
    moveDot(dGradDot, dGradPath, gU, p > 0.22 && p < 0.86 ? Math.sin(gU * Math.PI) : 0);
    if (dLora) dLora.classList.toggle("hot", p > 0.22 && p < 0.86 && gU > 0.8);
    dWearers.forEach((g, i) => op(g, 0.28 + 0.72 * easeOut((p - 0.62 - i * 0.05) / 0.08)));
  }

  function animateE(p) {
    const u = easeInOut((p - 0.12) / 0.56);
    const pt = pointOnPath(eTrail, u);
    if (pt && eMarker) eMarker.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
    if (eWearer) eWearer.classList.toggle("hit", u > 0.97);
    if (eCards[0]) eCards[0].classList.toggle("on", p > 0.1 && p < 0.62);
    if (eCards[1]) eCards[1].classList.toggle("on", p > 0.4 && p < 0.92);
    if (eGain) eGain.textContent = `+${(5.5 * easeOut((p - 0.56) / 0.24)).toFixed(1)}`;
  }

  function renderAct(p) {
    if (activeAct === 0) animateA(p);
    else if (activeAct === 1) animateB(p);
    else if (activeAct === 2) animateC(p);
    else if (activeAct === 3) animateD(p);
    else animateE(p);
  }

  const setPlaying = (v) => {
    playing = v;
    if (playIcon) playIcon.setAttribute("href", playing ? "#i-pause" : "#i-play");
    if (playBtn) playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  };

  steps.forEach((s, i) => s.addEventListener("click", () => setAct(i)));
  $("thPrev")?.addEventListener("click", () => setAct(activeAct - 1));
  $("thNext")?.addEventListener("click", () => setAct(activeAct + 1));
  playBtn?.addEventListener("click", () => setPlaying(!playing));

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); }, { threshold: 0.05 });
    io.observe(shell);
  }

  setPlaying(playing);
  setAct(0);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
    last = now;
    if (!inView) return;
    globalT += dt;
    const dur = THEATER_ACTS[activeAct].dur;
    if (playing) {
      elapsed += dt;
      if (elapsed >= dur) {
        setAct(activeAct + 1);
        return;
      }
    }
    const p = reduced ? 1 : clamp(elapsed / dur);
    if (fills[activeAct]) fills[activeAct].style.width = `${(clamp(elapsed / dur) * 100).toFixed(2)}%`;
    renderAct(p);
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   WHY DEPTH MATTERS (lion herd, numbers from the scene file)
============================================================ */
async function initDepthCase() {
  const list = $("labScoreList");
  const verdict = $("labVerdict");
  const img = $("caseImg");
  const cap = $("caseCap");
  const btnAngle = $("labModeAngle");
  const btnDepth = $("labModeEgoRay");
  if (!list || !btnAngle || !btnDepth) return;

  let cands = [];
  try {
    const meta = await (await fetch("./assets/scenes/wild_animals.json")).json();
    cands = (meta.candidates || []).slice().sort((a, b) => a.score - b.score).slice(0, 4);
  } catch (_) {
    return;
  }
  const wearer = cands.find((c) => c.is_wearer);
  const rival = cands.find((c) => !c.is_wearer);
  let mode = "depth";

  function render() {
    const depth = mode === "depth";
    const key = depth ? "score" : "angle";
    const maxV = Math.max(...cands.map((c) => c[key])) * 1.05;
    list.innerHTML = cands.map((c) => {
      const cls = c.is_wearer ? "wear" : c === rival ? "rival" : "";
      const v = depth ? c.score.toFixed(2) : `${c.angle.toFixed(2)}°`;
      const pct = Math.max(3, (c[key] / maxV) * 100);
      return `
        <div class="case-row ${cls}">
          <span class="case-id">#${c.id}${c.is_wearer ? " · wearer" : ""}</span>
          <span class="case-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
          <span class="case-val">${v}</span>
        </div>`;
    }).join("");
    if (img) {
      img.src = depth ? "./assets/cards/wild_animals_side.jpg" : "./assets/cards/wild_animals_exo_ann.jpg";
    }
    if (cap) {
      cap.textContent = depth
        ? `In 3D, lion #${rival.id} is far from the ego camera.`
        : `In the image, lion #${rival.id} sits on almost the same ray.`;
    }
    if (verdict) {
      const gap = depth ? (rival.score - wearer.score).toFixed(2) : `${(rival.angle - wearer.angle).toFixed(1)}°`;
      verdict.className = `case-note ${depth ? "ok" : "warn"}`;
      verdict.innerHTML = depth
        ? `Score gap to #${rival.id}: <b>${gap}</b>, a clear margin.`
        : `Angle gap to #${rival.id}: <b>${gap}</b>, easily flipped by pose error.`;
    }
    btnAngle.classList.toggle("active", !depth);
    btnDepth.classList.toggle("active", depth);
  }

  btnAngle.addEventListener("click", () => { mode = "angle"; render(); });
  btnDepth.addEventListener("click", () => { mode = "depth"; render(); });
  render();
}

/* ============================================================
   FINDEGO-1M
============================================================ */
const DATASET_ITEMS = [
  { img: "comind.jpg", name: "CoMind", sub: "Real · indoor collaboration", lvl: "L0", cat: "real" },
  { img: "egohumans.jpg", name: "EgoHumans", sub: "Real · multi-person sports", lvl: "L2", cat: "real" },
  { img: "v2xreal.jpg", name: "V2X-Real", sub: "Real · vehicles", lvl: "L3", cat: "real" },
  { img: "droid.jpg", name: "DROID", sub: "Real · robot arm · CC BY 4.0", lvl: "L3", cat: "real" },
  { img: "miluv.jpg", name: "MILUV", sub: "Real · drones · CC BY 4.0", lvl: "L3", cat: "real" },
  { img: "indoor.jpg", name: "Indoor rooms", sub: "Simulated · Blender rooms", lvl: "L1", cat: "humans" },
  { img: "city.jpg", name: "City streets", sub: "Simulated · city layouts", lvl: "L1", cat: "humans" },
  { img: "football.jpg", name: "Sports arenas", sub: "Simulated · football, hockey, rugby, volleyball", lvl: "L2", cat: "humans" },
  { img: "thermal.jpg", name: "Thermal", sub: "Simulated · thermal exo, RGB ego", lvl: "L1", cat: "humans" },
  { img: "unreal.jpg", name: "Unreal crowds", sub: "Simulated · Unreal maps", lvl: "L2", cat: "humans" },
  { img: "vacuum.jpg", name: "Robot vacuums", sub: "Simulated · floor-level rooms", lvl: "L3", cat: "beyond" },
  { img: "pets.jpg", name: "Pets", sub: "Simulated · collar cameras", lvl: "L3", cat: "beyond" },
  { img: "wild.jpg", name: "Wild animals", sub: "Simulated · savanna herds", lvl: "L3", cat: "beyond" },
  { img: "fish.jpg", name: "Fish", sub: "Simulated · underwater", lvl: "L3", cat: "beyond" },
  { img: "rov.jpg", name: "Underwater ROVs", sub: "Simulated · submersible robots", lvl: "L3", cat: "beyond" },
  { img: "birds.jpg", name: "Birds", sub: "Simulated · canopy and open sky", lvl: "L3", cat: "beyond" },
];

const LENS_ITEMS = [
  { img: "v1_pinhole.jpg", label: "Pinhole (v1)" },
  { img: "aria_fisheye.jpg", label: "Aria fisheye" },
  { img: "gopro_wide.jpg", label: "GoPro wide" },
  { img: "smart_glasses.jpg", label: "XR headset" },
  { img: "animal_collar.jpg", label: "Animal collar" },
  { img: "underwater_dome.jpg", label: "Underwater dome" },
  { img: "drone_fpv.jpg", label: "Drone FPV" },
  { img: "vacuum_floor.jpg", label: "Vacuum" },
];

function initDatasetSection() {
  const mosaic = $("datasetMosaic");
  const filterBtns = document.querySelectorAll("#datasetFilters .filter-pill");
  if (mosaic) {
    mosaic.innerHTML = DATASET_ITEMS.map((d) => `
      <figure class="dom-tile" data-cat="${d.cat}" data-lightbox="./assets/dataset/${d.img}" data-lb-title="FindEgo-1M · ${d.name}" data-lb-sub="${d.sub}">
        <img src="./assets/dataset/${d.img}" alt="${d.name}" loading="lazy">
        <figcaption><span>${d.name}</span><span class="lvl-badge lvl-${d.lvl.toLowerCase()}">${d.lvl}</span></figcaption>
      </figure>
    `).join("");

    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.dsFilter;
        filterBtns.forEach((b) => b.classList.toggle("active", b === btn));
        mosaic.querySelectorAll(".dom-tile").forEach((tile) => {
          tile.classList.toggle("hidden", f !== "all" && tile.dataset.cat !== f);
        });
      });
    });
  }

  const lensGrid = $("lensGrid");
  if (lensGrid) {
    lensGrid.innerHTML = LENS_ITEMS.map((l) => `
      <figure class="lens-item" data-lightbox="./assets/lens/${l.img}" data-lb-title="Ego lens · ${l.label}">
        <img src="./assets/lens/${l.img}" alt="${l.label}" loading="lazy">
        <figcaption>${l.label}</figcaption>
      </figure>
    `).join("");
  }
}

/* ============================================================
   QUALITATIVE RESULTS
============================================================ */
const QUAL_ITEMS = [
  { img: "real_gym.jpg", title: "EgoHumans · gym", badge: "Real", cls: "real", cat: "real" },
  { img: "real_trail.jpg", title: "EgoHumans · trail", badge: "Real", cls: "real", cat: "real" },
  { img: "v2x_rsu.jpg", title: "V2X-Real · roadside", badge: "Real", cls: "real", cat: "real" },
  { img: "v2x_v2v.jpg", title: "V2X-Real · car to car", badge: "Real", cls: "real", cat: "real" },
  { img: "droid_arm.jpg", title: "DROID · robot arm", badge: "Real", cls: "real", cat: "real" },
  { img: "thermal_rgb2ir.jpg", title: "RGB ego → thermal exo", badge: "IR", cls: "ir", cat: "extreme" },
  { img: "thermal_ir2ir.jpg", title: "Thermal → thermal", badge: "IR", cls: "ir", cat: "extreme" },
  { img: "sports_football.jpg", title: "Football", badge: "L2", cls: "", cat: "extreme" },
  { img: "sports_hockey.jpg", title: "Ice hockey", badge: "L2", cls: "", cat: "extreme" },
  { img: "indoor_humans.jpg", title: "Indoor room", badge: "L1", cls: "", cat: "humans" },
  { img: "nature_forest.jpg", title: "Forest", badge: "L1", cls: "", cat: "humans" },
  { img: "city_street.jpg", title: "City street", badge: "L1", cls: "", cat: "humans" },
  { img: "unreal_scene.jpg", title: "Unreal scene", badge: "L2", cls: "", cat: "humans" },
  { img: "robot_vacuum.jpg", title: "Robot vacuums", badge: "L3", cls: "", cat: "l3" },
  { img: "pets_home.jpg", title: "Pets", badge: "L3", cls: "", cat: "l3" },
  { img: "wild_savanna.jpg", title: "Savanna herd", badge: "L3", cls: "", cat: "l3" },
  { img: "underwater_rov.jpg", title: "Underwater ROVs", badge: "L3", cls: "", cat: "l3" },
  { img: "underwater_divers.jpg", title: "Divers", badge: "L1", cls: "", cat: "l3" },
  { img: "birds_flock.jpg", title: "Bird flock", badge: "L3", cls: "", cat: "l3" },
  { img: "drones_air.jpg", title: "Drones", badge: "L3", cls: "", cat: "l3" },
];

function initQualitative(extraManifest) {
  const qBtns = document.querySelectorAll("#qualTabBar .tab-btn");
  const qPanels = document.querySelectorAll("#qualitative .tab-panel");
  qBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.qtab;
      qBtns.forEach((b) => b.classList.toggle("active", b === btn));
      qPanels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });

  const grid = $("qualGrid");
  if (grid) {
    grid.innerHTML = QUAL_ITEMS.map((item) => `
      <figure class="qual-card" data-qcat="${item.cat}" data-lightbox="./assets/qual/${item.img}" data-lb-title="Track A · ${item.title}">
        <div class="qual-img-wrap">
          <img src="./assets/qual/${item.img}" alt="${item.title}" loading="lazy">
          <span class="qual-chip ${item.cls}">${item.badge}</span>
        </div>
        <figcaption>${item.title}</figcaption>
      </figure>
    `).join("");

    const fBtns = document.querySelectorAll("#qualFilters .filter-pill");
    fBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.qfilter;
        fBtns.forEach((b) => b.classList.toggle("active", b === btn));
        grid.querySelectorAll(".qual-card").forEach((card) => {
          card.classList.toggle("hidden", f !== "all" && card.dataset.qcat !== f);
        });
      });
    });
  }

  const tbGrid = $("trackBGrid");
  if (tbGrid) {
    const names = {
      trackb_present_fencing: "EgoHumans · fencing",
      trackb_present_droid: "DROID · robot arm",
      trackb_absent_egohumans: "EgoHumans · wearer out of view",
      trackb_absent_comind: "CoMind · wearer out of view",
    };
    const cards = (extraManifest?.track_b || []).map((item) => {
      const title = names[item.name] || item.name;
      const badge = item.pred_present
        ? `<span class="tag-pill green">present</span>`
        : `<span class="tag-pill red">absent</span>`;
      return `
        <figure class="tbc-card" data-lightbox="./assets/tracks/${item.name}.jpg" data-lb-title="Track B · ${title}">
          <img src="./assets/tracks/${item.name}.jpg" alt="${title}" loading="lazy">
          <figcaption><span>${title}</span>${badge}</figcaption>
        </figure>`;
    });
    cards.push(`
      <figure class="tbc-card" data-lightbox="./assets/tracks/dc_q_present.jpg" data-lb-title="Track B · simulated room, wearer visible">
        <div class="pa-pair-grid">
          <img src="./assets/tracks/dc_q_present.jpg" alt="Exo view, wearer visible" loading="lazy">
          <img src="./assets/tracks/dc_q_ego.jpg" alt="Ego view" loading="lazy">
        </div>
        <figcaption><span>Simulated room · exo / ego</span><span class="tag-pill green">present</span></figcaption>
      </figure>`);
    cards.push(`
      <figure class="tbc-card" data-lightbox="./assets/tracks/dc_q_absent.jpg" data-lb-title="Track B · simulated room, wearer out of view">
        <div class="pa-pair-grid">
          <img src="./assets/tracks/dc_q_absent.jpg" alt="Exo view, wearer not visible" loading="lazy">
          <img src="./assets/tracks/dc_q_absent_ego.jpg" alt="Ego view" loading="lazy">
        </div>
        <figcaption><span>Simulated room · exo / ego</span><span class="tag-pill red">absent</span></figcaption>
      </figure>`);
    tbGrid.innerHTML = cards.join("");
  }

  const tcGrid = $("trackCGrid");
  if (tcGrid) {
    const short = (t) => t.replace(" · Mutual Exo ↔ Ego Epipoles", "");
    tcGrid.innerHTML = (extraManifest?.track_c || []).map((it) => `
      <figure class="tbc-card" data-lightbox="${it.src}" data-lb-title="Track C · ${short(it.title)}" data-lb-sub="${it.sub}">
        <img src="${it.src}" alt="${short(it.title)}" loading="lazy">
        <figcaption><span>${short(it.title)}</span><span class="tag-pill amber">exo ↔ ego</span></figcaption>
      </figure>
    `).join("");
  }

  const wipeRange = $("wipeRange");
  const wipeClip = $("wipeExoClip");
  const wipeHandle = $("wipeHandle");
  const wipeRaw = $("wipeExoRaw");
  const wipeAnn = $("wipeExoAnn");
  const wipeEgo = $("wipeEgoImg");
  const wipeTitle = $("wipeTitle");
  const wipeThumbs = $("wipeThumbs");
  if (wipeRange && wipeThumbs) {
    const setPos = (pct) => {
      wipeClip.style.clipPath = `inset(0 ${(100 - pct).toFixed(1)}% 0 0)`;
      wipeHandle.style.left = `${pct}%`;
    };
    wipeRange.addEventListener("input", () => setPos(Number(wipeRange.value)));
    setPos(Number(wipeRange.value));

    const wBtns = buildSceneStrip(wipeThumbs, (idx) => selectWipe(idx));
    function selectWipe(idx) {
      const sc = SCENES[idx];
      wipeRaw.src = `./assets/cards/${sc.tag}_exo_raw.jpg`;
      wipeAnn.src = `./assets/cards/${sc.tag}_exo_ann.jpg`;
      wipeEgo.src = `./assets/cards/${sc.tag}_ego_ann.jpg`;
      if (wipeTitle) wipeTitle.textContent = sceneInfo(sc).name;
      wBtns.forEach((b, i) => {
        const on = i === idx;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    selectWipe(0);
  }
}

/* ============================================================
   UNSEEN-DOMAIN RADAR
============================================================ */
const RADAR_DOMAINS = [
  "Real (L2)", "Top", "Sports", "Unreal", "Vehicles", "Legged", "Arms",
  "Vacuums", "Pets", "Wild", "Fish", "Birds", "Drones",
];

const RADAR_MODELS = [
  { name: "EgoRay (Ours)", mean: 77.7, color: "#059669", fill: "rgba(5,150,105,0.18)", width: 2.4, primary: true,
    vals: [96.4, 99.7, 85.7, 88.6, 84.9, 90.3, 64.6, 94.1, 98.7, 55.9, 46.4, 49.5, 55.0] },
  { name: "EgoRay-ZS", mean: 58.7, color: "#d97706", fill: "rgba(217,119,6,0.08)", width: 1.7, primary: false,
    vals: [91.1, 83.9, 60.6, 70.5, 50.5, 81.2, 47.1, 88.4, 95.5, 28.3, 14.7, 25.8, 25.4] },
  { name: "Pi3X", mean: 50.1, color: "#7c3aed", fill: "rgba(124,58,237,0.05)", width: 1.4, primary: false,
    vals: [83.9, 90.9, 39.4, 58.4, 39.2, 69.7, 23.7, 88.7, 92.8, 23.0, 13.1, 21.5, 7.3] },
  { name: "MapAnything", mean: 49.6, color: "#0284c7", fill: "rgba(2,132,199,0.05)", width: 1.4, primary: false,
    vals: [79.7, 84.5, 48.9, 56.4, 51.6, 70.3, 29.9, 77.1, 89.8, 16.9, 9.1, 13.7, 17.6] },
  { name: "VGGT", mean: 35.9, color: "#64748b", fill: "rgba(100,116,139,0.04)", width: 1.2, primary: false,
    vals: [78.3, 44.5, 25.3, 42.8, 25.7, 58.7, 15.0, 69.1, 71.6, 7.9, 8.6, 10.5, 8.2] },
];

function initRadar() {
  const svg = $("radarSvg");
  const leg = $("radarLegend");
  const tip = $("radarTooltip");
  if (!svg || !leg) return;

  const visible = RADAR_MODELS.map(() => true);
  let hoverIdx = -1;

  const cx = 230, cy = 196, R = 142;
  const N = RADAR_DOMAINS.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    const r = (Math.max(0, v) / 100) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  function renderSvg() {
    let html = "";
    for (const lv of [20, 40, 60, 80, 100]) {
      const pts = RADAR_DOMAINS.map((_, i) => pt(i, lv).map((n) => n.toFixed(1)).join(",")).join(" ");
      html += `<polygon points="${pts}" fill="none" stroke="#e8edf3" stroke-width="${lv === 100 ? 1.2 : 1}"/>`;
      if (lv === 40 || lv === 80) {
        html += `<text x="${cx + 4}" y="${(cy - (lv / 100) * R + 10).toFixed(1)}" font-size="9.5" fill="#a3afbf" font-family="JetBrains Mono Variable, monospace">${lv}</text>`;
      }
    }
    for (let i = 0; i < N; i++) {
      const [x2, y2] = pt(i, 100);
      const isH = i === hoverIdx;
      html += `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${isH ? "#0284c7" : "#e8edf3"}" stroke-width="${isH ? 1.6 : 1}"/>`;
    }
    for (let m = RADAR_MODELS.length - 1; m >= 0; m--) {
      if (!visible[m]) continue;
      const mod = RADAR_MODELS[m];
      const pts = mod.vals.map((v, i) => pt(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
      html += `<polygon points="${pts}" fill="${mod.fill}" stroke="${mod.color}" stroke-width="${mod.width}" stroke-linejoin="round"/>`;
      if (m === 0) {
        for (let i = 0; i < N; i++) {
          const [px, py] = pt(i, mod.vals[i]);
          html += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${i === hoverIdx ? 4.5 : 2.6}" fill="${mod.color}" stroke="#ffffff" stroke-width="1.2"/>`;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
      const lx = cx + (R + 24) * Math.cos(a);
      const ly = cy + (R + 20) * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.18 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      const isH = i === hoverIdx;
      html += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-weight="${isH ? 700 : 600}" fill="${isH ? "#0284c7" : "#475569"}" style="cursor:pointer" data-axis="${i}">${RADAR_DOMAINS[i]}</text>`;
      const [hx, hy] = pt(i, 100);
      html += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="16" fill="transparent" style="cursor:pointer" data-axis="${i}"/>`;
    }
    svg.innerHTML = html;

    svg.querySelectorAll("[data-axis]").forEach((el) => {
      el.addEventListener("mouseenter", () => {
        hoverIdx = Number(el.getAttribute("data-axis"));
        updateTooltip();
        renderSvg();
      });
    });
  }

  function updateTooltip() {
    if (!tip) return;
    if (hoverIdx < 0) {
      tip.innerHTML = `<span class="rt-empty">Hover an axis to compare.</span>`;
      return;
    }
    const chips = RADAR_MODELS.filter((_, i) => visible[i]).map((m) => {
      const label = m.name.replace(" (Ours)", "");
      return `<span class="rt-chip${m.primary ? " primary" : ""}"><i class="rt-dot" style="background:${m.color}"></i><span class="rt-name">${label}</span><strong>${m.vals[hoverIdx].toFixed(1)}</strong></span>`;
    }).join("");
    tip.innerHTML = `<div class="rt-head"><span class="rt-dom">${RADAR_DOMAINS[hoverIdx]}</span></div><div class="rt-chips">${chips}</div>`;
  }

  leg.innerHTML = "";
  RADAR_MODELS.forEach((m, idx) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `radar-leg-row${m.primary ? " primary" : ""}`;
    row.innerHTML = `
      <span class="radar-leg-left"><span class="radar-swatch" style="background:${m.color}"></span><span>${m.name}</span></span>
      <span class="radar-val">${m.mean.toFixed(1)}</span>
    `;
    row.addEventListener("click", () => {
      visible[idx] = !visible[idx];
      row.classList.toggle("muted", !visible[idx]);
      renderSvg();
      updateTooltip();
    });
    leg.appendChild(row);
  });

  renderSvg();
  updateTooltip();
}

/* ============================================================
   TABS, SCROLL SPY, BIBTEX, REVEAL
============================================================ */
function initBenchmarkTabs() {
  const btns = document.querySelectorAll("#benchTabBar .tab-btn");
  const panels = document.querySelectorAll("#results .tab-panel");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });
}

function initScrollSpy() {
  const links = Array.from(document.querySelectorAll("#navLinks .nav-link"));
  const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if (!sections.length) return;
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const id = "#" + e.target.id;
          links.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === id));
        }
      }
    },
    { rootMargin: "-25% 0px -65% 0px" }
  );
  sections.forEach((s) => obs.observe(s));
}

function initCopyBibtex() {
  const btn = $("copyBibBtn");
  const code = $("bibtexCode");
  if (!btn || !code) return;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      btn.textContent = "Copied";
    } catch (_) {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1600);
  });
}

function initScrollEffects() {
  const nav = document.querySelector(".top-nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const showEl = (el) => {
    if (el.classList.contains("in-view")) return;
    el.classList.add("in-view");
    setTimeout(() => el.classList.add("settled"), 900);
  };

  if (reduced || !("IntersectionObserver" in window)) {
    revealEls.forEach(showEl);
  } else {
    revealEls.filter((el) => el.classList.contains("reveal-mount")).forEach((el) => {
      requestAnimationFrame(() => showEl(el));
    });
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            showEl(e.target);
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.01, rootMargin: "0px 0px -4% 0px" }
    );
    const pending = revealEls.filter((el) => !el.classList.contains("reveal-mount"));
    pending.forEach((el) => obs.observe(el));
    const sweepVisible = () => {
      const vh = window.innerHeight || 900;
      for (const el of pending) {
        if (el.classList.contains("in-view")) continue;
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.96) showEl(el);
      }
    };
    window.addEventListener("scroll", sweepVisible, { passive: true });
    requestAnimationFrame(sweepVisible);
  }

  const countEls = Array.from(document.querySelectorAll("[data-count]"));
  const animateCount = (el) => {
    const target = el.dataset.count;
    if (!target || el.dataset.counted) return;
    el.dataset.counted = "1";
    if (reduced) {
      el.textContent = target;
      return;
    }
    const ms = 1150;
    const t0 = performance.now();
    const tick = (now) => {
      const x = Math.max(0, Math.min(1, (now - t0) / ms));
      const p = 1 - Math.pow(1 - x, 4);
      el.textContent = target.replace(/\d[\d,]*(\.\d+)?/g, (n) => {
        const decimals = n.split(".")[1]?.length ?? 0;
        const v = Number(n.replace(/,/g, "")) * p;
        return n.includes(",") ? Math.round(v).toLocaleString("en-US") : v.toFixed(decimals);
      });
      if (x < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    };
    requestAnimationFrame(tick);
  };
  if (countEls.length) {
    const cObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            animateCount(e.target);
            cObs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.2 }
    );
    countEls.forEach((el) => cObs.observe(el));
  }
}

/* ============================================================
   BOOT
============================================================ */
async function boot() {
  let extraManifest = null;
  try {
    const res = await fetch("./assets/site_catalog.json");
    if (res.ok) {
      extraManifest = await res.json();
      if (Array.isArray(extraManifest.scenes) && extraManifest.scenes.length) {
        SCENES = extraManifest.scenes;
      }
    }
  } catch (_) {}

  initLightbox();
  initScrollEffects();
  initDemo();
  initMethodExplorer();
  initDepthCase();
  initDatasetSection();
  initQualitative(extraManifest);
  initRadar();
  initBenchmarkTabs();
  initScrollSpy();
  initCopyBibtex();
}

boot();
