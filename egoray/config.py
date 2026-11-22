import json
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent.parent / "configs" / "findego1m.json"


def load(path=None):
    return json.loads(Path(path or DEFAULT).read_text())


def domain_fn(cfg):
    skip = set(cfg["not_averaged"])

    def domain_of(name):
        if name in skip:
            return None
        for dom, names in cfg["domains"].items():
            if name in names or name.rsplit("_v", 1)[0] in names:
                return dom
        return name

    return domain_of
