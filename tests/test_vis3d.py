import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray import vis3d


def _synthetic_scene():
    H, W = 128, 160
    x = np.zeros((2, 3, H, W), np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    x[0, 0] = xx / W
    x[0, 1] = yy / H
    x[0, 2] = 0.45
    x[1, 0] = 0.3
    x[1, 1] = xx / W
    x[1, 2] = yy / H
    K = np.array([[140.0, 0.0, W / 2], [0.0, 140.0, H / 2], [0.0, 0.0, 1.0]])
    c30, s30 = np.cos(np.radians(30.0)), np.sin(np.radians(30.0))
    R1 = np.array([[c30, 0.0, -s30], [0.0, 1.0, 0.0], [s30, 0.0, c30]])
    c1 = np.array([0.8, 0.0, 3.2])
    t1 = -(R1 @ c1)
    ext = np.stack([np.c_[np.eye(3), np.zeros(3)], np.c_[R1, t1]], 0)
    intr = np.stack([K, K], 0)
    dep = np.full((2, H, W), 3.5, np.float32)
    dep[0, 40:95, 95:125] = 3.1
    dep[0, 40:95, 35:65] = 3.6
    conf = np.ones((2, H, W), np.float32)
    geo = dict(ext=ext, intr=intr, depth=dep, conf=conf)
    meta = [[1.0, 1.0, 0.0, 0.0], [1.0, 1.0, 0.0, 0.0]]
    hw = [(H, W), (H, W)]
    ys1, xs1 = np.mgrid[40:95, 95:125]
    ys2, xs2 = np.mgrid[40:95, 35:65]
    regs_c = {1: (ys1.ravel().astype(np.int32), xs1.ravel().astype(np.int32)),
              2: (ys2.ravel().astype(np.int32), xs2.ravel().astype(np.int32))}
    regs = {1: (np.stack([xs1.ravel(), ys1.ravel()], 1).astype(np.float32), None),
            2: (np.stack([xs2.ravel(), ys2.ravel()], 1).astype(np.float32), None)}
    exo = (x[0].transpose(1, 2, 0) * 255).astype(np.uint8)
    ego = (x[1].transpose(1, 2, 0) * 255).astype(np.uint8)
    return x, meta, hw, geo, regs_c, regs, exo, ego


def test_depth_edge():
    d = np.full((32, 32), 2.0, np.float32)
    d[:, 16:] = 4.0
    e = vis3d.depth_edge(d, rtol=0.05)
    assert e[:, 15].all() and e[:, 16].all() and not e[:, 5].any() and not e[:, 25].any()


def test_unproject_and_animation():
    x, meta, hw, geo, regs_c, regs, exo, ego = _synthetic_scene()
    sc = vis3d.unproject_scene(x, meta, hw, geo, regs_c, [1, 2], wearer=1, conf_thres=10.0, max_points=12000)
    assert len(sc["pts"]) > 1000 and len(sc["pts"]) <= 12000
    assert np.allclose(sc["c_ego"], [0.8, 0.0, 3.2], atol=1e-4)
    assert (sc["cand"] == 1).sum() > 100 and (sc["cand"] == 2).sum() > 100
    cols = vis3d.colorize_points(sc["rgb"], sc["cand"], 1, strength=1.0)
    assert cols.shape == sc["rgb"].shape and cols.dtype == np.uint8
    q = dict(cands=[1, 2])
    scores = dict(angle=np.array([0.8, 22.4]), score=np.array([0.12, 1.45]))
    with tempfile.TemporaryDirectory() as td:
        gif = Path(td) / "demo.gif"
        still = Path(td) / "still.png"
        vis3d.render_animation(sc, exo, ego, q, regs, scores, np.array([110.0, 66.0]), np.array([45.0, 64.0]),
                               gif, width=640, height=320, frames=12, fps=12, ss=1.0, still_path=still)
        assert gif.exists() and gif.stat().st_size > 1000
        assert still.exists() and Image.open(still).size == (640, 320)
        try:
            import trimesh
        except ImportError:
            trimesh = None
        if trimesh is not None:
            glb = Path(td) / "scene.glb"
            vis3d.build_glb(sc, glb)
            assert glb.exists() and glb.stat().st_size > 1000


if __name__ == "__main__":
    for name, f in list(globals().items()):
        if name.startswith("test_"):
            f()
            print(name, "ok")
