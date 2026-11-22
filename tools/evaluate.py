import argparse
import json
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray import config, store
from egoray import metrics as M
from egoray.data import image_regions, polygon_mask, proposal_regions, read_list, read_mask, read_proposals, read_queries
from egoray.geometry import angle, truth
from egoray.readout import fuse, rank_proposals, side


class Cache(OrderedDict):
    def get_or(self, k, make, n=64):
        if k not in self:
            if len(self) >= n:
                self.popitem(last=False)
            self[k] = make()
        return self[k]


def grouped(qdir, name, keys, skip=()):
    path, Q, found = Path(qdir) / f"{name}.jsonl.gz", defaultdict(list), set()
    for q in read_queries(path):
        if q["key"] in keys:
            found.add(q["key"])
            if q["state"] not in skip:
                Q[(q["exo"], q["ego"])].append(q)
    lost = sorted(keys - found)
    if lost:
        raise SystemExit(f"{path}: {len(lost)} listed keys have no query, e.g. {lost[0]}")
    return Q


def track_ac(name, a, keys):
    Q = grouped(a.queries, name, keys)
    regions, seen, recs = Cache(), set(), []
    for pair, rec, row in store.rows(Path(a.pred) / name, allow_missing=a.allow_missing):
        for q in Q.get(pair, ()):
            if q["key"] in seen:
                continue
            seen.add(q["key"])
            has = q.get("mask") or q.get("boxes") or q.get("polys")
            regs = regions.get_or(q.get("mask") or q["key"], lambda: image_regions(q, a.data_root) if has else {})
            c = q.get("cands") or []
            canvas = rec["xe"]["canvas"]
            f = fuse(side(rec["xe"], row, "xe", c, regs, canvas), side(rec["ex"], row, "ex", c, regs, canvas))
            r = dict(key=q["key"], set=q["set"], setting=M.setting_of(q), level=q.get("level", ""), category=q["category"])
            t = truth(q)
            if t is not None:
                e_x, e_g, _, dist = t
                r.update(ae_exo=np.nan if e_x is None else angle(f["ex"], e_x), ae_ego=np.nan if e_g is None else angle(f["eg"], e_g),
                         dist=np.nan if dist is None else dist)
            if q["state"] == "present" and len(c) >= 2 and q["wearer"] in c:
                r.update(hit=M.credit(f["score"], c.index(q["wearer"]))[0], n_cand=len(c), pick=c[int(np.argmin(f["score"]))])
            recs.append(r)
    complete(Q, seen, Path(a.pred) / name, a.allow_missing)
    return recs


def complete(Q, seen, where, allow):
    lost = sorted({q["key"] for qs in Q.values() for q in qs} - seen)
    if lost:
        msg = f"{where}: no prediction for {len(lost)} listed queries, e.g. {lost[0]}"
        if not allow:
            raise SystemExit(msg + " (pass --allow-missing to score the others)")
        print("warning:", msg, file=sys.stderr)


def iou(a, b):
    u = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / u) if u else 0.0


def track_b(name, a, keys):
    Q = grouped(a.queries, name, keys, skip=("ignore",))
    P = read_proposals(Path(a.proposals) / name)
    if not P:
        raise FileNotFoundError(f"no proposals in {Path(a.proposals) / name}")
    props, seen, lines = Cache(), set(), []
    for pair, rec, row in store.rows(Path(a.pred_b or a.pred) / name, orders=("xe",), allow_missing=a.allow_missing):
        for q in Q.get(pair, ()):
            if q["key"] in seen:
                continue
            seen.add(q["key"])
            if q["exo"] not in P:
                raise KeyError(f"no proposals for {q['exo']} in {Path(a.proposals) / name}")
            cand = props.get_or(q["exo"], lambda: proposal_regions(P[q["exo"]]), 8)
            wm = None
            if q["state"] == "present" and q.get("mask"):
                wm = read_mask(a.data_root, q["mask"]) == q["wearer"]
            elif q["state"] == "present" and q.get("polys") and q["polys"][q["wearer"]]:
                wm = polygon_mask(q["hw"], q["polys"][q["wearer"]])
            d = dict(key=q["key"], set=q["set"], setting=M.setting_of(q), level=q.get("level", ""), gt_tier=q.get("gt_tier"), state=q["state"], n=len(cand))
            if cand:
                near, s, behind = rank_proposals(rec["xe"], row, cand)
                j = int(np.argmin(s))
                ious = [iou(p[0], wm) for p in cand] if wm is not None else None
                d.update(near=round(float(near[j]), 3), behind=behind, iou=round(ious[j], 4) if ious else None, best=round(max(ious), 4) if ious else None)
            lines.append(d)
    complete(Q, seen, Path(a.pred_b or a.pred) / name, a.allow_missing)
    return lines


