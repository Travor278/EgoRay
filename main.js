import { EgoRay3DViewer } from "./viewer3d.js";

const DEFAULT_SCENES = [
  {
    tag: "egohumans",
    title: "Real Humans · Outdoor Tagging",
    short: "Real Humans",
    badge: "Real · L2",
    group: "humans",
    isReal: true,
    n_views: 12,
    note: "EgoHumans real multi-person tagging · 4 candidates · 0.07° epipole error",
  },
  {
    tag: "wild_animals",
    title: "Wild Animals · Lions Occlusion",
    short: "Wild Lions",
    badge: "Unseen Wearer · L3",
    group: "nature",
    isReal: false,
    n_views: 12,
    note: "FindEgo-1M collar camera on lions · 5 candidates · 3D depth resolves collinear occluder #5 · 0.06° error",
  },
  {
    tag: "indoor_humans",
    title: "Indoor Multi-Person",
    short: "Indoor Humans",
    badge: "Simulated · L1",
    group: "humans",
    isReal: false,
    n_views: 7,
    note: "FindEgo-1M indoor room · 3 candidates · 0.16° epipole error",
  },
  {
    tag: "robot_vacuum",
    title: "Robot Vacuums",
    short: "Robot Vacuums",
    badge: "Unseen Wearer · L3",
    group: "robots",
    isReal: false,
    n_views: 7,
    note: "FindEgo-1M floor-level robot vacuum · 3 candidates · 0.20° epipole error",
  },
  {
    tag: "outdoor_humans",
    title: "Outdoor Forest",
    short: "Outdoor Forest",
    badge: "Simulated · L1",
    group: "humans",
    isReal: false,
    n_views: 11,
    note: "FindEgo-1M outdoor forest · 4 candidates · 0.05° epipole error",
  },
  {
    tag: "underwater",
    title: "Underwater Sea Turtles",
    short: "Sea Turtles",
    badge: "Unseen Wearer · L3",
    group: "nature",
    isReal: false,
    n_views: 2,
    note: "FindEgo-1M underwater coral reef · 5 sea turtles · 0.07° epipole error",
  },
];

let SCENES = [...DEFAULT_SCENES];

/* ============================================================
   1. LIGHTBOX HELPER
============================================================ */
const lightbox = {
  el: document.getElementById("lightbox"),
  img: document.getElementById("lightboxImg"),
  title: document.getElementById("lightboxTitle"),
  sub: document.getElementById("lightboxSub"),
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
  const closeBtn = document.getElementById("lightboxClose");
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
   2. TEASER & INTERACTIVE 3D (DYNAMIC MULTI-SCENARIO)
============================================================ */
function buildFilterBar(container, onFilter) {
  if (!container) return;
  const defs = [
    { key: "all", label: "All Scenes", fn: () => true },
    { key: "real", label: "Real-World", fn: (s) => s.isReal },
    { key: "robots", label: "Robots, Vehicles & Air", fn: (s) => s.group === "robots" },
    { key: "humans", label: "Humans & Sports", fn: (s) => s.group === "humans" },
    { key: "nature", label: "Animals & Underwater", fn: (s) => s.group === "nature" },
  ];
  container.innerHTML = "";
  const btns = [];
  for (const d of defs) {
    const cnt = SCENES.filter(d.fn).length;
    if (cnt === 0 && d.key !== "all") continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = `filter-pill${d.key === "all" ? " active" : ""}`;
    b.innerHTML = `${d.label} <span class="cnt">${cnt}</span>`;
    b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.toggle("active", x === b));
      onFilter(d.fn);
    });
    container.appendChild(b);
    btns.push(b);
  }
}

function buildThumbDock(container, onSelect) {
  container.innerHTML = "";
  return SCENES.map((sc, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb-btn";
    btn.dataset.index = String(idx);
    btn.setAttribute("aria-label", `Show ${sc.title}`);
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `
      <img src="./assets/cards/${sc.tag}_exo_ann.jpg" alt="${sc.title}" loading="lazy">
      <span class="thumb-tag ${sc.isReal ? "real" : ""}">${sc.isReal ? "REAL" : "SIM"}</span>
      <span class="thumb-label">${sc.short}</span>
    `;
    btn.addEventListener("click", () => onSelect(idx));
    container.appendChild(btn);
    return btn;
  });
}

