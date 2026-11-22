import argparse
import json
import random
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray.data import canvas_regions, prep, proposal_canvas_regions, read_image, read_list, read_proposals, read_queries, sample_candidates
from egoray.lora import lora_state
from egoray.losses import anchor, candidate
from egoray.model import EgoRayNet


class Unlabelled(Dataset):
    def __init__(self, qs, seq, root, props=None):
        self.qs, self.seq, self.root, self.props = qs, seq, root, props

    def __len__(self):
        return len(self.seq)

    def __getitem__(self, i):
        q = self.qs[int(self.seq[i])]
        try:
            x, meta = prep([read_image(self.root, q["exo"]), read_image(self.root, q["ego"])])
            regs = proposal_canvas_regions(self.props[q["exo"]], meta[0]) if self.props is not None else canvas_regions(q, self.root, meta[0])
        except Exception as e:
            warnings.warn(f"skipping query {q['key']}: {e!r}", RuntimeWarning)
            return None
        c = list(regs) if self.props is not None else [k for k in q["cands"] if k in regs and len(regs[k][0])]
        if len(c) < 2:
            return None
        random.shuffle(c)
        pts, pv, up = sample_candidates(regs, c)
        return dict(x=x, pts=pts, pv=pv, up=up)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--lists", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--set", required=True)
    ap.add_argument("--split", default="gold")
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--adapter")
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int)
    ap.add_argument("--bs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--proposals")
    ap.add_argument("--states", nargs="+")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    if a.steps is None:
        a.steps = 200 if a.adapter else 800
    if a.steps <= 0 or a.bs <= 0:
        ap.error("--steps and --bs must be positive")
    random.seed(a.seed), np.random.seed(a.seed), torch.manual_seed(a.seed)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    keep = read_list(Path(a.lists) / f"{a.set}.{a.split}.txt")
    queries = Path(a.queries) / f"{a.set}.jsonl.gz"
    props = read_proposals(Path(a.proposals) / a.set) if a.proposals else None
    if props is not None and not props:
        raise SystemExit(f"no proposals in {Path(a.proposals) / a.set}")
    states = a.states or (["present", "absent"] if props is not None else ["present"])
    if props is not None:
        qs = [q for q in read_queries(queries) if q["key"] in keep and q["state"] in states]
        lost = sorted({q["exo"] for q in qs} - props.keys())
        if lost:
            raise SystemExit(f"{len(lost)} exo images have no proposals, e.g. {lost[0]}")
        qs = [q for q in qs if len(props[q["exo"]].get("masks", ())) >= 2]
    else:
        qs = [q for q in read_queries(queries) if q["key"] in keep and q["state"] in states and len(q.get("cands") or ()) >= 2]
    if not qs:
        raise SystemExit("no query to adapt on")
    model = EgoRayNet(a.ckpt, a.rank).cuda()
    if a.adapter:
        res = model.load_state_dict(torch.load(a.adapter, map_location="cpu"), strict=False)
        lost = [k for k in res.missing_keys if k.endswith((".A", ".B")) or k in ("log_tau_a", "log_tau_m")]
        if res.unexpected_keys or lost:
            raise SystemExit(f"adapter does not match the model: {res.unexpected_keys[:3]} {lost[:3]}")
    teacher = EgoRayNet(a.ckpt, a.rank).cuda().eval()
    teacher.load_state_dict(model.state_dict())
    for p in teacher.parameters():
        p.requires_grad_(False)
    model.train()
    model.log_tau_a.requires_grad_(False), model.log_tau_m.requires_grad_(False)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=0.0)
    seq = np.random.default_rng(a.seed).integers(0, len(qs), a.steps * a.bs * 3 + 100)
    dl = DataLoader(Unlabelled(qs, seq, a.data_root, props), batch_size=1, num_workers=a.workers, collate_fn=lambda b: b[0], prefetch_factor=4 if a.workers else None,
                    worker_init_fn=lambda i: (random.seed(a.seed * 977 + i), np.random.seed(a.seed * 977 + i)))
    buckets, step, t0 = {}, 0, time.time()
    for it in dl:
        if it is None:
            continue
        canvas = tuple(it["x"].shape[-2:])
        buckets.setdefault(canvas, []).append(it)
        if len(buckets[canvas]) < a.bs:
            continue
        items = buckets.pop(canvas)
        b = {k: torch.as_tensor(np.stack([i[k] for i in items])).cuda() for k in ("pts", "pv", "up")}
        b["x"] = torch.stack([i["x"] for i in items]).cuda()
        o1, o2 = model(b, "xe"), model(b, "ex")
        with torch.no_grad():
            t1, t2 = teacher(b, "xe", True), teacher(b, "ex", True)
        tau = model.log_tau_a.exp()
        lc = candidate(o1, o2)
        lk = anchor(o1, t1, tau) + anchor(o2, t2, tau)
        loss = lc + lk / 2
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        step += 1
        if step % 20 == 0:
            print(json.dumps(dict(step=step, of=a.steps, sec=round(time.time() - t0), cand=round(lc.item(), 4), anchor=round(lk.item(), 4))), flush=True)
        if step >= a.steps:
            break
    if step < a.steps:
        raise SystemExit(f"adaptation stopped after {step}/{a.steps} steps, no adapter saved")
    torch.save(lora_state(model, "^log_tau"), out / "lora.pt")
    print("saved", out / "lora.pt", flush=True)


if __name__ == "__main__":
    torch.backends.cuda.matmul.allow_tf32 = True
    main()
