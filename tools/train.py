import argparse
import json
import math
import os
import random
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import torch
import torch.distributed as dist
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray import config
from egoray.data import NMAX, canvas_regions, exact_focal, prep, read_image, read_list, read_queries, sample_candidates
from egoray.geometry import truth
from egoray.losses import supervised
from egoray.lora import lora_state
from egoray.model import EgoRayNet


def pool(queries, lists, sets, absent_w):
    blob, off, dom, w = bytearray(), [0], [], []
    for name, d in sets.items():
        f = Path(lists) / f"{name}.train.txt"
        if not f.exists():
            print(f"warning: no training list for {name}, skipped", file=sys.stderr)
            continue
        keep = read_list(f)
        dev = Path(lists) / f"{name}.dev.txt"
        if dev.exists():
            keep -= read_list(dev)
        for q in read_queries(Path(queries) / f"{name}.jsonl.gz"):
            if q["key"] not in keep:
                continue
            labelled = q["state"] == "present" and len(q.get("cands") or ()) >= 2
            if not labelled and truth(q) is None:
                continue
            blob += json.dumps(q, separators=(",", ":")).encode()
            off.append(len(blob))
            dom.append(d)
            w.append(1.0 if q["state"] == "present" else absent_w)
    if not w:
        raise SystemExit(f"no training queries under {lists}")
    dom, w = np.array(dom), np.array(w)
    for d in np.unique(dom):
        m = dom == d
        w[m] *= math.sqrt(m.sum()) / w[m].sum()
    return bytes(blob), np.array(off, np.int64), w / w.sum(), {str(d): int((dom == d).sum()) for d in np.unique(dom)}


