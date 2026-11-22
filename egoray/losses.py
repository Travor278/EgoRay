import math

import torch
import torch.nn.functional as F

ALPHA = 1.0


def relative(we, wg):
    Re, te, Rg, tg = we[..., :3], we[..., 3:], wg[..., :3], wg[..., 3:]
    c_x = (Re @ (-Rg.transpose(1, 2) @ tg) + te)[..., 0]
    c_g = (Rg @ (-Re.transpose(1, 2) @ te) + tg)[..., 0]
    return c_x, c_g, Rg @ Re.transpose(1, 2)


def rays(p, K):
    s = (-1,) + (1,) * (p.dim() - 2)
    x = (p[..., 0] - K[:, 0, 2].view(s)) / K[:, 0, 0].view(s)
    y = (p[..., 1] - K[:, 1, 2].view(s)) / K[:, 1, 1].view(s)
    return torch.stack([x, y, torch.ones_like(x)], -1)


def depth_at(d, pts, pv):
    B, H, W = d.shape
    N, P = pts.shape[1:3]
    idx = pts[..., 1].long().clamp(0, H - 1) * W + pts[..., 0].long().clamp(0, W - 1)
    z = d.flatten(1).gather(1, idx.flatten(1)).view(B, N, P).masked_fill(~pv, float("inf")).sort(-1).values
    mid = ((pv.sum(-1) - 1) // 2).clamp(min=0)
    return z.gather(2, mid[..., None])[..., 0]


def distances(c_x, K, d, b):
    pts, pv, up = b["pts"], b["pv"], b["up"]
    e = F.normalize(c_x, dim=-1)
    cos = (F.normalize(rays(pts, K), dim=-1) * e[:, None, None]).sum(-1).masked_fill(~pv, -2)
    near = torch.acos(cos.max(-1).values.clamp(-1 + 1e-6, 1 - 1e-6))
    ru = rays(up, K)
    z = depth_at(d, pts, pv).masked_fill(~pv.any(-1), 1.0)
    dist = c_x.norm(dim=-1, keepdim=True).clamp(min=1e-4)
    d3 = (ru * z[..., None] - c_x[:, None]).norm(dim=-1)
    au = torch.acos((F.normalize(ru, dim=-1) * e[:, None]).sum(-1).clamp(-1 + 1e-6, 1 - 1e-6))
    return near, (d3 + ALPHA * dist * torch.sin(au.clamp(max=math.pi / 2))) / dist


def chord(u, v):
    return ((F.normalize(u, dim=-1) - v) ** 2).sum(-1).add(1e-8).sqrt()


def supervised(out, b):
    c_x, c_g, R, la, lm, fe, fg = out
    has = b["has"]
    term = lambda v, h: (v * h).sum() / h.sum().clamp(min=1)
    lx = term(chord(c_x, b["ex"]), has[:, 0])
    lg = term(chord(c_g, b["eg"]), has[:, 1])
    tr = (R @ b["R"].transpose(1, 2)).diagonal(dim1=-2, dim2=-1).sum(-1)
    lr = term(torch.acos(((tr - 1) / 2).clamp(-1 + 1e-6, 1 - 1e-6)), has[:, 2])
    lf = lambda p, t: (p.clamp(min=1e-3).log() - t.log()).abs().mean(-1)
    lk = term(lf(fe, b["fe"]), has[:, 3]) + term(lf(fg, b["fg"]), has[:, 4])
    loss = lx + lg + lr + lk
    st = dict(lx=lx.item(), lg=lg.item(), lr=lr.item(), lk=lk.item())
    ok = b["label"] >= 0
    if ok.any():
        lab = b["label"][ok]
        ca, cm = F.cross_entropy(la[ok], lab), F.cross_entropy(lm[ok], lab)
        loss = loss + (ca + cm)
        st.update(ce_near=ca.item(), ce_mix=cm.item())
    else:
        loss = loss + 0 * (la.nan_to_num(0, 0, 0).sum() + lm.nan_to_num(0, 0, 0).sum())
    return loss, st


def candidate(o1, o2):
    return sum((-(torch.logsumexp(o[3], -1) + torch.logsumexp(o[4], -1))).mean() for o in (o1, o2)) / 2


def anchor(o, t, tau_a):
    held = (-t[3].max(-1).values * tau_a < math.radians(1.0)).float()
    lk = ((o[2] - t[2]) ** 2).sum((-1, -2)).add(1e-8).sqrt().mean()
    lk = lk + sum((o[j].clamp(min=1e-3).log() - t[j].clamp(min=1e-3).log()).abs().mean() for j in (5, 6))
    unit = lambda v: F.normalize(v, dim=-1)
    kept = (((unit(o[0]) - unit(t[0])) ** 2).sum(-1).add(1e-8).sqrt() * held).sum() / held.sum().clamp(min=1)
    return lk + kept / tau_a
