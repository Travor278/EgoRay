import json
import os
from pathlib import Path

import numpy as np

KEYS = ("ext", "intr", "tf", "hw", "depth", "stats", "canvas")


def write(out, order, k, buf, canvas):
    d = Path(out) / f"{order}_{canvas[0]}x{canvas[1]}_{k:05d}.npz"
    tmp = d.with_suffix(".tmp.npz")
    arrs = {n: np.stack([b[n] for b in buf]) for n in buf[0] if n not in ("pair", "stats")}
    np.savez_compressed(tmp, pair=np.array([b["pair"] for b in buf]), stats=np.array([b["stats"] for b in buf]), canvas=np.array(canvas), **arrs)
    os.replace(tmp, d)


def rows(pred_dir, orders=("xe", "ex"), allow_missing=False):
    for fx in sorted(p for p in Path(pred_dir).glob("xe_*.npz") if not p.name.endswith(".tmp.npz")):
        if allow_missing and not all(fx.with_name(o + fx.name[2:]).exists() for o in orders):
            continue
        recs = {}
        for o in orders:
            f = fx.with_name(o + fx.name[2:])
            if not f.exists():
                raise FileNotFoundError(f"missing prediction shard {f} (pass --allow-missing to score the others)")
            with np.load(f) as z:
                recs[o] = {k: z[k] for k in KEYS if k in z.files}
                p = [str(v) for v in z["pair"]]
            if o == "xe":
                pairs = p
            elif p != pairs:
                raise ValueError(f"{f} and {fx}: pair lists differ")
        for row, p in enumerate(pairs):
            yield tuple(p.split("|")), recs, row


def depth_stats(depth, regs):
    H, W = depth.shape
    out = {}
    for i, (ys, xs) in regs.items():
        ok = (ys >= 0) & (ys < H) & (xs >= 0) & (xs < W)
        ys, xs = ys[ok], xs[ok]
        if len(ys):
            v = depth[ys, xs]
            out[str(i)] = [int(len(v)), round(float(np.median(v)), 4)]
    return json.dumps(out, separators=(",", ":"))
