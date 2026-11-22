import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray import store
from egoray.data import canvas_regions, image_regions, prep, read_image, read_mask
from egoray.geometry import front, project, to_image
from egoray.model import Predictor
from egoray.readout import fuse, pose, side


def records(pred, x, meta, hw, regs, stride=4):
    out = {}
    for order, (ext, intr, d) in pred.items():
        out[order] = dict(ext=ext.cpu().numpy(), intr=intr.cpu().numpy(), tf=np.array([meta if order == "xe" else meta[::-1]], np.float32),
                          hw=np.array([hw if order == "xe" else hw[::-1]]), depth=d[:, ::stride, ::stride].half().cpu().numpy(),
                          stats=np.array([store.depth_stats(d[0].cpu().numpy(), regs)]), canvas=np.array(x.shape[-2:]))
    return out


def draw(exo, ego, q, regs, wearer, uv_exo, uv_ego):
    over = exo.astype(np.float32).copy()
    H, W = over.shape[:2]
    for i in q["cands"]:
        if i not in regs:
            continue
        p = regs[i][0].astype(int)
        p = p[(p[:, 0] >= 0) & (p[:, 0] < W) & (p[:, 1] >= 0) & (p[:, 1] < H)]
        col = np.array([60, 200, 90] if i == wearer else [230, 70, 60], np.float32)
        over[p[:, 1], p[:, 0]] = 0.55 * over[p[:, 1], p[:, 0]] + 0.45 * col
    a = Image.fromarray(over.clip(0, 255).astype(np.uint8))
    b = Image.fromarray(ego)
    b = b.resize((max(1, round(b.width * a.height / b.height)), a.height))
    s = max(4, a.height // 60)
    for im, uv, col, k in ((a, uv_exo, (255, 200, 0), (1.0, 1.0)), (b, uv_ego, (0, 160, 255), (b.width / ego.shape[1], b.height / ego.shape[0]))):
        g = ImageDraw.Draw(im)
        u, v = uv[0] * k[0], uv[1] * k[1]
        g.line([(u - s, v - s), (u + s, v + s)], fill=col, width=max(2, s // 2))
        g.line([(u - s, v + s), (u + s, v - s)], fill=col, width=max(2, s // 2))
    out = Image.new("RGB", (a.width + b.width, a.height), "white")
    out.paste(a, (0, 0))
    out.paste(b, (a.width, 0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exo", required=True)
    ap.add_argument("--ego", required=True)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--mask")
    src.add_argument("--boxes")
    ap.add_argument("--cands", nargs="*", type=int)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--adapter")
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--out", default="demo.png")
    a = ap.parse_args()
    exo, ego = read_image(".", a.exo), read_image(".", a.ego)
    if a.mask:
        ids = sorted(int(i) for i in np.unique(read_mask(".", a.mask)) if i)
        q = dict(mask=a.mask, cands=a.cands or ids)
    else:
        with open(a.boxes) as f:
            boxes = json.load(f)
        q = dict(boxes=boxes, cands=a.cands or list(range(len(boxes))))
    regs = image_regions(q, ".")
    if not q["cands"]:
        ap.error("no candidates: give a mask with nonzero ids or a non-empty box list")
    lost = [i for i in q["cands"] if i not in regs or not len(regs[i][0])]
    if lost:
        ap.error(f"candidates without pixels: {lost}")
    x, meta = prep([exo, ego])
    regs_c = canvas_regions(q, ".", meta[0])
    rec = records(Predictor(a.ckpt, a.adapter, a.rank)(x[None]), x, meta, [exo.shape[:2], ego.shape[:2]], regs_c)
    canvas = rec["xe"]["canvas"]
    f = fuse(side(rec["xe"], 0, "xe", q["cands"], regs, canvas), side(rec["ex"], 0, "ex", q["cands"], regs, canvas))
    wearer = q["cands"][int(np.argmin(f["score"]))]
    g = pose(rec["xe"], 0, "xe")
    uv_exo = to_image(project(front(f["ex"]), g["K"]), g["t"])
    uv_ego = to_image(project(f["eg"], g["K_ego"]), g["t_ego"])
    draw(exo, ego, q, regs, wearer, uv_exo, uv_ego).save(a.out)
    print(json.dumps(dict(wearer=wearer, candidates={str(i): dict(angular_offset=round(float(t), 2), score=round(float(s), 4)) for i, t, s in zip(q["cands"], f["angle"], f["score"])},
                          ego_in_exo=np.round(uv_exo, 1).tolist(), exo_in_ego=np.round(uv_ego, 1).tolist(), behind=bool(np.dot(f["ex"], [0, 0, 1]) < 0)), indent=1))


if __name__ == "__main__":
    main()
