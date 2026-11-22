import math
import re

import torch
import torch.nn as nn

PATTERN = r"aggregator\.(frame|inter_frame)_blocks\.\d+\.attn\.(qkv|proj)$"


class LoRALinear(nn.Module):
    def __init__(self, base, r=16, alpha=16.0):
        super().__init__()
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        self.r, self.scale = r, alpha / r
        self.A = nn.Parameter(torch.empty(r, base.in_features))
        self.B = nn.Parameter(torch.zeros(base.out_features, r))
        nn.init.kaiming_uniform_(self.A, a=math.sqrt(5))

    def forward(self, x):
        return self.base(x) + (x @ self.A.t().to(x.dtype) @ self.B.t().to(x.dtype)) * self.scale

    in_features = property(lambda self: self.base.in_features)
    out_features = property(lambda self: self.base.out_features)
    weight = property(lambda self: self.base.weight)
    bias = property(lambda self: self.base.bias)


def apply_lora(model, pattern=PATTERN, r=16, alpha=None):
    rx = re.compile(pattern)
    names = [n for n, m in model.named_modules() if isinstance(m, nn.Linear) and rx.search(n)]
    for n in names:
        parent, attr = model, n
        if "." in n:
            pname, attr = n.rsplit(".", 1)
            parent = model.get_submodule(pname)
        setattr(parent, attr, LoRALinear(getattr(parent, attr), r, r if alpha is None else alpha))
    return names


def lora_state(model, extra=None):
    rx = re.compile(extra) if extra else None
    return {k: v.detach().cpu() for k, v in model.state_dict().items() if k.endswith((".A", ".B")) or (rx is not None and rx.search(k))}
