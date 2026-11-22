import numpy as np


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def angle(a, b):
    return float(np.degrees(np.arccos(np.clip(unit(a) @ unit(b), -1, 1))))


def rot_angle(Ra, Rb):
    M = np.asarray(Ra, float) @ np.asarray(Rb, float).T
    return float(np.degrees(np.arccos(np.clip((np.trace(M) - 1) / 2, -1, 1))))


def centre(w):
    w = np.asarray(w, float)
    return -w[:3, :3].T @ w[:3, 3]


def relative(w_exo, w_ego):
    we, wg = np.asarray(w_exo, float), np.asarray(w_ego, float)
    c_x = we[:3, :3] @ centre(wg) + we[:3, 3]
    c_g = wg[:3, :3] @ centre(we) + wg[:3, 3]
    return c_x, c_g, wg[:3, :3] @ we[:3, :3].T


def by_order(ext, order):
    return (ext[0], ext[1]) if order == "xe" else (ext[1], ext[0])


def front(c):
    return c * np.array([1, 1, -1.0]) if c[2] < 0 else c


def rays(uv, K, tf):
    c = uv * tf[:2] + tf[2:]
    return np.c_[(c[:, 0] - K[0, 2]) / K[0, 0], (c[:, 1] - K[1, 2]) / K[1, 1], np.ones(len(c))]


def project(c, K):
    p = np.asarray(K, float) @ np.asarray(c, float)
    return p[:2] / (p[2] if abs(p[2]) > 1e-9 else 1e-9)


def to_image(uv, tf):
    return (np.asarray(uv, float) - tf[2:]) / tf[:2]


def mean_rotation(a, b):
    m = np.asarray(a, float) + np.asarray(b, float)
    if not np.isfinite(m).all():
        return np.full((3, 3), np.nan)
    u, _, vt = np.linalg.svd(m)
    return u @ np.diag([1, 1, np.linalg.det(u @ vt)]) @ vt


def truth(q):
    if not q.get("w2c_exo") or not q.get("w2c_ego") or not q.get("pose_tier"):
        return (None, unit(q["eg_gt"]), None, None) if q.get("eg_gt") else None
    we, wg = np.array(q["w2c_exo"], float)[:3], np.array(q["w2c_ego"], float)[:3]
    we = we / np.cbrt(np.linalg.det(we[:3, :3]))
    wg = wg / np.cbrt(np.linalg.det(wg[:3, :3]))
    c_x, c_g, R = relative(we, wg)
    return unit(c_x), unit(c_g), R, float(np.linalg.norm(c_x))
