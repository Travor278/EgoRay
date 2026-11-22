import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray import config, geometry, metrics, readout

RNG = np.random.default_rng(0)


def rotation():
    q, r = np.linalg.qr(RNG.normal(size=(3, 3)))
    q = q * np.sign(np.diag(r))
    return q * np.linalg.det(q)


def test_epipoles():
    for _ in range(100):
        a, b = np.c_[rotation(), RNG.normal(size=3)], np.c_[rotation(), RNG.normal(size=3)]
        cx, cg, R = geometry.relative(a, b)
        assert np.allclose(geometry.unit(cg), -R @ geometry.unit(cx))
        assert np.isclose(np.linalg.norm(cx), np.linalg.norm(cg))


def test_score_matches_definition():
    K = np.array([[400.0, 0, 320], [0, 400, 240], [0, 0, 1]])
    t = np.array([1.0, 1.0, 0.0, 0.0])
    for _ in range(100):
        pts = RNG.uniform(0, 640, (50, 2)).astype(np.float32)
        c, z, alpha = RNG.normal(size=3) * 2, float(RNG.uniform(0.5, 8)), 3.0
        r = geometry.rays(pts, K, t)
        phi = np.arccos(np.clip(r @ geometry.unit(c) / np.linalg.norm(r, axis=1), -1, 1))
        d = np.linalg.norm(r * z - c, axis=1)
        ref = np.min(d + alpha * np.linalg.norm(c) * np.sin(np.minimum(phi, np.pi / 2)))
        assert np.isclose(readout.score(pts, K, t, c, z, alpha), ref, rtol=1e-10)


def test_front():
    c, d = np.array([0.3, -0.2, -2.0]), np.array([0.3, -0.2, 2.0])
    assert np.allclose(geometry.front(c), d) and np.allclose(geometry.front(d), d)


def test_credit_ties():
    assert metrics.credit([1.0, 1.0, 2.0], 0)[0] == 0.5
    assert metrics.credit([0.5, 1.0, 2.0], 0)[0] == 1.0
    assert metrics.credit([0.5, 1.0, 2.0], 2)[0] == 0.0
    assert np.isclose(metrics.kappa(0.75, 0.5), 0.5)


def test_presence():
    lines = [dict(state="present", near=4.0, iou=0.8, behind=False), dict(state="present", near=30.0, iou=0.9, behind=False),
             dict(state="absent", near=50.0, behind=False), dict(state="absent", near=2.0, behind=True)]
    iou, tp, tn = metrics.answers(lines, 12)
    assert list(iou) == [0.8, 0.0] and list(tp) == [1.0, 0.0] and list(tn) == [1.0, 1.0]
    r = metrics.row_b(lines, 12)
    assert np.isclose(r["miou_p"], 0.4) and np.isclose(r["va"], 0.75) and np.isclose(r["giou20"], 0.8 * 0.4 + 0.2)


def test_domains():
    dom = config.domain_fn(config.load())
    assert dom("people_v1") == "indoor" and dom("perch_v2") == "birds" and dom("tf2023_test") == "real" and dom("miluv") is None


def test_polygon_fill():
    import cv2

    from egoray.data import fill_polygon

    for _ in range(50):
        hull = cv2.convexHull(RNG.integers(0, 120, size=(12, 2)).astype(np.int32))[:, 0]
        a = fill_polygon(np.zeros((128, 128), np.uint8), hull.tolist())
        b = cv2.fillConvexPoly(np.zeros((128, 128), np.uint8), hull, 1)
        assert np.array_equal(a, b)
    m = fill_polygon(np.zeros((100, 100), np.uint8), [[10, 10], [60, 10], [60, 30], [30, 30], [30, 80], [10, 80]])
    assert m[50, 20] == 1 and m[50, 50] == 0 and m[20, 50] == 1


if __name__ == "__main__":
    for name, f in list(globals().items()):
        if name.startswith("test_"):
            f()
            print(name, "ok")