def rows_of(recs, fn):
    G = defaultdict(list)
    for r in recs:
        G[(r["set"], r["setting"], r["level"]) + ((r["gt_tier"],) if "gt_tier" in r else ())].append(r)
    out = []
    for k, L in sorted(G.items()):
        out.append(dict(set=k[0], setting=k[1], level=k[2], n=len(L), **({"gt_tier": k[3]} if len(k) > 3 else {}), **fn(L)))
    return out


def stats_ac(L, cfg):
    width = cfg["carrier_width"].get(str(L[0]["category"]).split(",")[0])
    return {**M.row_a(L), **M.row_c(L, width)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--lists", required=True)
    ap.add_argument("--split", default="gold")
    ap.add_argument("--pred", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sets", nargs="*")
    ap.add_argument("--config")
    ap.add_argument("--proposals")
    ap.add_argument("--pred-b")
    ap.add_argument("--theta", type=float)
    ap.add_argument("--dev-split", default="dev")
    ap.add_argument("--no-behind", action="store_true")
    ap.add_argument("--allow-missing", action="store_true")
    a = ap.parse_args()
    cfg = config.load(a.config)
    domain_of = config.domain_fn(cfg)
    suffix = f".{a.split}.txt"
    names = a.sets or sorted(p.name[:-len(suffix)] for p in Path(a.lists).glob(f"*{suffix}"))
    if not names:
        raise SystemExit(f"no {a.split} lists under {a.lists}")
    res = dict(split=a.split)
    recs = []

    def present(name, root):
        if (Path(root) / name).is_dir():
            return True
        msg = f"{name}: no predictions in {Path(root) / name}"
        if not a.allow_missing:
            raise SystemExit(msg + " (pass --allow-missing to score the others)")
        print("warning:", msg, file=sys.stderr)
        return False

    for name in names:
        f = Path(a.lists) / f"{name}{suffix}"
        if not f.exists():
            raise SystemExit(f"{name}: missing {f}")
        if present(name, a.pred):
            recs += track_ac(name, a, read_list(f))
    if not recs:
        raise SystemExit("no prediction was scored")
    rows = rows_of(recs, lambda L: stats_ac(L, cfg))
    res["rows"] = rows
    res["summary"] = M.summary(rows, domain_of, ("kappa", "acc", "ma5", "ma15", "ae_exo", "ble"), cfg["columns"], track_a=("kappa", "acc"))
    if a.proposals:
        theta = a.theta
        lines, dev = [], []
        for name in names:
            if present(name, a.pred_b or a.pred):
                lines += track_b(name, a, read_list(Path(a.lists) / f"{name}{suffix}"))
        if theta is None:
            if a.pred_b:
                raise SystemExit("--pred-b needs --theta (the starting model's threshold)")
            dsuf = f".{a.dev_split}.txt"
            for fd in sorted(Path(a.lists).glob(f"*{dsuf}")):
                name = fd.name[:-len(dsuf)]
                if present(name, a.pred):
                    dev += track_b(name, a, read_list(fd))
            G = defaultdict(list)
            for d in dev:
                G[(d["setting"], d["gt_tier"])].append(d)
            theta = M.choose_theta(list(G.values()), not a.no_behind)
        brows = rows_of(lines, lambda L: M.row_b(L, theta, not a.no_behind))
        res["track_b"] = dict(theta=theta, behind=not a.no_behind, rows=brows,
                              summary=M.summary([r for r in brows if r.get("gt_tier") in ("G1", "G2")], domain_of, ("giou20", "miou_p", "pr50", "va"), cfg["columns"]))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    json.dump(res, open(a.out, "w"), indent=1, default=float)
    pct = lambda x: "-" if x is None else f"{100 * x:.1f}"
    deg = lambda x: "-" if x is None else f"{x:.2f}"
    S = res["summary"]
    print("| | kappa-Acc | Acc | MA@5 | MA@15 | AE_exo | BLE |")
    print("|---|---|---|---|---|---|---|")
    for g in ("seen", "unseen"):
        print(f"| {g} | " + " | ".join([pct(S[m][g]) for m in ("kappa", "acc", "ma5", "ma15")] + [deg(S[m][g]) for m in ("ae_exo", "ble")]) + " |")
    if "track_b" in res:
        B = res["track_b"]["summary"]
        print(f"\ntheta* = {res['track_b']['theta']}")
        print("| | gIoU@20 | mIoU-P | Pr@0.5 | VA |")
        print("|---|---|---|---|---|")
        for g in ("seen", "unseen"):
            print(f"| {g} | " + " | ".join(pct(B[m][g]) for m in ("giou20", "miou_p", "pr50", "va")) + " |")

if __name__ == "__main__":
    main()
