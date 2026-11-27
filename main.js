import { EgoRay3DViewer } from "./viewer3d.js";

const SCENES = [
  {
    tag: "egohumans",
    title: "Real Humans (EgoHumans)",
    short: "Real Humans",
    badge: "Real · L2",
    note: "EgoHumans real multi-person · 4 candidates · 0.07° epipole error",
  },
  {
    tag: "indoor_humans",
    title: "Indoor Multi-Person",
    short: "Indoor Humans",
    badge: "Simulated · L1",
    note: "FindEgo-1M indoor room · 3 candidates · 0.16° epipole error",
  },
  {
    tag: "outdoor_humans",
    title: "Outdoor Forest",
    short: "Outdoor Forest",
    badge: "Simulated · L1",
    note: "FindEgo-1M outdoor forest · 4 candidates · 0.05° epipole error",
  },
  {
    tag: "robot_vacuum",
    title: "Robot Vacuums",
    short: "Robot Vacuums",
    badge: "Unseen Wearer · L3",
    note: "FindEgo-1M robot vacuum · 3 candidates · 0.20° epipole error",
  },
  {
    tag: "wild_animals",
    title: "Wild Animals (Lions)",
    short: "Wild Animals",
    badge: "Unseen Wearer · L3",
    note: "FindEgo-1M collar camera on lions · 5 candidates · 0.06° epipole error",
  },
  {
    tag: "underwater",
    title: "Underwater Sea Turtles",
    short: "Underwater",
    badge: "Unseen Wearer · L3",
    note: "FindEgo-1M underwater coral · 5 candidates · 0.07° epipole error",
  },
];

function buildThumbDock(container, onSelect) {
  return SCENES.map((sc, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb-btn";
    btn.dataset.index = String(idx);
    btn.setAttribute("aria-label", `Show ${sc.title}`);
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `
      <img src="./assets/cards/${sc.tag}_exo_ann.jpg" alt="${sc.title}" loading="lazy">
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
  const dock = document.getElementById("teaserThumbs");
  if (!video || !dock) return;

  let activeIdx = 0;
  const buttons = buildThumbDock(dock, (idx) => select(idx));

  function select(idx) {
    activeIdx = (idx + SCENES.length) % SCENES.length;
    const sc = SCENES[activeIdx];
    video.pause();
    video.poster = `./assets/cards/${sc.tag}_poster.jpg`;
    video.src = `./assets/videos/${sc.tag}.mp4`;
    video.load();
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    if (titleEl) titleEl.textContent = sc.note;
    if (badgeEl) badgeEl.textContent = sc.badge;
    buttons.forEach((b, i) => {
      const on = i === activeIdx;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
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
  const exoImg = document.getElementById("i3dExoImg");
  const egoImg = document.getElementById("i3dEgoImg");
  const readoutList = document.getElementById("i3dReadoutList");
  const sceneTitle = document.getElementById("i3dSceneTitle");
  const overlayBtn = document.getElementById("btn2DOverlay");

  if (!host || !dock) return;

  const viewer = new EgoRay3DViewer(host, labels, status);
  let activeIdx = 0;
  let show2DAnn = true;

  function update2DImages() {
    const sc = SCENES[activeIdx];
    const suf = show2DAnn ? "ann" : "raw";
    exoImg.src = `./assets/cards/${sc.tag}_exo_${suf}.jpg`;
    egoImg.src = `./assets/cards/${sc.tag}_ego_${suf}.jpg`;
    if (overlayBtn) {
      overlayBtn.textContent = show2DAnn ? "Masks: On" : "Masks: Off";
    }
  }

  function renderReadout(meta) {
    readoutList.innerHTML = "";
    const cands = meta.candidates || [];
    const maxScore = Math.max(1.0, ...cands.map((c) => Number.isFinite(c.score) ? c.score : 0));
    for (const c of cands.slice(0, 5)) {
      const pct = Math.max(6, Math.min(100, (c.score / maxScore) * 100));
      const row = document.createElement("div");
      row.className = `i3d-row ${c.is_wearer ? "wearer" : "other"}`;
      row.innerHTML = `
        <span class="cid">#${c.id}${c.is_wearer ? "*" : ""}</span>
        <div class="i3d-bar-track"><div class="i3d-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="val">${c.angle.toFixed(1)}° · ${c.score.toFixed(2)}</span>
      `;
      readoutList.appendChild(row);
    }
  }

  const buttons = buildThumbDock(dock, (idx) => select(idx));

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
    ptSlider.addEventListener("input", () => {
      viewer.setOption("pointSize", Number(ptSlider.value));
    });
  }

  const resetBtn = document.getElementById("btnResetView");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => viewer.resetCamera());
  }

  select(0);
}

function initTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });
}

function initCopyBibtex() {
  const btn = document.getElementById("copyBibBtn");
  const code = document.getElementById("bibtexCode");
  if (!btn || !code) return;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 1800);
    } catch (_) {
      btn.textContent = "Copy failed";
      setTimeout(() => { btn.textContent = "Copy"; }, 1800);
    }
  });
}

initTeaser();
initInteractive3D();
initTabs();
initCopyBibtex();
