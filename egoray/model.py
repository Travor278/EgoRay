import math

import torch
import torch.nn as nn

from . import losses as L
from .lora import PATTERN, apply_lora


def load_backbone(ckpt):
    from vggt_omega.models import VGGTOmega

    m = VGGTOmega()
    m.load_state_dict(torch.load(ckpt, map_location="cpu"))
    return m


def decode(pose_enc, hw):
    from vggt_omega.utils.pose_enc import encoding_to_camera

    return encoding_to_camera(pose_enc, hw)


def load_adapter(model, path, rank):
    apply_lora(model, PATTERN, r=rank)
    sd = {k.replace("vggt.", "", 1): v for k, v in torch.load(path, map_location="cpu").items() if k.startswith("vggt.")}
    res = model.load_state_dict(sd, strict=False)
    lost = [k for k in res.missing_keys if k.endswith((".A", ".B"))]
    if res.unexpected_keys or lost:
        raise SystemExit(f"adapter does not match the model: {res.unexpected_keys[:3]} {lost[:3]}")
    return model


class Predictor:
    def __init__(self, ckpt, adapter=None, rank=64, device="cuda"):
        m = load_backbone(ckpt)
        if adapter:
            load_adapter(m, adapter, rank)
        self.model = m.to(device).eval()
        self.device = device

    @torch.inference_mode()
    def __call__(self, x):
        x = x.to(self.device)
        out = {}
        for order in ("xe", "ex"):
            inp = x if order == "xe" else x.flip(1)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                pred = self.model(inp)
            ext, intr = decode(pred["pose_enc"].float(), inp.shape[-2:])
            d = pred["depth"][:, 0 if order == "xe" else 1].float()
            out[order] = (ext, intr, d[..., 0] if d.ndim == 4 else d)
        return out

    @torch.inference_mode()
    def predict_3d(self, x):
        x = x.to(self.device)
        out, geo = {}, None
        for order in ("xe", "ex"):
            inp = x if order == "xe" else x.flip(1)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                pred = self.model(inp)
            ext, intr = decode(pred["pose_enc"].float(), inp.shape[-2:])
            dep = pred["depth"].float()
            dep = dep[..., 0] if dep.ndim == 5 else dep
            out[order] = (ext, intr, dep[:, 0 if order == "xe" else 1])
            if order == "xe":
                conf = pred.get("depth_conf")
                if conf is not None:
                    conf = conf.float()
                    conf = conf[..., 0] if conf.ndim == 5 else conf
                else:
                    conf = torch.ones_like(dep)
                geo = dict(ext=ext[0].cpu().numpy(), intr=intr[0].cpu().numpy(), depth=dep[0].cpu().numpy(), conf=conf[0].cpu().numpy())
        return out, geo


class EgoRayNet(nn.Module):
    def __init__(self, ckpt, rank=64, tau_a=0.05, tau_m=0.1):
        super().__init__()
        self.vggt = load_backbone(ckpt)
        for p in self.vggt.parameters():
            p.requires_grad_(False)
        self.names = apply_lora(self.vggt, PATTERN, r=rank)
        self.log_tau_a = nn.Parameter(torch.tensor(math.log(tau_a)))
        self.log_tau_m = nn.Parameter(torch.tensor(math.log(tau_m)))

    def forward(self, b, order, fix_k=False):
        x = b["x"]
        with torch.autocast("cuda", dtype=torch.bfloat16):
            pred = self.vggt(x if order == "xe" else x.flip(1))
        ext, intr = decode(pred["pose_enc"].float(), x.shape[-2:])
        ie, ig = (0, 1) if order == "xe" else (1, 0)
        d = pred["depth"][:, ie].float()
        d = d[..., 0] if d.ndim == 4 else d
        valid = b["pv"].any(-1)
        c_x, c_g, R = L.relative(ext[:, ie], ext[:, ig])
        near, mix = L.distances(c_x, intr[:, ie].detach() if fix_k else intr[:, ie], d, b)
        la = (-near / self.log_tau_a.exp()).masked_fill(~valid, float("-inf"))
        lm = (-mix / self.log_tau_m.exp()).masked_fill(~valid, float("-inf"))
        f = lambda K: torch.stack([K[:, 0, 0], K[:, 1, 1]], -1)
        return c_x, c_g, R, la, lm, f(intr[:, ie]), f(intr[:, ig])
