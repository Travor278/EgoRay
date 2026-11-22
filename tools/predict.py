import argparse
import collections
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray import store
from egoray.data import canvas_regions, prep, read_image, read_list, read_queries
from egoray.model import Predictor


class Pairs(Dataset):
    def __init__(self, pairs, regions, root, res):
        self.pairs, self.regions, self.root, self.res = pairs, regions, root, res

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, i):
        exo, ego = self.pairs[i]
        try:
            ims = [read_image(self.root, exo), read_image(self.root, ego)]
            x, meta = prep(ims, self.res)
            regs = canvas_regions(self.regions[(exo, ego)], self.root, meta[0])
        except Exception as e:
            return dict(i=i, err=repr(e))
        return dict(i=i, x=x, meta=np.array(meta, np.float32), hw=np.array([im.shape[:2] for im in ims], np.int32), regs=regs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--adapter")
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--keys")
    ap.add_argument("--states", nargs="+", default=["present", "absent", "ignore"])
    ap.add_argument("--bs", type=int, default=8)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--shard-size", type=int, default=2000)
    ap.add_argument("--depth-stride", type=int, default=4)
    ap.add_argument("--res", type=int, default=512)
    a = ap.parse_args()
    keep = read_list(a.keys) if a.keys else None
    regions = {}
    for q in read_queries(a.queries):
        if q["state"] in a.states and (keep is None or q["key"] in keep):
            regions.setdefault((q["exo"], q["ego"]), dict(mask=q.get("mask"), boxes=q.get("boxes"), polys=q.get("polys"), hw=q.get("hw")))
    pairs = sorted(regions)
    out = Path(a.out) / Path(a.queries).name.split(".")[0]
    out.mkdir(parents=True, exist_ok=True)
    if any(out.glob("*.npz")):
        raise SystemExit(f"{out} already holds predictions: use an empty --out")
    model = Predictor(a.ckpt, a.adapter, a.rank)
    dl = DataLoader(Pairs(pairs, regions, a.data_root, a.res), batch_size=1, num_workers=a.workers, collate_fn=lambda b: b[0], prefetch_factor=4 if a.workers else None)
    buckets, bufs = collections.defaultdict(list), collections.defaultdict(lambda: {"xe": [], "ex": []})
    count, seen, bad, t0 = collections.Counter(), 0, [], time.time()

    def flush(canvas):
        for o in ("xe", "ex"):
            store.write(out, o, count[canvas], bufs[canvas][o], canvas)
        count[canvas] += 1
        bufs[canvas] = {"xe": [], "ex": []}

    def run(canvas, batch):
        nonlocal seen
        pred = model(torch.stack([b["x"] for b in batch]))
        for order, (ext, intr, d) in pred.items():
            sub = d[:, ::a.depth_stride, ::a.depth_stride].half().cpu().numpy()
            full = d.cpu().numpy()
            ext, intr = ext.cpu().numpy(), intr.cpu().numpy()
            for j, b in enumerate(batch):
                bufs[canvas][order].append(dict(pair="|".join(pairs[b["i"]]), ext=ext[j], intr=intr[j], tf=b["meta"] if order == "xe" else b["meta"][::-1],
                                                  hw=b["hw"] if order == "xe" else b["hw"][::-1], depth=sub[j], stats=store.depth_stats(full[j], b["regs"])))
        seen += len(batch)
        if len(bufs[canvas]["xe"]) >= a.shard_size:
            flush(canvas)

    for s in dl:
        if "err" in s:
            bad.append(f"{pairs[s['i']]}: {s['err']}")
            continue
        canvas = tuple(s["x"].shape[-2:])
        buckets[canvas].append(s)
        if len(buckets[canvas]) >= a.bs:
            run(canvas, buckets.pop(canvas))
    for canvas, batch in list(buckets.items()):
        run(canvas, batch)
    for canvas in list(bufs):
        if bufs[canvas]["xe"]:
            flush(canvas)
    print(out.name, "pairs", seen, "unreadable", len(bad), f"{time.time() - t0:.0f} s", flush=True)
    for e in bad[:5]:
        print("unreadable:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