function initTeaser() {
  const video = document.getElementById("teaserVideo");
  const titleEl = document.getElementById("teaserTitle");
  const badgeEl = document.getElementById("teaserBadge");
  const viewsEl = document.getElementById("teaserViews");
  const dock = document.getElementById("teaserThumbs");
  const filters = document.getElementById("teaserFilters");
  if (!video || !dock) return;

  let activeIdx = 0;
  const SPEEDS = [0.55, 0.75, 1.0];
  let speedIdx = 0;
  const speedBtn = document.getElementById("teaserSpeedToggle");

  const applySpeed = () => {
    video.playbackRate = SPEEDS[speedIdx];
    if (speedBtn) speedBtn.textContent = `${SPEEDS[speedIdx]}×`;
  };
  video.addEventListener("loadedmetadata", applySpeed);
  video.addEventListener("play", applySpeed);
  if (speedBtn) {
    speedBtn.addEventListener("click", () => {
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      applySpeed();
    });
  }

  const buttons = buildThumbDock(dock, (idx) => select(idx));

  buildFilterBar(filters, (pred) => {
    let firstVisible = -1;
    buttons.forEach((b, i) => {
      const show = pred(SCENES[i]);
      b.classList.toggle("hidden", !show);
      if (show && firstVisible === -1) firstVisible = i;
    });
    if (firstVisible !== -1 && !pred(SCENES[activeIdx])) {
      select(firstVisible);
    }
  });

  function select(idx) {
    activeIdx = (idx + SCENES.length) % SCENES.length;
    const sc = SCENES[activeIdx];
    video.pause();
    video.poster = `./assets/cards/${sc.tag}_poster.jpg`;
    video.src = `./assets/videos/${sc.tag}.mp4`;
    video.load();
    applySpeed();
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    if (titleEl) titleEl.textContent = sc.note;
    if (badgeEl) badgeEl.textContent = sc.badge;
    if (viewsEl) {
      viewsEl.textContent = sc.n_views > 2 ? `${sc.n_views}-View Dense 3D` : "EgoRay 3D";
    }
    buttons.forEach((b, i) => {
      const on = i === activeIdx;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  const prevBtn = document.getElementById("teaserPrev");
  const nextBtn = document.getElementById("teaserNext");
  const playBtn = document.getElementById("teaserPlayToggle");

  if (prevBtn) prevBtn.addEventListener("click", () => select(activeIdx - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => select(activeIdx + 1));
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      if (video.paused) {
        video.play().catch(() => {});
        playBtn.textContent = "Pause";
      } else {
        video.pause();
        playBtn.textContent = "Play";
      }
    });
  }

  select(0);
}

function initInteractive3D() {
  const host = document.getElementById("i3dCanvasHost");
  const labels = document.getElementById("i3dLabelsLayer");
  const status = document.getElementById("i3dStatus");
  const stageWrap = document.getElementById("i3dStageWrap");
  const dock = document.getElementById("i3dThumbs");
  const filters = document.getElementById("i3dFilters");
  const exoImg = document.getElementById("i3dExoImg");
  const egoImg = document.getElementById("i3dEgoImg");
  const readoutList = document.getElementById("i3dReadoutList");
  const sceneTitle = document.getElementById("i3dSceneTitle");
  const overlayBtn = document.getElementById("btn2DOverlay");

  if (!host || !dock) return;

  let activeRowMap = new Map();
  const viewer = new EgoRay3DViewer(host, labels, status, (candId) => {
    activeRowMap.forEach((el, id) => {
      el.classList.toggle("active-hi", candId !== null && id === candId);
    });
  });

  let activeIdx = 0;
  let show2DAnn = true;

  function update2DImages() {
    const sc = SCENES[activeIdx];
    const suf = show2DAnn ? "ann" : "raw";
    exoImg.src = `./assets/cards/${sc.tag}_exo_${suf}.jpg`;
    egoImg.src = `./assets/cards/${sc.tag}_ego_${suf}.jpg`;
    if (overlayBtn) overlayBtn.textContent = show2DAnn ? "Masks: On" : "Masks: Off";
  }

  function renderReadout(meta) {
    readoutList.innerHTML = "";
    activeRowMap.clear();
    const cands = meta.candidates || [];
    const maxScore = Math.max(1.0, ...cands.map((c) => (Number.isFinite(c.score) ? c.score : 0)));
    for (const c of cands.slice(0, 6)) {
      const pct = Math.max(6, Math.min(100, (c.score / maxScore) * 100));
      const row = document.createElement("div");
      row.className = `i3d-row ${c.is_wearer ? "wearer" : "other"}`;
      row.innerHTML = `
        <span class="cid">#${c.id}${c.is_wearer ? "*" : ""}</span>
        <div class="i3d-bar-track"><div class="i3d-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="val">${c.angle.toFixed(1)}° · ${c.score.toFixed(2)}</span>
      `;
      row.addEventListener("mouseenter", () => {
        row.classList.add("active-hi");
        viewer.highlightCandidate(c.id);
      });
      row.addEventListener("mouseleave", () => {
        row.classList.remove("active-hi");
        viewer.highlightCandidate(null);
      });
      readoutList.appendChild(row);
      activeRowMap.set(c.id, row);
    }
  }

  const buttons = buildThumbDock(dock, (idx) => select(idx));

  buildFilterBar(filters, (pred) => {
    let firstVisible = -1;
    buttons.forEach((b, i) => {
      const show = pred(SCENES[i]);
      b.classList.toggle("hidden", !show);
      if (show && firstVisible === -1) firstVisible = i;
    });
    if (firstVisible !== -1 && !pred(SCENES[activeIdx])) {
      select(firstVisible);
    }
  });

  async function select(idx) {
    activeIdx = (idx + SCENES.length) % SCENES.length;
    const sc = SCENES[activeIdx];
    if (sceneTitle) sceneTitle.textContent = `${sc.title}  ·  ${sc.badge}`;
    update2DImages();
    buttons.forEach((b, i) => {
      const on = i === activeIdx;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const meta = await viewer.loadScene(sc.tag);
    if (meta) renderReadout(meta);
  }

  if (overlayBtn) {
    overlayBtn.addEventListener("click", () => {
      show2DAnn = !show2DAnn;
      update2DImages();
    });
  }

  document.querySelectorAll(".i3d-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => viewer.flyToPreset(btn.dataset.preset));
  });

  const toggleDefs = [
    { id: "togRedDots", key: "redDots", activeCls: "on-red" },
    { id: "togTint", key: "tint", activeCls: "on-green" },
    { id: "togRay", key: "ray", activeCls: "on" },
    { id: "togCams", key: "cameras", activeCls: "on" },
    { id: "togEgoPts", key: "includeEgo", activeCls: "on" },
    { id: "togOrbit", key: "autoOrbit", activeCls: "on" },
  ];
  for (const def of toggleDefs) {
    const el = document.getElementById(def.id);
    if (!el) continue;
    el.addEventListener("click", () => {
      const next = !viewer.state[def.key];
      viewer.setOption(def.key, next);
      el.classList.toggle(def.activeCls, next);
      el.setAttribute("aria-pressed", String(next));
    });
  }

  const darkBtn = document.getElementById("togDarkBg");
  if (darkBtn && stageWrap) {
    darkBtn.addEventListener("click", () => {
      const next = !viewer.state.darkBg;
      viewer.setOption("darkBg", next);
      stageWrap.classList.toggle("dark-canvas", next);
      darkBtn.classList.toggle("on", next);
      darkBtn.setAttribute("aria-pressed", String(next));
    });
  }

  const ptSlider = document.getElementById("sliderPtSize");
  if (ptSlider) {
    ptSlider.addEventListener("input", () => viewer.setOption("pointSize", Number(ptSlider.value)));
  }

  const resetBtn = document.getElementById("btnResetView");
  if (resetBtn) resetBtn.addEventListener("click", () => viewer.resetCamera());

  const fsBtn = document.getElementById("btnFullscreen");
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
   3. 5-ACT SLOW-PLAYING ANIMATED METHOD THEATER + LIVE 3D CLOUD (ACT B)
============================================================ */
const THEATER_ACTS = [
  {
    num: "ACT 01 / 05",
    name: "(A) VGGT-Ω · Dual-View 3D Lifting",
    dot: "#0284c7",
    dur: 7.5,
    caption: "VGGT-Ω encodes the exo and ego pair with alternating frame/global attention and rank-64 LoRA, outputting Camera Extrinsics (R̂, t̂) + Intrinsics (K̂) and Dense Exo Depth D to feed (B).",
  },
  {
    num: "ACT 02 / 05",
    name: "(B) Training-Free 3D Geometric Readout",
    dot: "#059669",
    dur: 9.5,
    caption: "Using (R̂, t̂, K̂, D) directly with zero learned heads, EgoRay lifts masks into the dynamic 3D point cloud, casts the epipole ray ê_exo, and ranks every candidate by angular offset θᵢ and 3D distance d_u / ‖ĉ‖.",
  },
  {
    num: "ACT 03 / 05",
    name: "(C) Unified Three-Track Answers",
    dot: "#10b981",
    dur: 7.5,
    caption: "The lowest-score geometric readout answers Track A (identification), Track B (open-vocab SAM 3 segmentation + absent verdict), and Track C (mutual exo ↔ ego localization) in one 0.4s pass.",
  },
  {
    num: "ACT 04 / 05",
    name: "(D) Pose-Supervised LoRA Fine-Tuning",
    dot: "#7c3aed",
    dur: 8.2,
    caption: "Keeping VGGT-Ω frozen, rank-64 LoRA adapters align predicted camera pose (R̂, t̂, f̂) to ground-truth FindEgo-1M geometry (humans only) — transferring zero-shot to unseen vehicles, robots, animals, and Thermal IR.",
  },
  {
    num: "ACT 05 / 05",
    name: "(E) Label-Free Test-Time Adaptation",
    dot: "#d97706",
    dur: 8.0,
    caption: "With zero wearer labels at test time, the candidate-bag constraint pulls stray epipoles onto the visible candidate set while a frozen-copy anchor preserves rotation, focal length, and <1° hits (+5.5 unseen κ-Acc).",
  },
];

function createActBPointCloud(canvas) {
  let state = { loaded: false, pts: null, rgb: null, cand: null, meta: null };
  // Load real EgoHumans 200k-pt scene and subsample cleanly for silky 60fps dynamic rendering
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

      // Keep 100% of candidate points + strided scene points (~34,000 dense crisp splats)
      const idxs = [];
      for (let i = 0; i < n; i++) {
        const y = mn[1] + (qpos[i * 3 + 1] + 32768) * sc[1];
        const z = mn[2] + (qpos[i * 3 + 2] + 32768) * sc[2];
        if (y > 1.45 || z < -2.3 || z > 2.6) continue;
        if (candAll[i] >= 0 || i % 5 === 0) idxs.push(i);
      }
      const m = idxs.length;
      const pts = new Float32Array(m * 3);
      const col32 = new Uint32Array(m);
      const cand = new Int16Array(m);
      const wId = meta.wearer;
      for (let k = 0; k < m; k++) {
        const i = idxs[k];
        const i3 = i * 3, k3 = k * 3;
        pts[k3]     = mn[0] + (qpos[i3] + 32768) * sc[0];
        pts[k3 + 1] = mn[1] + (qpos[i3 + 1] + 32768) * sc[1];
        pts[k3 + 2] = mn[2] + (qpos[i3 + 2] + 32768) * sc[2];
        let r = rgbAll[i3], g = rgbAll[i3 + 1], b = rgbAll[i3 + 2];
        const cid = candAll[i];
        cand[k] = cid;
        if (cid === wId) {
          r = r * 0.30 + 16 * 0.70; g = g * 0.30 + 185 * 0.70; b = b * 0.30 + 129 * 0.70;
        } else if (cid >= 0) {
          r = r * 0.42 + 225 * 0.58; g = g * 0.42 + 45 * 0.58; b = b * 0.42 + 45 * 0.58;
        } else {
          r = r * 0.68 + 245 * 0.32; g = g * 0.68 + 248 * 0.32; b = b * 0.68 + 252 * 0.32;
        }
        const ri = Math.min(255, r | 0), gi = Math.min(255, g | 0), bi = Math.min(255, b | 0);
        // Little-endian ABGR for Uint32Array ImageData
        col32[k] = (255 << 24) | (bi << 16) | (gi << 8) | ri;
      }
      state = {
        loaded: true, pts, col32, cand, meta, count: m,
        imgBuf: null, buf32: null, zBuf: null, bg32: null, lastW: 0, lastH: 0,
      };
    } catch (_) {}
  })();

  const ctx = canvas ? canvas.getContext("2d") : null;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);

  function render(p, globalTime) {
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(320, canvas.clientWidth || 720);
    const cssH = Math.max(240, canvas.clientHeight || 430);
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }

    if (!state.loaded) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#f4f7fb";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#64748b";
      ctx.font = '600 14px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("Loading live 3D EgoHumans point cloud…", cssW * 0.5, cssH * 0.5);
      return;
    }

    // Allocate reusable ImageData + Z-buffer once per resize (100x faster than fillStyle strings!)
    if (state.lastW !== pw || state.lastH !== ph) {
      state.imgBuf = ctx.createImageData(pw, ph);
      state.buf32 = new Uint32Array(state.imgBuf.data.buffer);
      state.zBuf = new Float32Array(pw * ph);
      state.bg32 = new Uint32Array(pw * ph);
      for (let y = 0; y < ph; y++) {
        const dy = (y - ph * 0.42) / (ph * 0.65);
        for (let x = 0; x < pw; x++) {
          const dx = (x - pw * 0.5) / (pw * 0.65);
          const t = Math.min(1, Math.hypot(dx, dy));
          const r = (255 * (1 - t) + 236 * t) | 0;
          const g = (255 * (1 - t) + 242 * t) | 0;
          const b = (255 * (1 - t) + 249 * t) | 0;
          state.bg32[y * pw + x] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
      state.lastW = pw; state.lastH = ph;
    }

    const { pts, col32, cand, meta, count, imgBuf, buf32, zBuf, bg32 } = state;
    buf32.set(bg32);
    zBuf.fill(1e9);

    // Slow continuous cinematic orbit around EgoHumans 3D scene
    const az = 0.24 + 0.36 * Math.sin(globalTime * 0.42);
    const el = 0.46 + 0.06 * Math.sin(globalTime * 0.31 + 0.7);
    const R = 4.55;
    const tx = 0.32, ty = -0.06, tz = 0.32;
    const ex = tx + R * Math.cos(el) * Math.sin(az);
    const ey = ty + R * Math.sin(el);
    const ez = tz + R * Math.cos(el) * Math.cos(az);

    let fx = tx - ex, fy = ty - ey, fz = tz - ez;
    const fLen = Math.hypot(fx, fy, fz); fx /= fLen; fy /= fLen; fz /= fLen;
    let rx = -fz, ry = 0, rz = fx;
    const rLen = Math.hypot(rx, rz); rx /= rLen; rz /= rLen;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const flP = (ph * 0.5) / Math.tan((42 * Math.PI) / 360);
    const cxP = pw * 0.5, cyP = ph * 0.52;

    // Z-buffered dense 3x3 / 5x5 direct pixel splatting (< 1.5ms for 34,000 points!)
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
    const proj1 = (pt) => {
      const dx = pt[0] - ex, dy = pt[1] - ey, dz = pt[2] - ez;
      const z = dx * fx + dy * fy + dz * fz;
      if (z <= 0.1) return null;
      return [cx0 + ((dx * rx + dy * ry + dz * rz) / z) * fl, cy0 - ((dx * ux + dy * uy + dz * uz) / z) * fl, z];
    };

    // Subtle floor perspective grid overlay
    const yf = meta.y_floor;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -4; k <= 4; k++) {
      const o = k * 0.52;
      const a1 = proj1([-2.08, yf, o]), b1 = proj1([2.08, yf, o]);
      if (a1 && b1) { ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); }
      const a2 = proj1([o, yf, -2.08]), b2 = proj1([o, yf, 2.08]);
      if (a2 && b2) { ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); }
    }
    ctx.stroke();

    // Animated Camera Frustums
    const drawFrustum = (cam, col, alpha) => {
      if (alpha <= 0.01) return null;
      const po = proj1(cam.origin);
      const pcs = cam.corners.map(proj1);
      const ptip = proj1(cam.tip);
      if (!po || pcs.some((c) => !c)) return null;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
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
      ctx.beginPath(); ctx.arc(po[0], po[1], 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return po;
    };

    const drawPill = (x, y, text, color, bgCol = "rgba(255,255,255,0.94)", dx = 12, dy = -12) => {
      ctx.save();
      ctx.font = '700 12.5px "JetBrains Mono Variable", "JetBrains Mono", monospace';
      const tw = ctx.measureText(text).width;
      const px = Math.max(10, Math.min(cssW - tw - 22, x + dx));
      const py = Math.max(46, Math.min(cssH - 26, y + dy));
      const w = tw + 14, h = 23, r = 7;
      ctx.fillStyle = bgCol;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(px, py - h * 0.5, w, h, r);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(text, px + 7, py + 0.5);
      ctx.restore();
    };

    const pExo = drawFrustum(meta.exo_cam, "#0284c7", easeOut(p / 0.10));
    const pEgo = drawFrustum(meta.ego_cam, "#d97706", easeOut((p - 0.04) / 0.12));

    // Phase 2 (p >= 0.10): Cast Epipole Ray ê_exo from Exo -> Ego
    const rayProg = easeOut((p - 0.10) / 0.22);
    const rs = meta.ray.start, re = meta.ray.end;
    if (rayProg > 0.01) {
      const curE = [rs[0] + (re[0] - rs[0]) * rayProg, rs[1] + (re[1] - rs[1]) * rayProg, rs[2] + (re[2] - rs[2]) * rayProg];
      const ps = proj1(rs), pe = proj1(curE);
      if (ps && pe) {
        ctx.save();
        ctx.strokeStyle = "rgba(16, 185, 129, 0.24)";
        ctx.lineWidth = 10; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(ps[0], ps[1]); ctx.lineTo(pe[0], pe[1]); ctx.stroke();
        ctx.strokeStyle = "#059669";
        ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(ps[0], ps[1]); ctx.lineTo(pe[0], pe[1]); ctx.stroke();
        // Animated traveling pulse along ray
        const up = ((globalTime * 0.65) % 1.0) * rayProg;
        const pp = proj1([rs[0] + (re[0] - rs[0]) * up, rs[1] + (re[1] - rs[1]) * up, rs[2] + (re[2] - rs[2]) * up]);
        if (pp) {
          ctx.fillStyle = "#fbbf24";
          ctx.beginPath(); ctx.arc(pp[0], pp[1], 5.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.8; ctx.stroke();
        }
        ctx.restore();
        if (rayProg > 0.65) {
          drawPill((ps[0] + pe[0]) * 0.5, (ps[1] + pe[1]) * 0.5, "ê_exo", "#059669", "rgba(236,253,245,0.95)", -54, 4);
        }
      }
    }

    // Phase 3 (p >= 0.26): Measure angular offsets φ_u + 3D distance d_u
    const measProg = easeOut((p - 0.26) / 0.22);
    const cands = meta.candidates || [];
    if (measProg > 0.01 && pExo) {
      ctx.save();
      ctx.globalAlpha = measProg;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "rgba(100, 116, 139, 0.72)";
      ctx.lineWidth = 1.6;
      for (const c of cands) {
        if (c.is_wearer || !c.pos) continue;
        const pc = proj1(c.pos);
        if (pc) { ctx.beginPath(); ctx.moveTo(pExo[0], pExo[1]); ctx.lineTo(pc[0], pc[1]); ctx.stroke(); }
      }
      ctx.setLineDash([]);
      // Pink angle arc φ_u to candidate #1
      const c1 = cands.find((c) => c.id === 1 && c.pos);
      if (c1 && pEgo) {
        const pc1 = proj1(c1.pos);
        if (pc1) {
          const a0 = Math.atan2(pEgo[1] - pExo[1], pEgo[0] - pExo[0]);
          const a1 = Math.atan2(pc1[1] - pExo[1], pc1[0] - pExo[0]);
          let da = a1 - a0;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const R_arc = 78;
          ctx.strokeStyle = "#be185d"; ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(pExo[0], pExo[1], R_arc, a0, a0 + da * measProg, da < 0);
          ctx.stroke();
          if (measProg > 0.7) {
            const am = a0 + da * 0.5;
            drawPill(pExo[0] + (R_arc + 18) * Math.cos(am), pExo[1] + (R_arc + 18) * Math.sin(am), "φ_u", "#be185d", "rgba(253,242,248,0.95)", -14, -4);
          }
        }
      }
      // Teal 3D distance segment d_u between #3 and Ego Cam ĉ
      const c3 = cands.find((c) => c.id === 3 && c.pos);
      if (c3 && pEgo) {
        const pc3 = proj1(c3.pos);
        if (pc3) {
          ctx.strokeStyle = "#0d9488"; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(pEgo[0], pEgo[1]);
          ctx.lineTo(pEgo[0] + (pc3[0] - pEgo[0]) * measProg, pEgo[1] + (pc3[1] - pEgo[1]) * measProg);
          ctx.stroke();
          if (measProg > 0.7) {
            drawPill((pEgo[0] + pc3[0]) * 0.5, (pEgo[1] + pc3[1]) * 0.5, "d_u", "#0f766e", "rgba(240,253,250,0.95)", -10, -22);
          }
        }
      }
      ctx.restore();
    }

    // Candidate dots & Phase 4 Lock-On Ring on Wearer #4
    const lockProg = easeOut((p - 0.42) / 0.16);
    for (const c of cands) {
      if (!c.pos) continue;
      const pc = proj1(c.pos);
      if (!pc) continue;
      if (c.is_wearer) {
        if (lockProg > 0.01) {
          const pulseR = 16 + 7 * Math.sin(globalTime * 4.2);
          ctx.save();
          ctx.globalAlpha = lockProg;
          ctx.strokeStyle = "#10b981"; ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.arc(pc[0], pc[1], pulseR, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = "#059669";
        ctx.beginPath(); ctx.arc(pc[0], pc[1], 8.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.2; ctx.stroke();
        if (lockProg > 0.3) {
          drawPill(pc[0], pc[1], "Wearer #4", "#047857", "rgba(236,253,245,0.96)", -96, -8);
        }
      } else if (measProg > 0.1) {
        ctx.save();
        ctx.globalAlpha = measProg;
        ctx.fillStyle = "#dc2626";
        ctx.beginPath(); ctx.arc(pc[0], pc[1], 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.8; ctx.stroke();
        drawPill(pc[0], pc[1], `#${c.id}`, "#dc2626", "rgba(255,255,255,0.94)", 10, -8);
        ctx.restore();
      }
    }
    if (pExo) drawPill(pExo[0], pExo[1], "Exo Cam", "#0284c7", "rgba(240,249,255,0.95)", 14, 10);
    if (pEgo && p > 0.14) drawPill(pEgo[0], pEgo[1], "Ego Cam ĉ", "#b45309", "rgba(255,251,235,0.95)", -14, -30);
  }

  return { render };
}

function initMethodExplorer() {
  const shell = document.getElementById("methodTheater");
  const acts = Array.from(document.querySelectorAll("#theaterStage .theater-act"));
  const steps = Array.from(document.querySelectorAll("#theaterStepper .th-step"));
  const fills = steps.map((s) => s.querySelector(".th-fill"));
  const numEl = document.getElementById("theaterActNum");
  const nameEl = document.getElementById("theaterActName");
  const dotEl = document.getElementById("theaterDot");
  const capEl = document.getElementById("theaterCaption");
  const playBtn = document.getElementById("thPlayPause");
  const prevBtn = document.getElementById("thPrev");
  const nextBtn = document.getElementById("thNext");
  const actBCanvas = document.getElementById("actBPointCanvas");
  const actBPhaseLbl = document.getElementById("actBPhaseLbl");
  if (!shell || !acts.length) return;

  const actBCloud = createActBPointCloud(actBCanvas);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = (x) => { const c = clamp(x); return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2; };

  // Cached animated DOM handles
  const sparkIn1 = document.getElementById("actASparkIn1");
  const sparkIn2 = document.getElementById("actASparkIn2");
  const sparkOut1 = document.getElementById("actASparkOut1");
  const sparkOut2 = document.getElementById("actASparkOut2");
  const aLayers = [0, 1, 2, 3].map((i) => document.getElementById(`actALayer${i}`));
  const aDepthClip = document.getElementById("actADepthReveal");
  const aDepthScan = document.getElementById("actADepthScan");
  const aEgoFrust = document.getElementById("actAEgoFrustum");
  const aCamHead = document.getElementById("actACamHead");
  const aDepthHead = document.getElementById("actADepthHead");

  const bBars = Array.from(document.querySelectorAll("#actBScoreTable .actb-bar-f"));
  const bWinRow = document.getElementById("actBWinRow");
  const cCards = [0, 1, 2].map((i) => document.getElementById(`actCCard${i}`));

  const dPredFrust = document.getElementById("actDPredFrustum");
  const dPredRay = document.getElementById("actDPredRay");
  const dErrText = document.getElementById("actDErrReadout");
  const dGradSpark = document.getElementById("actDGradSpark");
  const dLoraCard = document.getElementById("actDLoraCard");
  const dLosses = [0, 1, 2].map((i) => document.getElementById(`actDLoss${i}`));

  const eTraj = document.getElementById("actETraj");
  const eMarker = document.getElementById("actEMarker");
  const eTarget = document.getElementById("actETargetMask");

  let activeAct = 0;
  let elapsed = 0;
  let globalT = 0;
  let playing = true;
  let inView = true;

  function setAct(idx, resetTime = true) {
    activeAct = (idx + THEATER_ACTS.length) % THEATER_ACTS.length;
    if (resetTime) elapsed = 0;
    const info = THEATER_ACTS[activeAct];
    shell.dataset.activeAct = String(activeAct);
    if (numEl) numEl.textContent = info.num;
    if (nameEl) nameEl.textContent = info.name;
    if (dotEl) dotEl.style.background = info.dot;
    if (capEl) capEl.textContent = info.caption;
    acts.forEach((a, i) => a.classList.toggle("active", i === activeAct));
    steps.forEach((s, i) => {
      s.classList.toggle("active", i === activeAct);
      s.classList.toggle("done", i < activeAct);
      if (fills[i]) fills[i].style.width = i < activeAct ? "100%" : "0%";
    });
  }

  function animateActA(p) {
    // 1. Sparks from Input -> Tokens (0.04 -> 0.26)
    const uIn = clamp((p - 0.04) / 0.22);
    const inVis = p >= 0.04 && p <= 0.30 ? Math.sin(uIn * Math.PI) : 0;
    if (sparkIn1) { sparkIn1.setAttribute("cx", (202 + 64 * easeOut(uIn)).toFixed(1)); sparkIn1.setAttribute("opacity", inVis.toFixed(2)); }
    if (sparkIn2) { sparkIn2.setAttribute("cx", (202 + 64 * easeOut(uIn)).toFixed(1)); sparkIn2.setAttribute("opacity", inVis.toFixed(2)); }

    // 2. Sweep across Frame / Global Transformer layers (0.20 -> 0.56)
    aLayers.forEach((g, i) => {
      if (!g) return;
      const center = 0.24 + i * 0.095;
      const dist = Math.abs(p - center);
      const glow = dist < 0.09 ? 1 - dist / 0.09 : 0;
      g.style.filter = glow > 0.05 ? `drop-shadow(0 0 ${(glow * 8).toFixed(1)}px rgba(2,132,199,${(glow * 0.45).toFixed(2)}))` : "";
    });

    // 3. Sparks to Camera Head + Depth Head (0.50 -> 0.72)
    const uOut = clamp((p - 0.50) / 0.20);
    const outVis = p >= 0.50 && p <= 0.74 ? Math.sin(uOut * Math.PI) : 0;
    if (sparkOut1) { sparkOut1.setAttribute("cx", (686 + 72 * easeOut(uOut)).toFixed(1)); sparkOut1.setAttribute("opacity", outVis.toFixed(2)); }
    if (sparkOut2) { sparkOut2.setAttribute("cx", (686 + 72 * easeOut(uOut)).toFixed(1)); sparkOut2.setAttribute("opacity", outVis.toFixed(2)); }

    // 4. Camera Head gentle rotation + Depth Viridis scanline reveal (0.56 -> 0.90)
    const uHead = easeOut((p - 0.54) / 0.30);
    if (aEgoFrust) {
      const ang = -14 * (1 - uHead) + 3 * Math.sin(p * Math.PI * 4);
      aEgoFrust.setAttribute("transform", `translate(152, 26) rotate(${ang.toFixed(1)})`);
    }
    if (aDepthClip && aDepthScan) {
      const dw = 290 * Math.max(0.08, uHead);
      aDepthClip.setAttribute("width", dw.toFixed(1));
      aDepthScan.setAttribute("x1", (784 + dw).toFixed(1));
      aDepthScan.setAttribute("x2", (784 + dw).toFixed(1));
      aDepthScan.setAttribute("opacity", uHead < 0.98 && p > 0.52 ? "0.95" : "0");
    }
    if (aCamHead) aCamHead.style.opacity = (0.52 + 0.48 * easeOut((p - 0.48) / 0.18)).toFixed(2);
    if (aDepthHead) aDepthHead.style.opacity = (0.52 + 0.48 * easeOut((p - 0.52) / 0.18)).toFixed(2);
  }

  function animateActB(p) {
    actBCloud.render(p, globalT);
    if (actBPhaseLbl) {
      actBPhaseLbl.textContent =
        p < 0.22 ? "1. Placing Exo + Ego Camera Pose from (A)…" :
        p < 0.46 ? "2. Casting EgoRay Epipole ê_exo in 3D…" :
        p < 0.68 ? "3. Scoring Angular Offset φ_u & 3D Distance d_u…" :
                   "4. Lowest Score Locks Onto Wearer #4 (0.1° · 0.06)";
    }
    const barU = easeOut((p - 0.18) / 0.30);
    bBars.forEach((b) => {
      const target = Number(b.dataset.w || 20);
      b.style.width = `${(target * barU).toFixed(1)}%`;
    });
    if (bWinRow) bWinRow.classList.toggle("locked", p >= 0.44);
  }

  function animateActC(p) {
    const starts = [0.05, 0.30, 0.55];
    cCards.forEach((c, i) => {
      if (!c) return;
      const on = p >= starts[i];
      const focus = p >= starts[i] && (i === 2 || p < starts[i + 1]);
      c.classList.toggle("shown", on);
      c.classList.toggle("spotlight", focus);
    });
  }

  function animateActD(p) {
    // Smooth convergence of predicted Ego frustum (612, 106, -22deg) -> GT (672, 146, 0deg)
    const conv = easeInOut((p - 0.14) / 0.58);
    const px = 612 + (672 - 612) * conv;
    const py = 106 + (146 - 106) * conv;
    const rot = -22 * (1 - conv);
    if (dPredFrust) dPredFrust.setAttribute("transform", `translate(${px.toFixed(1)}, ${py.toFixed(1)}) rotate(${rot.toFixed(1)})`);
    if (dPredRay) { dPredRay.setAttribute("x2", px.toFixed(1)); dPredRay.setAttribute("y2", py.toFixed(1)); }
    if (dErrText) {
      const err = (18.4 * Math.pow(1 - conv, 2.2) + 0.18).toFixed(1);
      dErrText.textContent = `pose err: ${err}°`;
      dErrText.setAttribute("fill", conv > 0.8 ? "#059669" : "#d97706");
    }
    // Sequential highlight on 3 loss terms
    dLosses.forEach((el, i) => {
      if (!el) return;
      const active = p >= 0.18 + i * 0.16;
      el.style.opacity = active ? "1" : "0.45";
    });
    // Backprop spark traveling from Loss back into Rank-64 LoRA
    if (dGradSpark && dLoraCard) {
      const gU = (p * 2.4) % 1.0;
      const gx = 336 - 50 * gU;
      const gy = 330 - 18 * gU;
      dGradSpark.setAttribute("cx", gx.toFixed(1));
      dGradSpark.setAttribute("cy", gy.toFixed(1));
      dGradSpark.setAttribute("opacity", p > 0.22 ? Math.sin(gU * Math.PI).toFixed(2) : "0");
      dLoraCard.setAttribute("stroke-width", p > 0.45 ? "3.2" : "2.4");
    }
  }

  function animateActE(p) {
    // Pull epipole smoothly along quadratic Bezier M(132,154) Q(212,162) (260,240)
    const u = easeInOut((p - 0.16) / 0.56);
    if (eTraj) eTraj.setAttribute("stroke-dashoffset", (220 * (1 - u)).toFixed(1));
    if (eMarker) {
      const t = u, mt = 1 - t;
      const x = mt * mt * 132 + 2 * mt * t * 212 + t * t * 260;
      const y = mt * mt * 154 + 2 * mt * t * 162 + t * t * 240;
      eMarker.setAttribute("transform", `translate(${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
    if (eTarget) {
      eTarget.setAttribute("stroke-width", u > 0.9 ? "3.6" : "2.4");
    }
  }

  steps.forEach((s, i) => s.addEventListener("click", () => setAct(i, true)));
  if (prevBtn) prevBtn.addEventListener("click", () => setAct(activeAct - 1, true));
  if (nextBtn) nextBtn.addEventListener("click", () => setAct(activeAct + 1, true));
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      playing = !playing;
      playBtn.textContent = playing ? "Pause" : "Play";
    });
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); }, { threshold: 0.05 });
    io.observe(shell);
  }

  setAct(0, true);
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
        setAct(activeAct + 1, true);
      }
    }
    const p = clamp(elapsed / dur);
    if (fills[activeAct]) fills[activeAct].style.width = `${(p * 100).toFixed(2)}%`;

    if (activeAct === 0) animateActA(p);
    else if (activeAct === 1) animateActB(p);
    else if (activeAct === 2) animateActC(p);
    else if (activeAct === 3) animateActD(p);
    else if (activeAct === 4) animateActE(p);
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   4. CONCRETE REAL-SCENE 2D VS 3D DEPTH DISAMBIGUATION (WILD LIONS)
============================================================ */
function initOcclusionLab() {
  const scoreList = document.getElementById("labScoreList");
  const verdictEl = document.getElementById("labVerdict");
  const banner = document.getElementById("depthModeBanner");
  const bannerText = document.getElementById("depthBannerText");
  const btnAngle = document.getElementById("labModeAngle");
  const btnEgoRay = document.getElementById("labModeEgoRay");
  if (!scoreList || !btnAngle || !btnEgoRay) return;

  let mode = "egoray"; // "angle" | "egoray"
  const cands = [
    { id: "Wearer #2", role: "Collar-cam lion (true wearer)", ang: 0.1, d3: 0.18, s: 0.19, isW: true },
    { id: "Occluder #5", role: "Foreground lion on same ray", ang: 1.1, d3: 0.79, s: 0.85, isW: false, isOcc: true },
    { id: "Lion #4", role: "Left background lion", ang: 11.4, d3: 0.62, s: 1.21, isW: false },
    { id: "Lion #1", role: "Center-left lion", ang: 14.8, d3: 0.58, s: 1.35, isW: false },
  ];

  function render() {
    const is3D = mode === "egoray";
    scoreList.innerHTML = cands.map((c) => {
      const isHighlight = is3D ? c.isW : c.isOcc;
      const cls = is3D ? (c.isW ? "pick-ok" : "") : (c.isOcc ? "pick-warn" : (c.isW ? "pick-tie" : ""));
      const badge = is3D
        ? (c.isW ? "PICKED ✓" : "REJECTED")
        : (c.isOcc ? "COLLINEAR TIE (~1°)" : (c.isW ? "FRAGILE TIE" : "OFF RAY"));
      const pct = is3D ? Math.min(100, (c.s / 1.4) * 100) : Math.min(100, (c.ang / 16) * 100);
      const col = c.isW ? "#059669" : (c.isOcc ? "#dc2626" : "#94a3b8");
      return `
        <div class="lab-sc-item ${cls}">
          <div class="lab-sc-top">
            <div><span>${c.id}</span> <small class="lab-sc-role">&middot; ${c.role}</small></div>
            <span class="lab-sc-badge">${badge}</span>
          </div>
          <div class="lab-sc-metrics">
            <span>&theta; = <strong>${c.ang.toFixed(1)}&deg;</strong></span>
            <span>d/&#8214;c&#770;&#8214; = <strong>${c.d3.toFixed(2)}</strong></span>
            <span>${is3D ? `score s = <strong>${c.s.toFixed(2)}</strong>` : `2D angle = <strong>${c.ang.toFixed(1)}&deg;</strong>`}</span>
          </div>
          <div class="lab-sc-track"><div class="lab-sc-fill" style="width:${Math.max(4, pct).toFixed(1)}%;background:${col};"></div></div>
        </div>
      `;
    }).join("");

    if (is3D) {
      if (banner) banner.className = "depth-mode-banner ok";
      if (bannerText) bannerText.textContent = "EgoRay (Angle + 3D Depth) → Locks onto Wearer #2 (score 0.19 vs. #5 score 0.85)";
      if (verdictEl) {
        verdictEl.className = "lab-verdict ok";
        verdictEl.innerHTML = `<span><strong>Clean 3D Separation (+0.66 margin):</strong> Foreground lion #5 sits 0.79 baseline lengths away from the ego camera, while true wearer #2 sits right at ĉ.</span>`;
      }
    } else {
      if (banner) banner.className = "depth-mode-banner warn";
      if (bannerText) bannerText.textContent = "2D Angle Only → Foreground lion #5 (1.1°) and Wearer #2 (0.1°) collapse onto nearly the same ray!";
      if (verdictEl) {
        verdictEl.className = "lab-verdict warn";
        verdictEl.innerHTML = `<span><strong>Fragile 1.0° Margin in 2D:</strong> Without 3D depth, a tiny epipole jitter or foreground step flips the prediction onto occluder #5.</span>`;
      }
    }
  }

  btnAngle.addEventListener("click", () => {
    mode = "angle";
    btnAngle.classList.add("active");
    btnEgoRay.classList.remove("active", "green");
    render();
  });
  btnEgoRay.addEventListener("click", () => {
    mode = "egoray";
    btnEgoRay.classList.add("active", "green");
    btnAngle.classList.remove("active");
    render();
  });
  render();
}

/* ============================================================
   5. FINDEGO-1M DATASET MOSAIC & LENS FILMSTRIP
============================================================ */
const DATASET_ITEMS = [
  { img: "comind.jpg", name: "CoMind (Real)", sub: "Indoor collaboration · L0", lvl: "L0", cat: "real" },
  { img: "egohumans.jpg", name: "EgoHumans (Real)", sub: "Multi-person sports · L2", lvl: "L2", cat: "real" },
  { img: "v2xreal.jpg", name: "V2X-Real (Real)", sub: "Autonomous vehicles · L3", lvl: "L3", cat: "real" },
  { img: "droid.jpg", name: "DROID (Real)", sub: "Robot arm · CC BY 4.0 · L3", lvl: "L3", cat: "real" },
  { img: "miluv.jpg", name: "MILUV (Real)", sub: "Flying drones · CC BY 4.0 · L3", lvl: "L3", cat: "real" },
  { img: "indoor.jpg", name: "Indoor Humans", sub: "269 Blender rooms · L1", lvl: "L1", cat: "humans" },
  { img: "city.jpg", name: "Urban City", sub: "100 city layouts · L1", lvl: "L1", cat: "humans" },
  { img: "football.jpg", name: "Sports Arenas", sub: "Football, Hockey, Rugby, Volley · L2", lvl: "L2", cat: "humans" },
  { img: "thermal.jpg", name: "Thermal IR ↔ RGB", sub: "Cross-modal night rooms · L1", lvl: "L1", cat: "humans" },
  { img: "unreal.jpg", name: "Unreal Crowds", sub: "36 realistic Unreal maps · L2", lvl: "L2", cat: "humans" },
  { img: "vacuum.jpg", name: "Robot Vacuums", sub: "59 floor-level rooms · L3", lvl: "L3", cat: "beyond" },
  { img: "pets.jpg", name: "Household Pets", sub: "Collar-cam cats & dogs · L3", lvl: "L3", cat: "beyond" },
  { img: "wild.jpg", name: "Wild Animals", sub: "128 savanna & herd scenes · L3", lvl: "L3", cat: "beyond" },
  { img: "fish.jpg", name: "Sharks & Fish", sub: "Underwater marine life · L3", lvl: "L3", cat: "beyond" },
  { img: "rov.jpg", name: "Underwater ROVs", sub: "Submersible robots · L3", lvl: "L3", cat: "beyond" },
  { img: "birds.jpg", name: "Perched & Flying Birds", sub: "Canopy & open-sky views · L3", lvl: "L3", cat: "beyond" },
];

const LENS_ITEMS = [
  { img: "v1_pinhole.jpg", label: "v1 Pinhole" },
  { img: "aria_fisheye.jpg", label: "Aria Fisheye" },
  { img: "gopro_wide.jpg", label: "GoPro Wide" },
  { img: "smart_glasses.jpg", label: "Smart Glasses" },
  { img: "animal_collar.jpg", label: "Animal Collar" },
  { img: "underwater_dome.jpg", label: "Underwater Dome" },
  { img: "drone_fpv.jpg", label: "Drone FPV" },
  { img: "vacuum_floor.jpg", label: "Vacuum Floor" },
];

function initDatasetSection() {
  const mosaic = document.getElementById("datasetMosaic");
  const filterBtns = document.querySelectorAll("#datasetFilters .filter-pill");
  if (mosaic) {
    mosaic.innerHTML = DATASET_ITEMS.map((d) => {
      const lvlCls = d.lvl === "L0" ? "lvl-l0" : d.lvl === "L1" ? "lvl-l1" : d.lvl === "L2" ? "lvl-l2" : "lvl-l3";
      return `
        <div class="dom-tile" data-cat="${d.cat}" data-lightbox="./assets/dataset/${d.img}" data-lb-title="FindEgo-1M · ${d.name}" data-lb-sub="${d.sub} · Green mask = camera wearer, inset = synchronized ego view">
          <img src="./assets/dataset/${d.img}" alt="${d.name}" loading="lazy">
          <div class="dom-tile-cap">
            <div>${d.name}<span class="dom-tile-sub">${d.sub}</span></div>
            <span class="lvl-badge ${lvlCls}">${d.lvl}</span>
          </div>
        </div>
      `;
    }).join("");

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

  const lensGrid = document.getElementById("lensGrid");
  if (lensGrid) {
    lensGrid.innerHTML = LENS_ITEMS.map((l) => `
      <div class="lens-item" data-lightbox="./assets/lens/${l.img}" data-lb-title="FindEgo-1M Lens Profile · ${l.label}" data-lb-sub="Simulated v2 real-device lens profile matching commercial wearable, underwater, animal collar, and drone optics.">
        <img src="./assets/lens/${l.img}" alt="${l.label}" loading="lazy">
        <span>${l.label}</span>
      </div>
    `).join("");
  }
}

/* ============================================================
   6. IMAGE-LEVEL QUALITATIVE RESULTS (TRACKS A, B & C)
============================================================ */
const QUAL_ITEMS = [
  { img: "real_gym.jpg", title: "Real Humans · Indoor Gym", sub: "EgoHumans · Fisheye Aria ego", badge: "REAL · L2", cls: "real", cat: "real" },
  { img: "real_trail.jpg", title: "Real Humans · Outdoor Trail", sub: "EgoHumans · Multi-person", badge: "REAL · L2", cls: "real", cat: "real" },
  { img: "v2x_rsu.jpg", title: "Real Vehicles · Roadside", sub: "V2X-Real · 7 cars at intersection", badge: "REAL · L3", cls: "real", cat: "real" },
  { img: "v2x_v2v.jpg", title: "Real Vehicles · Car-to-Car", sub: "V2X-Real · Peer vehicle ego", badge: "REAL · L3", cls: "real", cat: "real" },
  { img: "droid_arm.jpg", title: "Real Robot Arm · Bench", sub: "DROID (CC BY 4.0) · Wrist cam", badge: "REAL · L3", cls: "real", cat: "real" },
  { img: "thermal_rgb2ir.jpg", title: "Cross-Modal RGB → Thermal", sub: "26.6% → 94.9% Acc · 1.7° med err", badge: "IR · L1", cls: "ir", cat: "extreme" },
  { img: "thermal_ir2ir.jpg", title: "Thermal → Thermal Night", sub: "Zero visible light · 89.1% Acc", badge: "IR · L1", cls: "ir", cat: "extreme" },
  { img: "sports_football.jpg", title: "Football Stadium", sub: "Long-range stadium · 85.7 κ-Acc", badge: "L2", cls: "", cat: "extreme" },
  { img: "sports_hockey.jpg", title: "Ice Hockey Arena", sub: "Identical jerseys & helmets", badge: "L2", cls: "", cat: "extreme" },
  { img: "indoor_humans.jpg", title: "Indoor Multi-Person", sub: "Close-range room · 97.3 κ-Acc", badge: "L1", cls: "", cat: "humans" },
  { img: "nature_forest.jpg", title: "Nature Forest Group", sub: "7 candidates · 93.6 κ-Acc", badge: "L1", cls: "", cat: "humans" },
  { img: "city_street.jpg", title: "City Street", sub: "Urban sidewalk · 93.1 κ-Acc", badge: "L1", cls: "", cat: "humans" },
  { img: "unreal_scene.jpg", title: "Unreal Outdoor Scene", sub: "Unseen engine · 88.6 κ-Acc", badge: "L2", cls: "", cat: "humans" },
  { img: "robot_vacuum.jpg", title: "Robot Vacuum Fleet", sub: "Floor-level wide view · 94.1 κ-Acc", badge: "L3", cls: "", cat: "l3" },
  { img: "pets_home.jpg", title: "Household Pets", sub: "Collar camera · 98.7 κ-Acc", badge: "L3", cls: "", cat: "l3" },
  { img: "wild_savanna.jpg", title: "Wild Savanna Herd", sub: "Near-identical animals · L3", badge: "L3", cls: "", cat: "l3" },
  { img: "underwater_rov.jpg", title: "Underwater ROVs", sub: "Turbid water · Unseen robot", badge: "L3", cls: "", cat: "l3" },
  { img: "underwater_divers.jpg", title: "Scuba Divers", sub: "Underwater dome optics · L1", badge: "L1", cls: "", cat: "l3" },
  { img: "birds_flock.jpg", title: "Flying Bird Flock", sub: "Tiny sky silhouettes · L3", badge: "L3", cls: "", cat: "l3" },
  { img: "drones_air.jpg", title: "Aerial Drones", sub: "High-altitude flight · L3", badge: "L3", cls: "", cat: "l3" },
];

function initQualitative(extraManifest) {
  // Tab switching
  const qBtns = document.querySelectorAll("#qualTabBar .tab-btn");
  const qPanels = document.querySelectorAll("#qualitative .tab-panel");
  qBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.qtab;
      qBtns.forEach((b) => b.classList.toggle("active", b === btn));
      qPanels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });

  // Track A 20-card grid
  const grid = document.getElementById("qualGrid");
  if (grid) {
    grid.innerHTML = QUAL_ITEMS.map((item) => `
      <div class="qual-card" data-qcat="${item.cat}" data-lightbox="./assets/qual/${item.img}" data-lb-title="Track A · ${item.title}" data-lb-sub="${item.sub} · Green = EgoRay wearer, Cyan + = predicted epipole, Yellow ○ = true epipole">
        <div class="qual-img-wrap">
          <img src="./assets/qual/${item.img}" alt="${item.title}" loading="lazy">
          <span class="qual-chip ${item.cls}">${item.badge}</span>
        </div>
        <div class="qual-body">
          <div><strong>${item.title}</strong><span>${item.sub}</span></div>
        </div>
      </div>
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

  // Track B cards (real rendered cards if present + Present/Absent pair)
  const tbGrid = document.getElementById("trackBGrid");
  if (tbGrid) {
    const cards = [];
    const tbList = extraManifest?.track_b || [];
    for (const item of tbList) {
      const isAbs = item.gt_absent;
      const badge = item.pred_present
        ? `<span class="tag-pill">PRESENT · θ=${item.best_near}°</span>`
        : `<span class="tag-pill red">ABSENT · ${item.behind ? "Behind Exo" : `θ=${item.best_near}°`}</span>`;
      const niceTitle = item.name
        .replace("trackb_present_fencing", "Real Fencing · Open-Vocab Wearer Present")
        .replace("trackb_present_droid", "Real Robot Arm (DROID) · Open-Vocab Present")
        .replace("trackb_absent_egohumans", "Real Humans (EgoHumans) · Wearer Absent")
        .replace("trackb_absent_comind", "Real Indoor (CoMind) · Wearer Absent");
      const niceSub = isAbs
        ? `SAM 3 proposes ${item.props} visible candidates; EgoRay places the ego camera outside all proposals and predicts ABSENT.`
        : `No pre-given masks: SAM 3 proposes ${item.props} instances from category words, and EgoRay segments the exact wearer.`;
      cards.push(`
        <div class="tbc-card" data-lightbox="./assets/tracks/${item.name}.jpg" data-lb-title="Track B · ${niceTitle}" data-lb-sub="${niceSub}">
          <img src="./assets/tracks/${item.name}.jpg" alt="${niceTitle}" loading="lazy">
          <div class="tbc-meta">
            <div><strong>${niceTitle}</strong><p>${niceSub}</p></div>
            ${badge}
          </div>
        </div>
      `);
    }
    // Always include clean Present vs Absent illustration from FindEgo-1M simulated rooms
    cards.push(`
      <div class="tbc-card" data-lightbox="./assets/tracks/dc_q_present.jpg" data-lb-title="Track B · Present Query (Wearer Visible in Exo)" data-lb-sub="All visible humans are proposed as candidates; the predicted ego epipole falls directly on the green wearer mask.">
        <div class="pa-pair-grid">
          <img src="./assets/tracks/dc_q_present.jpg" alt="Present exo view" loading="lazy">
          <img src="./assets/tracks/dc_q_ego.jpg" alt="Present ego view" loading="lazy">
        </div>
        <div class="tbc-meta">
          <div><strong>FindEgo-1M Room · Wearer Present</strong><p>Left: Exo view with candidate masks &amp; wearer epipole. Right: Synchronized Ego view.</p></div>
          <span class="tag-pill">PRESENT</span>
        </div>
      </div>
    `);
    cards.push(`
      <div class="tbc-card" data-lightbox="./assets/tracks/dc_q_absent.jpg" data-lb-title="Track B · Absent Query (Wearer Outside Exo FOV)" data-lb-sub="The ego wearer is facing the bathroom sink outside the exo view; EgoRay rejects the visible bystander and outputs ABSENT.">
        <div class="pa-pair-grid">
          <img src="./assets/tracks/dc_q_absent.jpg" alt="Absent exo view" loading="lazy">
          <img src="./assets/tracks/dc_q_absent_ego.jpg" alt="Absent ego view" loading="lazy">
        </div>
        <div class="tbc-meta">
          <div><strong>FindEgo-1M Room · Wearer Absent</strong><p>Left: Only a bystander appears in exo view. Right: Ego camera is in an adjacent corner &rarr; ABSENT.</p></div>
          <span class="tag-pill red">ABSENT</span>
        </div>
      </div>
    `);
    tbGrid.innerHTML = cards.join("");
  }

  // Track C Mutual Camera Localization cards
  const tcGrid = document.getElementById("trackCGrid");
  if (tcGrid) {
    const tcItems = [
      ...(extraManifest?.track_c || []),
      {
        src: "./assets/cards/egohumans_poster.jpg",
        title: "Real Humans (EgoHumans) · Mutual Exo ↔ Ego Epipoles",
        sub: "Left panel shows Exo view with amber Ego-camera crosshair and Ego fisheye view with blue Exo-camera crosshair, synchronized in 3D.",
        badge: "Real · L2 · 0.07°",
      },
      {
        src: "./assets/cards/wild_animals_poster.jpg",
        title: "Wild Animals (Lions) · Mutual Pose Under Occlusion",
        sub: "Simultaneously predicts the collar camera inside the lion herd and the third-person camera direction from the lion's perspective.",
        badge: "L3 · 0.06°",
      },
    ];
    tcGrid.innerHTML = tcItems.map((it) => `
      <div class="tbc-card" data-lightbox="${it.src}" data-lb-title="Track C · ${it.title}" data-lb-sub="${it.sub}">
        <img src="${it.src}" alt="${it.title}" loading="lazy">
        <div class="tbc-meta">
          <div><strong>${it.title}</strong><p>${it.sub}</p></div>
          <span class="tag-pill amber">${it.badge}</span>
        </div>
      </div>
    `).join("");
  }

  // Interactive Raw <-> EgoRay Wipe Curtain
  const wipeRange = document.getElementById("wipeRange");
  const wipeClip = document.getElementById("wipeExoClip");
  const wipeHandle = document.getElementById("wipeHandle");
  const wipeRaw = document.getElementById("wipeExoRaw");
  const wipeAnn = document.getElementById("wipeExoAnn");
  const wipeEgo = document.getElementById("wipeEgoImg");
  const wipeTitle = document.getElementById("wipeTitle");
  const wipeBadge = document.getElementById("wipeBadge");
  const wipeNote = document.getElementById("wipeNote");
  const wipeThumbs = document.getElementById("wipeThumbs");
  if (wipeRange && wipeThumbs) {
    const setPos = (pct) => {
      wipeClip.style.clipPath = `inset(0 ${(100 - pct).toFixed(1)}% 0 0)`;
      wipeHandle.style.left = `${pct}%`;
    };
    wipeRange.addEventListener("input", () => setPos(Number(wipeRange.value)));
    setPos(Number(wipeRange.value));

    const wBtns = buildThumbDock(wipeThumbs, (idx) => selectWipe(idx));
    function selectWipe(idx) {
      const sc = SCENES[idx];
      wipeRaw.src = `./assets/cards/${sc.tag}_exo_raw.jpg`;
      wipeAnn.src = `./assets/cards/${sc.tag}_exo_ann.jpg`;
      wipeEgo.src = `./assets/cards/${sc.tag}_ego_ann.jpg`;
      if (wipeTitle) wipeTitle.textContent = sc.title;
      if (wipeBadge) wipeBadge.textContent = sc.badge;
      if (wipeNote) wipeNote.textContent = sc.note;
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
   7. INTERACTIVE 13-DOMAIN UNSEEN RADAR CHART
============================================================ */
const RADAR_DOMAINS = [
  "Real (L2)", "Top", "Sports", "Unreal", "Vehicles", "Legged", "Arms",
  "Vacuums", "Pets", "Wild", "Fish", "Birds", "Drones",
];

const RADAR_MODELS = [
  { name: "EgoRay (Ours)", mean: 77.7, color: "#059669", fill: "rgba(5,150,105,0.20)", width: 2.8, primary: true,
    vals: [96.4, 99.7, 85.7, 88.6, 84.9, 90.3, 64.6, 94.1, 98.7, 55.9, 46.4, 49.5, 55.0] },
  { name: "EgoRay-ZS", mean: 58.7, color: "#d97706", fill: "rgba(217,119,6,0.10)", width: 2.0, primary: false,
    vals: [91.1, 83.9, 60.6, 70.5, 50.5, 81.2, 47.1, 88.4, 95.5, 28.3, 14.7, 25.8, 25.4] },
  { name: "Pi3X", mean: 50.1, color: "#7c3aed", fill: "rgba(124,58,237,0.06)", width: 1.7, primary: false,
    vals: [83.9, 90.9, 39.4, 58.4, 39.2, 69.7, 23.7, 88.7, 92.8, 23.0, 13.1, 21.5, 7.3] },
  { name: "MapAnything", mean: 49.6, color: "#0284c7", fill: "rgba(2,132,199,0.06)", width: 1.7, primary: false,
    vals: [79.7, 84.5, 48.9, 56.4, 51.6, 70.3, 29.9, 77.1, 89.8, 16.9, 9.1, 13.7, 17.6] },
  { name: "VGGT", mean: 35.9, color: "#64748b", fill: "rgba(100,116,139,0.05)", width: 1.4, primary: false,
    vals: [78.3, 44.5, 25.3, 42.8, 25.7, 58.7, 15.0, 69.1, 71.6, 7.9, 8.6, 10.5, 8.2] },
];

function initRadar() {
  const svg = document.getElementById("radarSvg");
  const leg = document.getElementById("radarLegend");
  const tip = document.getElementById("radarTooltip");
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
    // Concentric rings
    for (const lv of [20, 40, 60, 80, 100]) {
      const pts = RADAR_DOMAINS.map((_, i) => pt(i, lv).map((n) => n.toFixed(1)).join(",")).join(" ");
      html += `<polygon points="${pts}" fill="none" stroke="#e2e8f0" stroke-width="${lv === 100 ? 1.4 : 1}"/>`;
      if (lv === 40 || lv === 80 || lv === 100) {
        html += `<text x="${cx + 4}" y="${(cy - (lv / 100) * R + 10).toFixed(1)}" font-size="9.5" fill="#94a3b8" font-family="monospace">${lv}</text>`;
      }
    }
    // Axes
    for (let i = 0; i < N; i++) {
      const [x2, y2] = pt(i, 100);
      const isH = i === hoverIdx;
      html += `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${isH ? "#0284c7" : "#e2e8f0"}" stroke-width="${isH ? 2 : 1}"/>`;
    }
    // Polygons (draw in reverse so EgoRay is on top)
    for (let m = RADAR_MODELS.length - 1; m >= 0; m--) {
      if (!visible[m]) continue;
      const mod = RADAR_MODELS[m];
      const pts = mod.vals.map((v, i) => pt(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
      html += `<polygon points="${pts}" fill="${mod.fill}" stroke="${mod.color}" stroke-width="${mod.width}" stroke-linejoin="round"/>`;
      if (m === 0) {
        for (let i = 0; i < N; i++) {
          const [px, py] = pt(i, mod.vals[i]);
          html += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${i === hoverIdx ? 5 : 3}" fill="${mod.color}" stroke="#ffffff" stroke-width="1.2"/>`;
        }
      }
    }
    // Labels & interactive hit targets
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
      const lx = cx + (R + 24) * Math.cos(a);
      const ly = cy + (R + 20) * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.18 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      const isH = i === hoverIdx;
      html += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="${isH ? 12 : 11}" font-weight="${isH ? 800 : 700}" fill="${isH ? "#0284c7" : "#334155"}" style="cursor:pointer" data-axis="${i}">${RADAR_DOMAINS[i]}</text>`;
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
      tip.textContent = "Hover any domain axis on the radar to inspect per-domain κ-Acc.";
      return;
    }
    const dom = RADAR_DOMAINS[hoverIdx];
    const parts = RADAR_MODELS.filter((_, i) => visible[i]).map((m) => `${m.name.split(" ")[0]}: ${m.vals[hoverIdx].toFixed(1)}`);
    tip.textContent = `${dom}  →  ${parts.join("  |  ")}`;
  }

  leg.innerHTML = "";
  RADAR_MODELS.forEach((m, idx) => {
    const row = document.createElement("div");
    row.className = `radar-leg-row${m.primary ? " primary" : ""}`;
    row.innerHTML = `
      <div class="radar-leg-left"><span class="radar-swatch" style="background:${m.color}"></span><span>${m.name}</span></div>
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
}

/* ============================================================
   8. BENCHMARK TABS, SCROLL SPY & BIBTEX COPY
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
  const btn = document.getElementById("copyBibBtn");
  const code = document.getElementById("bibtexCode");
  if (!btn || !code) return;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy BibTeX"; }, 1800);
    } catch (_) {
      btn.textContent = "Copy failed";
      setTimeout(() => { btn.textContent = "Copy BibTeX"; }, 1800);
    }
  });
}

function initScrollEffects() {
  // 1. RoboScope-Kit sticky navbar border transition on scroll
  const nav = document.querySelector(".top-nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // 2. RoboScope-Kit smooth scroll-reveal (distance 28px, blur 4px, power3.out)
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
    // Immediate mount reveal for above-the-fold Hero items
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
    // Also immediately reveal anything already inside or above the viewport on programmatic jumps
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

  // 3. RoboScope-Kit CountText ease-out-quartic count-up for KPI metrics
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
   BOOT: Load Dynamic Manifest + Initialize Everything
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
  initTeaser();
  initInteractive3D();
  initMethodExplorer();
  initOcclusionLab();
  initDatasetSection();
  initQualitative(extraManifest);
  initRadar();
  initBenchmarkTabs();
  initScrollSpy();
  initScrollEffects();
  initCopyBibtex();
}

boot();
