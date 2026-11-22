from collections import defaultdict

import numpy as np

SEEN, UNSEEN = ("L0", "L1"), ("L2", "L3")
GROUPS = (("seen", SEEN), ("unseen", UNSEEN), ("L0", ("L0",)), ("L1", ("L1",)), ("L2", ("L2",)), ("L3", ("L3",)))
MIN_CHOICE = 30
THETAS = (1, 2, 3, 5, 8, 12, 20, 30, 45, 90, 181)


def credit(v, w):
    a = np.asarray(v, float)
    tie = np.isclose(a, a[w], rtol=0, atol=1e-6) if np.isfinite(a[w]) else ~np.isfinite(a)
    better = int(((a < a[w]) & ~tie).sum())
    places = better + 1 + np.arange(int(tie.sum()))
    return float(better == 0) / len(places), float((1 / places).mean()), float((places <= 2).mean())


def kappa(acc, chance):
    return (acc - chance) / max(1 - chance, 1e-9)


def setting_of(q):
    s = f"{q['set']}/{q['exo_kind']}"
    return f"{s}/{q['modality']}" if q.get("modality") else s


def row_a(recs):
    a = [r for r in recs if r.get("hit") is not None]
    if not a:
        return {}
    acc = float(np.mean([r["hit"] for r in a]))
    chance = float(np.mean([1 / r["n_cand"] for r in a]))
    return dict(track_a=len(a), acc=acc, chance=chance, kappa=kappa(acc, chance))


def row_c(recs, width=None):
    ax = np.array([r.get("ae_exo", np.nan) for r in recs], float)
    ag = np.array([r.get("ae_ego", np.nan) for r in recs], float)
    out = {}
    if np.isfinite(ag).any():
        out["ae_ego"] = round(float(np.nanmedian(ag)), 2)
    if np.isfinite(ax).any():
        out["ae_exo"] = round(float(np.nanmedian(ax)), 2)
        m = np.maximum(ax, ag)
        for tau in (5, 15):
            out[f"ma{tau}"] = float((m[np.isfinite(m)] < tau).mean())
        lat = np.array([r.get("dist", np.nan) for r in recs], float) * np.sin(np.radians(np.minimum(ax, 90)))
        if width and np.isfinite(lat).any():
            out["ble"] = round(float(np.nanmedian(lat)) / width, 2)
    return out


def answers(lines, theta, behind_rule=True):
    iou, tp, tn = [], [], []
    for d in lines:
        said = d.get("near") is not None and d["near"] <= theta and not (behind_rule and d.get("behind"))
        if d["state"] == "present":
            tp.append(float(said))
            if d.get("near") is None or d.get("iou") is not None:
                iou.append(d["iou"] if said else 0.0)
        else:
            tn.append(float(not said))
    return np.array(iou), np.array(tp), np.array(tn)


def row_b(lines, theta, behind_rule=True):
    iou, tp, tn = answers(lines, theta, behind_rule)
    out = {}
    nacc = float(tn.mean()) if len(tn) else None
    if len(iou):
        out["miou_p"] = float(iou.mean())
        out["pr50"] = float((iou > 0.5).mean())
        if nacc is not None:
            out["giou20"] = 0.8 * out["miou_p"] + 0.2 * nacc
    if nacc is not None and len(tp):
        out["va"] = (nacc + float(tp.mean())) / 2
    return out


def choose_theta(dev_rows, behind_rule=True):
    best, arg = -1, 181
    for th in THETAS:
        va = []
        for L in dev_rows:
            _, tp, tn = answers(L, th, behind_rule)
            if len(tp) and len(tn):
                va.append((tp.mean() + tn.mean()) / 2)
        if va and np.mean(va) > best:
            best, arg = float(np.mean(va)), th
    if best < 0:
        raise ValueError("cannot choose theta: no development setting has both present and absent predictions; pass --theta")
    return arg


def by_domain(rows, domain_of, metric, levels, track_a=False):
    D = defaultdict(list)
    for r in rows:
        d = domain_of(r["set"])
        if d is None or r["level"] not in levels or r.get(metric) is None or "rgb_rgb" in r["setting"]:
            continue
        if track_a and r.get("track_a", 0) < MIN_CHOICE:
            continue
        D[d].append(r[metric])
    return D


def macro(rows, domain_of, metric, levels, track_a=False):
    D = by_domain(rows, domain_of, metric, levels, track_a)
    return float(np.mean([np.mean(v) for v in D.values()])) if D else None


def column(rows, domain_of, metric, domain, levels, track_a=False):
    v = by_domain(rows, domain_of, metric, levels, track_a).get(domain)
    return float(np.mean(v)) if v else None


def summary(rows, domain_of, metrics, columns, track_a=()):
    out = {}
    for m in metrics:
        a = m in track_a
        out[m] = {g: macro(rows, domain_of, m, lv, a) for g, lv in GROUPS}
        out[m]["columns"] = [column(rows, domain_of, m, dom, lv, a) for _, dom, lv in columns]
    return out