def photometric(v):
    g = v.mean(0, keepdim=True)
    v = g.expand_as(v).clone() if random.random() < 0.1 else g + (v - g) * random.uniform(0.5, 1.5)
    m = v.mean()
    v = ((v - m) * random.uniform(0.6, 1.4) + m * random.uniform(0.6, 1.4)).clamp(0, 1) ** random.uniform(0.7, 1.4)
    if random.random() < 0.05:
        v = 1 - v
    if random.random() < 0.2:
        k = random.choice((3, 5))
        v = F.avg_pool2d(v[None], k, 1, k // 2, count_include_pad=False)[0]
    if random.random() < 0.2:
        v = v + torch.randn_like(v) * random.uniform(0.005, 0.03)
    return v.clamp(0, 1)


def color(x, meta):
    H, W = x.shape[-2:]
    x = x.clone()
    for i, (_, _, pl, pt) in enumerate(meta):
        pl, pt = max(0, int(pl)), max(0, int(pt))
        x[i, :, pt:H - pt, pl:W - pl] = photometric(x[i, :, pt:H - pt, pl:W - pl])
    return x


class Samples(Dataset):
    def __init__(self, blob, off, seq, root, aug):
        self.blob, self.off, self.seq, self.root, self.aug = blob, off, seq, root, aug

    def __len__(self):
        return len(self.seq)

    def __getitem__(self, i):
        j = int(self.seq[i])
        q = json.loads(self.blob[self.off[j]:self.off[j + 1]])
        try:
            x, meta = prep([read_image(self.root, q["exo"]), read_image(self.root, q["ego"])])
            regs = canvas_regions(q, self.root, meta[0])
        except Exception as e:
            warnings.warn(f"skipping query {q['key']}: {e!r}", RuntimeWarning)
            return None
        t = truth(q)
        e_x, e_g, R = (t[0], t[1], t[2]) if t is not None else (None, None, None)
        fe, ge = exact_focal(q, "exo", meta[0]), exact_focal(q, "ego", meta[1])
        if self.aug:
            x = color(x, meta)
        c = [k for k in q.get("cands") or () if k in regs and len(regs[k][0])]
        w, label = q.get("wearer"), -1
        if q["state"] == "present" and w in c and len(c) >= 2:
            others = [k for k in c if k != w]
            random.shuffle(others)
            c = [w] + others[:NMAX - 1]
            random.shuffle(c)
            label = c.index(w)
        else:
            c = []
        pts, pv, up = sample_candidates(regs, c)
        has = np.array([e_x is not None, e_g is not None, R is not None, fe is not None, ge is not None], np.float32)
        return dict(x=x, pts=pts, pv=pv, up=up, label=label, has=has, ex=np.zeros(3) if e_x is None else e_x, eg=np.zeros(3) if e_g is None else e_g,
                    R=np.eye(3) if R is None else R, fe=np.ones(2) if fe is None else fe, fg=np.ones(2) if ge is None else ge)


def to_batch(items):
    b = {k: torch.as_tensor(np.stack([i[k] for i in items])) for k in ("pts", "pv", "up", "has", "ex", "eg", "R", "fe", "fg")}
    b["x"] = torch.stack([i["x"] for i in items])
    b["label"] = torch.as_tensor(np.stack([i["label"] for i in items]))
    return {k: (v.float() if v.dtype == torch.float64 else v).cuda(non_blocking=True) for k, v in b.items()}


def ddp():
    if int(os.environ.get("WORLD_SIZE", 1)) > 1:
        dist.init_process_group("nccl")
        torch.cuda.set_device(int(os.environ["LOCAL_RANK"]))
        return dist.get_rank(), dist.get_world_size()
    torch.cuda.set_device(0)
    return 0, 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--lists", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--config")
    ap.add_argument("--samples", type=int, default=520000)
    ap.add_argument("--bs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--tau-a", type=float, default=0.05)
    ap.add_argument("--tau-m", type=float, default=0.1)
    ap.add_argument("--absent-w", type=float, default=0.25)
    ap.add_argument("--no-color", action="store_true")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--save-every", type=int, default=1000)
    ap.add_argument("--log-every", type=int, default=50)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    rank, world = ddp()
    out = Path(a.out)
    blob, off, w, counts = pool(a.queries, a.lists, config.load(a.config)["train_sets"], a.absent_w)
    model = EgoRayNet(a.ckpt, a.rank, a.tau_a, a.tau_m).cuda()
    total = a.samples // (a.bs * world)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, [a.lr], total_steps=total, pct_start=0.05)
    step, state = 0, out / "state.pt"
    if state.exists():
        st = torch.load(state, map_location="cpu")
        if st["sched"].get("total_steps") != total:
            raise SystemExit(f"{state}: saved for {st['sched'].get('total_steps')} steps, requested {total}; resume with the same --samples, --bs and GPUs or use a new --out")
        res = model.load_state_dict(st["model"], strict=False)
        lost = [k for k in res.missing_keys if k.endswith((".A", ".B")) or k in ("log_tau_a", "log_tau_m")]
        if res.unexpected_keys or lost:
            raise SystemExit(f"{state} does not match the model: {res.unexpected_keys[:3]} {lost[:3]}")
        opt.load_state_dict(st["opt"])
        sched.load_state_dict(st["sched"])
        step = st["step"]
    if rank == 0:
        out.mkdir(parents=True, exist_ok=True)
        json.dump(dict(vars(a), world=world, pool=counts), open(out / "args.json", "w"), indent=1)
    net = nn.parallel.DistributedDataParallel(model, find_unused_parameters=True) if world > 1 else model
    rng = np.random.default_rng(a.seed * 1000 + step)
    seq = rng.choice(len(w), size=int((total - step) * a.bs * world * 1.1) + 1000, p=w)[rank::world]
    seed = lambda i: (random.seed(a.seed * 977 + rank * 131 + i + step), np.random.seed((a.seed * 977 + rank * 131 + i + step) % 2 ** 31))
    dl = DataLoader(Samples(blob, off, seq, a.data_root, not a.no_color), batch_size=1, num_workers=a.workers, collate_fn=lambda b: b[0], prefetch_factor=4 if a.workers else None,
                    shuffle=False, persistent_workers=a.workers > 0, worker_init_fn=seed)
    buckets, run, t0 = {}, {}, time.time()
    model.train()
    while step < total:
        start = step
        for it in dl:
            if it is None:
                continue
            canvas = tuple(it["x"].shape[-2:])
            buckets.setdefault(canvas, []).append(it)
            if len(buckets[canvas]) < a.bs:
                continue
            b = to_batch(buckets.pop(canvas))
            loss, st = supervised(net(b, random.choice(("xe", "ex"))), b)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
            opt.step()
            sched.step()
            step += 1
            for k, v in dict(st, loss=loss.item()).items():
                run.setdefault(k, []).append(v)
            if rank == 0 and step % a.log_every == 0:
                print(json.dumps(dict(step=step, of=total, sec=round(time.time() - t0), tau_a=round(model.log_tau_a.exp().item(), 4),
                                      tau_m=round(model.log_tau_m.exp().item(), 4), **{k: round(float(np.mean(v)), 4) for k, v in run.items()})), flush=True)
                run = {}
            if rank == 0 and (step % a.save_every == 0 or step == total):
                torch.save(lora_state(model, "^log_tau"), out / "lora.pt")
                keep = {k: v for k, v in model.state_dict().items() if k.endswith((".A", ".B")) or k.startswith("log_tau")}
                torch.save(dict(model=keep, opt=opt.state_dict(), sched=sched.state_dict(), step=step), state)
            if step >= total:
                break
        if step == start:
            raise SystemExit("no training step in a full pass over the sampled queries")
    if world > 1:
        dist.destroy_process_group()


if __name__ == "__main__":
    torch.backends.cuda.matmul.allow_tf32 = True
    main()
