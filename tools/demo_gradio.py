import argparse
import json
import sys
import tempfile
from pathlib import Path

import gradio as gr
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from egoray.data import canvas_regions, image_regions, prep, read_image, read_mask
from egoray.geometry import front, project, to_image
from egoray.model import Predictor
from egoray.readout import fuse, pose, side
from egoray.vis3d import build_glb, render_animation, unproject_scene
from tools.demo import draw, records


def parse_boxes(text):
    data = json.loads(text)
    if not isinstance(data, list) or not all(isinstance(b, list) and len(b) == 4 for b in data):
        raise ValueError("boxes must be a JSON list of [x0, y0, x1, y1]")
    return data


def launch(ckpt, adapter=None, rank=64, device="cuda", port=7860, share=False):
    model = Predictor(ckpt, adapter, rank, device=device)
    tmp_dir = Path(tempfile.mkdtemp(prefix="egoray_demo_"))

    def infer(exo_path, ego_path, mask_path, boxes_text, conf_thres, max_points, highlight, show_cameras, show_ray, include_ego, make_gif):
        if not exo_path or not ego_path:
            raise gr.Error("upload both an exo image and an ego image")
        exo, ego = read_image(".", exo_path), read_image(".", ego_path)
        if mask_path:
            ids = sorted(int(i) for i in np.unique(read_mask(".", mask_path)) if i)
            q = dict(mask=mask_path, cands=ids)
        elif boxes_text and boxes_text.strip():
            boxes = parse_boxes(boxes_text)
            q = dict(boxes=boxes, cands=list(range(len(boxes))))
        else:
            raise gr.Error("provide an instance-id mask PNG or a JSON list of candidate boxes")
        regs = image_regions(q, ".")
        if not q["cands"] or any(i not in regs or not len(regs[i][0]) for i in q["cands"]):
            raise gr.Error("no valid candidate pixels found")
        x, meta = prep([exo, ego])
        regs_c = canvas_regions(q, ".", meta[0])
        pred, geo = model.predict_3d(x[None])
        rec = records(pred, x, meta, [exo.shape[:2], ego.shape[:2]], regs_c)
        canvas = rec["xe"]["canvas"]
        f = fuse(side(rec["xe"], 0, "xe", q["cands"], regs, canvas), side(rec["ex"], 0, "ex", q["cands"], regs, canvas))
        wearer = q["cands"][int(np.argmin(f["score"]))]
        g = pose(rec["xe"], 0, "xe")
        uv_exo = to_image(project(front(f["ex"]), g["K"]), g["t"])
        uv_ego = to_image(project(f["eg"], g["K_ego"]), g["t_ego"])
        vis2d = draw(exo, ego, q, regs, wearer, uv_exo, uv_ego)
        scene = unproject_scene(x, meta, [exo.shape[:2], ego.shape[:2]], geo, regs_c, q["cands"], wearer,
                                conf_thres=float(conf_thres), max_points=int(max_points), include_ego=bool(include_ego))
        glb_path = build_glb(scene, tmp_dir / "scene.glb", highlight=highlight, show_cameras=show_cameras, show_ray=show_ray, include_ego=include_ego)
        gif_path = render_animation(scene, exo, ego, q, regs, f, uv_exo, uv_ego, tmp_dir / "egoray.gif", frames=72, fps=16) if make_gif else None
        summary = dict(wearer=wearer, candidates={str(i): dict(angular_offset=round(float(t), 2), score=round(float(s), 4)) for i, t, s in zip(q["cands"], f["angle"], f["score"])},
                       ego_in_exo=np.round(uv_exo, 1).tolist(), exo_in_ego=np.round(uv_ego, 1).tolist(), behind=bool(np.dot(f["ex"], [0, 0, 1]) < 0))
        return glb_path, vis2d, gif_path, summary, dict(scene=scene, exo=exo, ego=ego, q=q, regs=regs, f=f, uv_exo=uv_exo, uv_ego=uv_ego)

    def refresh_3d(state, highlight, show_cameras, show_ray, include_ego):
        if not state:
            return None
        return build_glb(state["scene"], tmp_dir / "scene.glb", highlight=highlight, show_cameras=show_cameras, show_ray=show_ray, include_ego=include_ego)

    with gr.Blocks(title="EgoRay 3D Demo") as demo:
        state = gr.State(None)
        gr.Markdown("# EgoRay — 3D Cross-View Camera Wearer Identification")
        with gr.Row():
            with gr.Column(scale=1):
                exo_in = gr.Image(type="filepath", label="Exo image (3rd-person)")
                ego_in = gr.Image(type="filepath", label="Ego image (1st-person)")
                mask_in = gr.Image(type="filepath", label="Candidate instance-id mask PNG")
                boxes_in = gr.Textbox(label="Or candidate boxes JSON", placeholder="[[x0, y0, x1, y1], ...]", lines=2)
                conf_sl = gr.Slider(0, 80, value=20, step=5, label="Confidence percentile filter")
                pts_sl = gr.Slider(20000, 300000, value=180000, step=20000, label="Max 3D points")
                with gr.Row():
                    hl_cb = gr.Checkbox(value=True, label="Highlight candidates")
                    cam_cb = gr.Checkbox(value=True, label="Show cameras")
                    ray_cb = gr.Checkbox(value=True, label="Show EgoRay")
                with gr.Row():
                    ego_cb = gr.Checkbox(value=True, label="Include ego 3D points")
                    gif_cb = gr.Checkbox(value=False, label="Render 3D animation GIF")
                run_btn = gr.Button("Identify Wearer & Reconstruct 3D", variant="primary")
            with gr.Column(scale=2):
                model3d = gr.Model3D(label="Interactive 3D Point Cloud, Cameras & EgoRay", height=520)
                with gr.Row():
                    out_2d = gr.Image(label="2D Readout")
                    out_gif = gr.Image(label="3D Animation")
                out_json = gr.JSON(label="Readout Scores")
        run_btn.click(infer, [exo_in, ego_in, mask_in, boxes_in, conf_sl, pts_sl, hl_cb, cam_cb, ray_cb, ego_cb, gif_cb],
                      [model3d, out_2d, out_gif, out_json, state])
        for cb in (hl_cb, cam_cb, ray_cb, ego_cb):
            cb.change(refresh_3d, [state, hl_cb, cam_cb, ray_cb, ego_cb], [model3d])
    demo.launch(server_name="0.0.0.0", server_port=port, share=share)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--adapter")
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--port", type=int, default=7860)
    ap.add_argument("--share", action="store_true")
    a = ap.parse_args()
    launch(a.ckpt, a.adapter, a.rank, a.device, a.port, a.share)


if __name__ == "__main__":
    main()
