import json

import numpy as np

from .geometry import by_order, front, mean_rotation, project, rays, relative, to_image, unit

ALPHA = 3.0
N_ANGLE = 3000
N_PROPOSAL = 1500


def sampled(pts, n):
    return pts[np.linspace(0, len(pts) - 1, n).astype(int)] if len(pts) > n else pts


def offset(pts, K, t, e):
    v = rays(pts, K, t)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    return float(np.degrees(np.arccos(np.clip((v @ e).max(), -1, 1))))


def score(pts, K, t, c, z, alpha=ALPHA):
    p = pts.astype(np.float64)
    x = (p[:, 0] * t[0] + t[2] - K[0, 2]) / K[0, 0]
    y = (p[:, 1] * t[1] + t[3] - K[1, 2]) / K[1, 1]
    rn = np.sqrt(x * x + y * y + 1.0)
    e = unit(c)
    dot = np.clip((x * e[0] + y * e[1] + e[2]) / rn, -1, 1)
    perp = np.linalg.norm(c) * np.sqrt(1 - np.maximum(dot, 0) ** 2)
    dx, dy, dz = x * z - c[0], y * z - c[1], z - c[2]
    return float(np.min(np.sqrt(dx * dx + dy * dy + dz * dz) + alpha * perp))


def depth_median(dep, pts, t, canvas):
    h, w = dep.shape
    H, W = canvas
    c = pts * t[:2] + t[2:]
    return float(np.median(dep[np.clip((c[:, 1] * h / H).astype(int), 0, h - 1), np.clip((c[:, 0] * w / W).astype(int), 0, w - 1)]))


def pose(rec, row, order):
    i = 0 if order == "xe" else 1
    c_x, c_g, R = relative(*by_order(rec["ext"][row].astype(float), order))
    K, t = rec["intr"][row].astype(float), rec["tf"][row].astype(float)
    return dict(c_x=c_x, c_g=c_g, R=R, K=K[i], t=t[i], K_ego=K[1 - i], t_ego=t[1 - i])


def side(rec, row, order, cands, regs, canvas):
    g = pose(rec, row, order)
    cf = front(g["c_x"])
    ef = unit(cf)
    stats = json.loads(str(rec["stats"][row])) if "stats" in rec else {}
    dep = rec["depth"][row].astype(np.float32)
    ang, sc = [], []
    for i in cands:
        r = regs.get(i)
        if r is None:
            ang.append(None)
            sc.append(None)
            continue
        full, coarse = r
        pts = sampled(coarse, N_ANGLE)
        ang.append(round(offset(pts, g["K"], g["t"], ef), 3))
        z = stats[str(i)][1] if str(i) in stats else round(depth_median(dep, pts, g["t"], canvas), 3)
        sc.append(round(score(full, g["K"], g["t"], cf, z), 3))
    return dict(ex=np.round(unit(g["c_x"]), 5).tolist(), eg=np.round(unit(g["c_g"]), 5).tolist(), R=np.round(g["R"], 5).tolist(),
                dist=round(float(np.linalg.norm(g["c_x"])), 4), zc=float(g["c_x"][2]), angle=ang, score=sc)


def fuse(a, b):
    arr = lambda L: np.array([np.inf if x is None else x for x in L], float)
    sa, sb = max(a["dist"], 1e-6), max(b["dist"], 1e-6)
    return dict(score=(arr(a["score"]) / sa + arr(b["score"]) / sb) / 2, angle=(arr(a["angle"]) + arr(b["angle"])) / 2,
                ex=unit(np.add(a["ex"], b["ex"])), eg=unit(np.add(a["eg"], b["eg"])), R=mean_rotation(a["R"], b["R"]))


def epipoles(rec, row, order):
    g = pose(rec, row, order)
    return to_image(project(front(g["c_x"]), g["K"]), g["t"]), to_image(project(g["c_g"], g["K_ego"]), g["t_ego"])


def rank_proposals(rec, row, props):
    g = pose(rec, row, "xe")
    cf = front(g["c_x"])
    e = unit(cf)
    dep = rec["depth"][row].astype(np.float32)
    near, sc = [], []
    for _, full, _ in props:
        pts = sampled(full, N_PROPOSAL)
        near.append(offset(pts, g["K"], g["t"], e))
        sc.append(score(full, g["K"], g["t"], cf, depth_median(dep, pts, g["t"], rec["canvas"])))
    return np.array(near), np.array(sc), bool(g["c_x"][2] < 0)


def presence(near, theta, behind):
    return near is not None and near <= theta and not behind
