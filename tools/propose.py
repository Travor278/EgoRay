import argparse
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from pycocotools import mask as mask_util

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray.data import read_image, read_list, read_queries


def load(ckpt, threshold):
    from sam3.model.sam3_image_processor import Sam3Processor
    from sam3.model_builder import build_sam3_image_model

    return Sam3Processor(build_sam3_image_model(checkpoint_path=ckpt, load_from_HF=False, device="cuda"), confidence_threshold=threshold)


def propose(proc, img, words):
    state = proc.set_image(Image.fromarray(img))
    out, counts = [], {}
    for w in words:
        with torch.autocast("cuda", dtype=torch.bfloat16):
            r = proc.set_text_prompt(w, state)
        ms = r["masks"][:, 0].cpu().numpy().astype(np.uint8)
        sc, bx = r["scores"].float().cpu().numpy(), r["boxes"].float().cpu().numpy()
        counts[w] = int(len(ms))
        for m, s, b in zip(ms, sc, bx):
            if m.any():
                e = mask_util.encode(np.asfortranarray(m))
                out.append(dict(rle=e["counts"].decode(), score=round(float(s), 4), word=w, box=[round(float(v), 1) for v in b]))
    return out, counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--keys")
    ap.add_argument("--threshold", type=float, default=0.3)
    a = ap.parse_args()
    keep = read_list(a.keys) if a.keys else None
    exos = {}
    for q in read_queries(a.queries):
        if keep is None or q["key"] in keep:
            exos[q["exo"]] = [w.strip() for w in str(q["category"]).split(",")]
    out = Path(a.out) / Path(a.queries).name.split(".")[0]
    out.mkdir(parents=True, exist_ok=True)
    proc = load(a.ckpt, a.threshold)
    tmp = out / "proposals.part"
    with gzip.open(tmp, "wt") as h:
        for exo, words in sorted(exos.items()):
            img = read_image(a.data_root, exo)
            masks, counts = propose(proc, img, words)
            h.write(json.dumps(dict(exo=exo, hw=list(img.shape[:2]), words=counts, masks=masks), separators=(",", ":")) + "\n")
    tmp.replace(out / "proposals.jsonl.gz")


if __name__ == "__main__":
    main()
