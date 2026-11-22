import gzip
import json
from pathlib import Path

import numpy as np

NMAX, NPTS = 32, 96


def read_queries(path):
    with gzip.open(path, "rt") as f:
        for ln in f:
            yield json.loads(ln)


def read_list(path):
    return {k for k in Path(path).read_text().split("\n") if k}


def read_image(root, ref):
    from PIL import Image

    return np.asarray(Image.open(Path(root) / ref).convert("RGB"))


def read_mask(root, ref):
    from PIL import Image

    im = np.asarray(Image.open(Path(root) / ref))
    return im[..., 0] if im.ndim == 3 else im


def prep(ims, res=512, patch=16):
    import torch
    import torch.nn.functional as F
    from PIL import Image

    bicubic = getattr(Image, "Resampling", Image).BICUBIC
    tok = (res // patch) ** 2
    out, meta = [], []
    for im in ims:
        h, w = im.shape[:2]
        wp = np.sqrt(tok / (h / w))
        hp = tok / wp
        th, tw = max(1, int(np.round(hp))) * patch, max(1, int(np.round(wp))) * patch
        x = np.asarray(Image.fromarray(im).resize((tw, th), bicubic), np.float32) / 255
        out.append(torch.from_numpy(x).permute(2, 0, 1))
        meta.append([tw / w, th / h, 0, 0])
    H, W = max(t.shape[1] for t in out), max(t.shape[2] for t in out)
    for k, t in enumerate(out):
        ph, pw = H - t.shape[1], W - t.shape[2]
        pt, pl = ph // 2, pw // 2
        out[k] = F.pad(t, (pl, pw - pl, pt, ph - pt), value=1.0)
        meta[k][2], meta[k][3] = pl, pt
    return torch.stack(out), meta


def fill_polygon(img, poly):
    import cv2

    p = np.asarray(poly, np.int32).reshape(-1, 2)
    if len(p) < 3 or cv2.isContourConvex(p.reshape(-1, 1, 2)):
        cv2.fillConvexPoly(img, p, 1)
    else:
        cv2.fillPoly(img, [p], 1)
    return img


def polygon_mask(hw, poly):
    return fill_polygon(np.zeros(hw, np.uint8), poly).astype(bool)


def split_label(lab, off_y, off_x):
    ys, xs = np.nonzero(lab)
    ids = lab[ys, xs]
    o = np.argsort(ids, kind="stable")
    ys, xs, ids = ys[o] + off_y, xs[o] + off_x, ids[o]
    u, start = np.unique(ids, return_index=True)
    return {int(i): (ys[a:b].astype(np.int32), xs[a:b].astype(np.int32)) for i, a, b in zip(u, start, np.r_[start[1:], len(ids)])}


def canvas_regions(q, root, meta):
    import cv2

    sx, sy, pl, pt = meta
    pl, pt = int(pl), int(pt)
    size = lambda h, w: (max(1, int(round(w * sx))), max(1, int(round(h * sy))))
    if q.get("mask"):
        m = read_mask(root, q["mask"])
        return split_label(cv2.resize(m, size(*m.shape), interpolation=cv2.INTER_NEAREST), pt, pl)
    out = {}
    if q.get("polys"):
        h, w = q["hw"]
        for i, poly in enumerate(q["polys"]):
            if poly:
                r = fill_polygon(np.zeros((h, w), np.uint8), poly)
                r = cv2.resize(r, size(h, w), interpolation=cv2.INTER_NEAREST)
                ys, xs = np.nonzero(r)
                out[i] = ((ys + pt).astype(np.int32), (xs + pl).astype(np.int32))
    for i, (x0, y0, x1, y1) in enumerate(q.get("boxes") or ()):
        xs, ys = np.meshgrid(np.arange(int(x0 * sx) + pl, int(x1 * sx) + pl + 1), np.arange(int(y0 * sy) + pt, int(y1 * sy) + pt + 1))
        out[i] = (ys.ravel().astype(np.int32), xs.ravel().astype(np.int32))
    return out


def image_regions(q, root):
    out = {}
    if q.get("mask"):
        im = read_mask(root, q["mask"])
        ys, xs = np.nonzero(im)
        lab = im[ys, xs]
        o = np.argsort(lab, kind="stable")
        ys, xs, lab = ys[o], xs[o], lab[o]
        ids, start = np.unique(lab, return_index=True)
        for i, a, b in zip(ids, start, np.r_[start[1:], len(lab)]):
            p = np.stack([xs[a:b], ys[a:b]], 1).astype(np.float32)
            out[int(i)] = (p, p)
    elif q.get("polys"):
        for i, poly in enumerate(q["polys"]):
            if poly:
                ys, xs = np.nonzero(polygon_mask(q["hw"], poly))
                if len(xs):
                    p = np.stack([xs, ys], 1).astype(np.float32)
                    out[i] = (p, p)
    else:
        for i, (x0, y0, x1, y1) in enumerate(q.get("boxes") or ()):
            fx, fy = np.meshgrid(np.arange(int(x0), int(x1) + 1), np.arange(int(y0), int(y1) + 1))
            gx, gy = np.meshgrid(np.arange(int(x0), int(x1) + 1, max(1, int((x1 - x0) // 40))), np.arange(int(y0), int(y1) + 1, max(1, int((y1 - y0) // 40))))
            out[i] = (np.stack([fx.ravel(), fy.ravel()], 1).astype(np.float32), np.stack([gx.ravel(), gy.ravel()], 1).astype(np.float32))
    return out


def proposal_regions(rec):
    from pycocotools import mask as mask_util

    out = []
    for m in (rec or {}).get("masks", ()):
        b = mask_util.decode(dict(size=rec["hw"], counts=m["rle"].encode())).astype(bool)
        ys, xs = np.nonzero(b)
        if len(xs):
            out.append((b, np.stack([xs, ys], 1).astype(np.float32), m["score"]))
    return out


def proposal_canvas_regions(rec, meta, nmax=NMAX):
    import cv2
    from pycocotools import mask as mask_util

    sx, sy, pl, pt = meta
    out = {}
    for i, m in enumerate(sorted(rec["masks"], key=lambda m: -m["score"])[:nmax]):
        b = mask_util.decode(dict(size=rec["hw"], counts=m["rle"].encode()))
        b = cv2.resize(b, (max(1, int(round(b.shape[1] * sx))), max(1, int(round(b.shape[0] * sy)))), interpolation=cv2.INTER_NEAREST)
        ys, xs = np.nonzero(b)
        if len(xs):
            out[i] = ((ys + int(pt)).astype(np.int32), (xs + int(pl)).astype(np.int32))
    return out


def read_proposals(path):
    out = {}
    for f in sorted(Path(path).glob("*.jsonl.gz")):
        with gzip.open(f, "rt") as h:
            for ln in h:
                r = json.loads(ln)
                out[r["exo"]] = r
    return out


def sample_candidates(regs, c, nmax=NMAX, npts=NPTS):
    pts, pv, up = np.zeros((nmax, npts, 2), np.float32), np.zeros((nmax, npts), bool), np.zeros((nmax, 2), np.float32)
    for n, k in enumerate(c[:nmax]):
        ys, xs = regs[k]
        top = ys <= np.percentile(ys, 33)
        up[n] = xs[top].mean(), ys[top].mean()
        s = np.random.choice(len(xs), min(npts, len(xs)), replace=False)
        pts[n, :len(s)] = np.stack([xs[s], ys[s]], 1)
        pv[n, :len(s)] = True
    return pts, pv, up


def exact_focal(q, view, meta):
    K, lens = q.get(f"K_{view}"), q.get(f"lens_{view}") or {}
    if q.get("pose_tier") != "P0" or not K or lens.get("model", "PINHOLE") != "PINHOLE":
        return None
    return np.array([K[0][0] * meta[0], K[1][1] * meta[1]], np.float64)
