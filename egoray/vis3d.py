import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .geometry import centre, unit

COL_BG = (14, 17, 23)
COL_CARD = (22, 27, 34)
COL_BORDER = (46, 55, 70)
COL_TEXT = (235, 240, 248)
COL_MUTED = (148, 163, 184)
COL_EXO = (56, 189, 248)
COL_EGO = (251, 191, 36)
COL_WEARER = (52, 211, 153)
COL_OTHER = (248, 113, 113)


def depth_edge(depth, rtol=0.03):
    d = np.asarray(depth, np.float32)
    h, w = d.shape
    mask = np.zeros((h, w), bool)
    for sy, sx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        y0, y1 = max(0, -sy), h - max(0, sy)
        x0, x1 = max(0, -sx), w - max(0, sx)
        a = d[y0:y1, x0:x1]
        b = d[y0 + sy:y1 + sy, x0 + sx:x1 + sx]
        mask[y0:y1, x0:x1] |= np.abs(a - b) > rtol * np.maximum(a, 1e-6)
    return mask


def _valid_box(meta_v, hw_v, H, W, margin=2):
    sx, sy, pl, pt = meta_v
    h, w = hw_v
    x0 = max(0, int(round(pl)) + margin)
    y0 = max(0, int(round(pt)) + margin)
    x1 = min(W, int(round(pl + w * sx)) - margin)
    y1 = min(H, int(round(pt + h * sy)) - margin)
    if x1 <= x0 or y1 <= y0:
        return 0, 0, W, H
    return x0, y0, x1, y1


def unproject_scene(x, meta, hw, geo, regs_c, cands, wearer, conf_thres=20.0, edge_rtol=0.03, max_points=180000, include_ego=True):
    imgs = x.detach().cpu().numpy() if hasattr(x, "detach") else np.asarray(x, np.float32)
    imgs = (np.clip(imgs, 0.0, 1.0).transpose(0, 2, 3, 1) * 255.0).round().astype(np.uint8)
    H, W = imgs.shape[1:3]
    ext = np.asarray(geo["ext"], np.float64)
    intr = np.asarray(geo["intr"], np.float64)
    dep = np.asarray(geo["depth"], np.float32)
    conf = np.asarray(geo["conf"], np.float32)
    R0, t0 = ext[0, :3, :3], ext[0, :3, 3]
    R1, t1 = ext[1, :3, :3], ext[1, :3, 3]
    c_ego = R0 @ centre(ext[1]) + t0
    R_ego = R0 @ R1.T
    cmap = np.full((H, W), -1, np.int32)
    for cid in cands:
        if cid in regs_c:
            ys, xs = regs_c[cid]
            ok = (ys >= 0) & (ys < H) & (xs >= 0) & (xs < W)
            cmap[ys[ok], xs[ok]] = int(cid)
    uu, vv = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    pts_all, rgb_all, cid_all, vid_all = [], [], [], []
    views = (0, 1) if include_ego else (0,)
    for vi in views:
        d = dep[vi]
        c = conf[vi]
        K = intr[vi]
        x0, y0, x1, y1 = _valid_box(meta[vi], hw[vi], H, W)
        box = np.zeros((H, W), bool)
        box[y0:y1, x0:x1] = True
        ok = box & np.isfinite(d) & (d > 1e-4) & np.isfinite(c) & (c > 1e-5)
        if edge_rtol > 0:
            ok &= ~depth_edge(d, edge_rtol)
        if ok.sum() < 200:
            ok = box & np.isfinite(d) & (d > 1e-4)
        if ok.sum() == 0:
            continue
        if conf_thres > 0:
            thr = float(np.percentile(c[ok], np.clip(conf_thres, 0.0, 95.0)))
            kept = ok & (c >= thr)
            if kept.sum() >= 200:
                ok = kept
        zmax = float(np.percentile(d[ok], 94.0))
        kept = ok & (d <= zmax * 1.08)
        if kept.sum() >= 200:
            ok = kept
        u, v, z = uu[ok], vv[ok], d[ok]
        pc = np.stack([(u - K[0, 2]) / K[0, 0] * z, (v - K[1, 2]) / K[1, 1] * z, z], 1).astype(np.float64)
        if vi == 1:
            pc = pc @ R_ego.T + c_ego[None, :]
        pts_all.append(pc.astype(np.float32))
        rgb_all.append(imgs[vi][ok])
        cid_all.append(cmap[ok] if vi == 0 else np.full(len(pc), -1, np.int32))
        vid_all.append(np.full(len(pc), vi, np.uint8))
    if pts_all:
        pts = np.concatenate(pts_all, 0)
        rgb = np.concatenate(rgb_all, 0)
        cid = np.concatenate(cid_all, 0)
        vid = np.concatenate(vid_all, 0)
    else:
        pts = np.zeros((0, 3), np.float32)
        rgb = np.zeros((0, 3), np.uint8)
        cid = np.zeros((0,), np.int32)
        vid = np.zeros((0,), np.uint8)
    if max_points and len(pts) > max_points:
        rng = np.random.default_rng(0)
        c_idx = np.flatnonzero(cid >= 0)
        b_idx = np.flatnonzero(cid < 0)
        keep_c = c_idx if len(c_idx) <= max_points // 2 else rng.choice(c_idx, max_points // 2, replace=False)
        rem = max_points - len(keep_c)
        keep_b = b_idx if len(b_idx) <= rem else rng.choice(b_idx, rem, replace=False)
        sel = np.sort(np.concatenate([keep_c, keep_b]))
        pts, rgb, cid, vid = pts[sel], rgb[sel], cid[sel], vid[sel]
    cand_pts = {}
    K0 = intr[0]
    for c_val in cands:
        c_int = int(c_val)
        c_pts = pts[cid == c_int]
        if len(c_pts) >= 5:
            cand_pts[c_int] = np.median(c_pts, axis=0).astype(np.float64)
        elif c_int in regs_c and len(regs_c[c_int][0]):
            ys, xs = regs_c[c_int]
            ok_c = (ys >= 0) & (ys < H) & (xs >= 0) & (xs < W)
            ys, xs = ys[ok_c], xs[ok_c]
            if len(ys):
                z_med = float(np.median(dep[0][ys, xs]))
                cand_pts[c_int] = np.array([(float(np.median(xs)) - K0[0, 2]) / K0[0, 0] * z_med,
                                            (float(np.median(ys)) - K0[1, 2]) / K0[1, 1] * z_med, z_med], np.float64)
    wearer_pt = cand_pts.get(int(wearer), c_ego.copy())
    return dict(pts=pts, rgb=rgb, cand=cid, view=vid, c_ego=c_ego.astype(np.float64), R_ego=R_ego.astype(np.float64),
                K_exo=intr[0].astype(np.float64), K_ego=intr[1].astype(np.float64), canvas=(H, W),
                wearer=int(wearer), wearer_pt=wearer_pt, cand_pts=cand_pts, cands=[int(c) for c in cands])


def colorize_points(rgb, cand, wearer, strength=1.0):
    out = rgb.astype(np.float32).copy()
    if strength <= 0:
        return rgb.copy()
    is_w = cand == int(wearer)
    is_o = (cand >= 0) & ~is_w
    aw = 0.52 * float(strength)
    ao = 0.40 * float(strength)
    if np.any(is_w):
        out[is_w] = (1.0 - aw) * out[is_w] + aw * np.array(COL_WEARER, np.float32)
    if np.any(is_o):
        out[is_o] = (1.0 - ao) * out[is_o] + ao * np.array(COL_OTHER, np.float32)
    return out.clip(0, 255).astype(np.uint8)


def _frustum_points(origin, R, K, hw, depth):
    H, W = hw
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    corners_c = np.array([
        [(0 - cx) / fx * depth, (0 - cy) / fy * depth, depth],
        [(W - cx) / fx * depth, (0 - cy) / fy * depth, depth],
        [(W - cx) / fx * depth, (H - cy) / fy * depth, depth],
        [(0 - cx) / fx * depth, (H - cy) / fy * depth, depth],
    ], np.float64)
    corners_w = corners_c @ R.T + origin[None, :]
    up_tip = np.array([0.0, -0.58 * depth * (H / max(fy, 1.0)), depth], np.float64) @ R.T + origin
    return origin.astype(np.float64), corners_w, up_tip


def _tube_mesh(a, b, radius, rgba, sections=8):
    import trimesh

    v = np.asarray(b, np.float64) - np.asarray(a, np.float64)
    length = float(np.linalg.norm(v))
    if length < 1e-6:
        return None
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=sections)
    z = v / length
    ref = np.array([0.0, 1.0, 0.0]) if abs(z[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    x = np.cross(ref, z)
    x /= max(np.linalg.norm(x), 1e-9)
    y = np.cross(z, x)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = x, y, z, 0.5 * (np.asarray(a) + np.asarray(b))
    mesh.apply_transform(T)
    mesh.visual.vertex_colors = np.tile(np.asarray(rgba, np.uint8), (len(mesh.vertices), 1))
    return mesh


def build_glb(scene_data, out_path=None, highlight=True, show_cameras=True, show_ray=True, include_ego=True):
    import trimesh

    pts = scene_data["pts"]
    rgb = scene_data["rgb"]
    cid = scene_data["cand"]
    vid = scene_data["view"]
    if not include_ego:
        m = vid == 0
        pts, rgb, cid = pts[m], rgb[m], cid[m]
    cols = colorize_points(rgb, cid, scene_data["wearer"], 1.0 if highlight else 0.0)
    sc = trimesh.Scene()
    if len(pts):
        rgba = np.c_[cols, np.full((len(cols), 1), 255, np.uint8)]
        sc.add_geometry(trimesh.PointCloud(vertices=pts.astype(np.float32), colors=rgba), node_name="points")
    span = float(np.linalg.norm(np.percentile(pts, 90, axis=0) - np.percentile(pts, 10, axis=0))) if len(pts) >= 20 else 4.0
    c_ego = scene_data["c_ego"]
    wearer_pt = scene_data["wearer_pt"]
    span = max(span, float(np.linalg.norm(c_ego)), 1.0)
    cam_d = float(np.clip(0.085 * span, 0.12, 0.55))
    rad = cam_d * 0.045
    if show_cameras:
        for name, orig, R, K, col in (
            ("exo_cam", np.zeros(3), np.eye(3), scene_data["K_exo"], (*COL_EXO, 255)),
            ("ego_cam", c_ego, scene_data["R_ego"], scene_data["K_ego"], (*COL_EGO, 255)),
        ):
            o, cs, tip = _frustum_points(orig, R, K, scene_data["canvas"], cam_d)
            segs = [(o, cs[k]) for k in range(4)] + [(cs[k], cs[(k + 1) % 4]) for k in range(4)] + [(0.5 * (cs[0] + cs[1]), tip)]
            parts = [m for a, b in segs if (m := _tube_mesh(a, b, rad, col)) is not None]
            sp = trimesh.creation.icosphere(subdivisions=2, radius=rad * 2.2)
            sp.apply_translation(o)
            sp.visual.vertex_colors = np.tile(np.asarray(col, np.uint8), (len(sp.vertices), 1))
            parts.append(sp)
            sc.add_geometry(trimesh.util.concatenate(parts), node_name=name)
    if show_ray:
        ray_dir = unit(c_ego)
        if np.linalg.norm(c_ego) > 1e-4:
            ray_len = max(float(np.linalg.norm(c_ego)) * 1.15, float(np.dot(wearer_pt, ray_dir)) + 0.15 * cam_d)
            end_pt = ray_dir * ray_len
            beam = _tube_mesh(np.zeros(3), end_pt, rad * 1.35, (*COL_EGO, 255), sections=10)
            if beam is not None:
                sc.add_geometry(beam, node_name="egoray")
            hit = trimesh.creation.icosphere(subdivisions=2, radius=rad * 2.8)
            hit.apply_translation(wearer_pt)
            hit.visual.vertex_colors = np.tile(np.asarray((*COL_WEARER, 255), np.uint8), (len(hit.vertices), 1))
            sc.add_geometry(hit, node_name="wearer_marker")
    if highlight:
        for c_id, c_pt in scene_data.get("cand_pts", {}).items():
            if int(c_id) == int(scene_data["wearer"]):
                continue
            mk = trimesh.creation.icosphere(subdivisions=2, radius=rad * 2.2)
            mk.apply_translation(c_pt)
            mk.visual.vertex_colors = np.tile(np.asarray((*COL_OTHER, 255), np.uint8), (len(mk.vertices), 1))
            sc.add_geometry(mk, node_name=f"candidate_{int(c_id)}")
    center = np.median(pts, axis=0) if len(pts) else np.zeros(3)
    T_align = np.eye(4)
    T_align[:3, :3] = np.diag([1.0, -1.0, -1.0])
    T_align[:3, 3] = -(T_align[:3, :3] @ center)
    sc.apply_transform(T_align)
    if out_path is not None:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        sc.export(str(out_path))
        return str(out_path)
    return sc


def _ease(x):
    x = float(np.clip(x, 0.0, 1.0))
    return x * x * (3.0 - 2.0 * x)


def _look_at(eye, target, up=(0.0, -1.0, 0.0)):
    f = unit(np.asarray(target, np.float64) - np.asarray(eye, np.float64))
    u0 = np.asarray(up, np.float64)
    r = np.cross(f, u0)
    if np.linalg.norm(r) < 1e-6:
        r = np.cross(f, np.array([1.0, 0.0, 0.0]))
    r = unit(r)
    d = np.cross(f, r)
    R = np.stack([r, d, f], 0)
    t = -(R @ np.asarray(eye, np.float64))
    return R, t


def _project_pts(pts, R, t, fx, fy, cx, cy):
    pc = pts @ R.T + t[None, :]
    z = pc[:, 2]
    ok = z > 0.05
    u = np.where(ok, pc[:, 0] / np.where(ok, z, 1.0) * fx + cx, -1e6)
    v = np.where(ok, pc[:, 1] / np.where(ok, z, 1.0) * fy + cy, -1e6)
    return u, v, z, ok


def _draw_line_3d(buf, zbuf, a, b, R, t, fx, fy, cx, cy, col, thickness=2, alpha=1.0, xray=False):
    pa = R @ a + t
    pb = R @ b + t
    near = 0.08
    if pa[2] <= near and pb[2] <= near:
        return
    if pa[2] <= near:
        s = (near - pa[2]) / max(pb[2] - pa[2], 1e-9)
        pa = pa + s * (pb - pa)
    elif pb[2] <= near:
        s = (near - pb[2]) / max(pa[2] - pb[2], 1e-9)
        pb = pb + s * (pa - pb)
    ua, va = pa[0] / pa[2] * fx + cx, pa[1] / pa[2] * fy + cy
    ub, vb = pb[0] / pb[2] * fx + cx, pb[1] / pb[2] * fy + cy
    H, W = zbuf.shape
    dist_px = max(abs(ub - ua), abs(vb - va))
    n = max(2, int(min(dist_px * 1.4, 2400)))
    ts = np.linspace(0.0, 1.0, n, dtype=np.float32)
    us = np.rint(ua + (ub - ua) * ts).astype(np.int32)
    vs = np.rint(va + (vb - va) * ts).astype(np.int32)
    inv_z = (1.0 / pa[2]) * (1.0 - ts) + (1.0 / pb[2]) * ts
    zs = 1.0 / np.maximum(inv_z, 1e-6)
    ok = (us >= 0) & (us < W) & (vs >= 0) & (vs < H)
    us, vs, zs = us[ok], vs[ok], zs[ok]
    if not len(us):
        return
    r = max(0, int(thickness) // 2)
    col_f = np.asarray(col, np.float32)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > (r + 0.35) ** 2 and r > 0:
                continue
            uu = np.clip(us + dx, 0, W - 1)
            vv = np.clip(vs + dy, 0, H - 1)
            vis = np.ones(len(uu), bool) if xray else (zs <= zbuf[vv, uu] + 0.04)
            if not np.any(vis):
                continue
            uu, vv = uu[vis], vv[vis]
            if alpha >= 0.99:
                buf[vv, uu] = col_f.astype(np.uint8)
            else:
                buf[vv, uu] = ((1.0 - alpha) * buf[vv, uu].astype(np.float32) + alpha * col_f).clip(0, 255).astype(np.uint8)


def _draw_dot_3d(buf, zbuf, pt, R, t, fx, fy, cx, cy, col, radius=6, ring=False, xray=True):
    p = R @ pt + t
    if p[2] <= 0.08:
        return None
    u, v = int(round(p[0] / p[2] * fx + cx)), int(round(p[1] / p[2] * fy + cy))
    H, W = zbuf.shape
    if u < -radius or u >= W + radius or v < -radius or v >= H + radius:
        return None
    if not xray and 0 <= u < W and 0 <= v < H and p[2] > zbuf[v, u] + 0.08:
        return None
    if ring:
        cv2.circle(buf, (u, v), radius, col, max(2, radius // 4), cv2.LINE_AA)
    else:
        cv2.circle(buf, (u, v), radius, col, -1, cv2.LINE_AA)
        cv2.circle(buf, (u, v), radius, (255, 255, 255), max(1, radius // 5), cv2.LINE_AA)
    return (u, v)


def _draw_frustum_3d(buf, zbuf, orig, Rf, K, hw, depth, R, t, fx, fy, cx, cy, col, alpha=1.0, thickness=2):
    o, cs, tip = _frustum_points(orig, Rf, K, hw, depth)
    for k in range(4):
        _draw_line_3d(buf, zbuf, o, cs[k], R, t, fx, fy, cx, cy, col, thickness=thickness, alpha=alpha, xray=True)
        _draw_line_3d(buf, zbuf, cs[k], cs[(k + 1) % 4], R, t, fx, fy, cx, cy, col, thickness=thickness, alpha=alpha, xray=True)
    _draw_line_3d(buf, zbuf, 0.5 * (cs[0] + cs[1]), tip, R, t, fx, fy, cx, cy, col, thickness=max(1, thickness - 1), alpha=alpha, xray=True)
    return _draw_dot_3d(buf, zbuf, o, R, t, fx, fy, cx, cy, col, radius=max(4, thickness * 2 + 1), xray=True)


def _font(size, bold=False):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _fit_image(im, box_w, box_h):
    h, w = im.shape[:2]
    s = min(box_w / max(w, 1), box_h / max(h, 1))
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    res = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    ox, oy = (box_w - nw) // 2, (box_h - nh) // 2
    canvas = np.full((box_h, box_w, 3), (12, 15, 20), np.uint8)
    canvas[oy:oy + nh, ox:ox + nw] = res
    return canvas, s, ox, oy


def _prepare_exo_cards(exo, ego, q, regs, wearer, uv_exo, uv_ego, card_w, img_h):
    base_exo, s_exo, ox_exo, oy_exo = _fit_image(exo, card_w, img_h)
    over_exo = exo.astype(np.float32).copy()
    H, W = exo.shape[:2]
    contours = []
    for cid in q["cands"]:
        if cid not in regs:
            continue
        p = regs[cid][0].astype(np.int32)
        p = p[(p[:, 0] >= 0) & (p[:, 0] < W) & (p[:, 1] >= 0) & (p[:, 1] < H)]
        if not len(p):
            continue
        is_w = int(cid) == int(wearer)
        col = np.array(COL_WEARER if is_w else COL_OTHER, np.float32)
        a = 0.45 if is_w else 0.30
        over_exo[p[:, 1], p[:, 0]] = (1.0 - a) * over_exo[p[:, 1], p[:, 0]] + a * col
        m = np.zeros((H, W), np.uint8)
        m[p[:, 1], p[:, 0]] = 255
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours.append((cnts, COL_WEARER if is_w else COL_OTHER, 3 if is_w else 2))
    over_u8 = over_exo.clip(0, 255).astype(np.uint8)
    for cnts, col, lw in contours:
        cv2.drawContours(over_u8, cnts, -1, col, lw, cv2.LINE_AA)
    ann_exo, _, _, _ = _fit_image(over_u8, card_w, img_h)
    ux = int(round(uv_exo[0] * s_exo + ox_exo))
    vy = int(round(uv_exo[1] * s_exo + oy_exo))
    if 0 <= ux < card_w and 0 <= vy < img_h:
        cv2.circle(ann_exo, (ux, vy), 10, COL_EGO, 2, cv2.LINE_AA)
        cv2.line(ann_exo, (ux - 14, vy), (ux + 14, vy), COL_EGO, 2, cv2.LINE_AA)
        cv2.line(ann_exo, (ux, vy - 14), (ux, vy + 14), COL_EGO, 2, cv2.LINE_AA)
    base_ego, s_ego, ox_ego, oy_ego = _fit_image(ego, card_w, img_h)
    ann_ego = base_ego.copy()
    ug = int(round(uv_ego[0] * s_ego + ox_ego))
    vg = int(round(uv_ego[1] * s_ego + oy_ego))
    if 0 <= ug < card_w and 0 <= vg < img_h:
        cv2.circle(ann_ego, (ug, vg), 10, COL_EXO, 2, cv2.LINE_AA)
        cv2.line(ann_ego, (ug - 14, vg), (ug + 14, vg), COL_EXO, 2, cv2.LINE_AA)
        cv2.line(ann_ego, (ug, vg - 14), (ug, vg + 14), COL_EXO, 2, cv2.LINE_AA)
    return base_exo, ann_exo, base_ego, ann_ego


def _render_viewport(scene, R_cam, t_cam, vp_w, vp_h, ss, mask_alpha, ego_alpha, ray_prog, exo_cam_alpha, grid_pts, cam_d):
    rw, rh = int(round(vp_w * ss)), int(round(vp_h * ss))
    buf = np.empty((rh, rw, 3), np.uint8)
    grad = np.linspace(0.0, 1.0, rh, dtype=np.float32)[:, None, None]
    top_c = np.array([15, 20, 30], np.float32)
    bot_c = np.array([10, 13, 19], np.float32)
    buf[:] = (top_c * (1.0 - grad) + bot_c * grad).astype(np.uint8)
    zbuf = np.full((rh, rw), np.inf, np.float32)
    f = 0.92 * max(rw, rh)
    cx, cy = rw * 0.5, rh * 0.5
    for a, b in grid_pts:
        _draw_line_3d(buf, zbuf, a, b, R_cam, t_cam, f, f, cx, cy, (36, 46, 62), thickness=1, alpha=0.55, xray=True)
    pts = scene["pts"]
    vid = scene["view"]
    cid = scene["cand"]
    cols = colorize_points(scene["rgb"], cid, scene["wearer"], mask_alpha)
    if ego_alpha < 0.05:
        keep = vid == 0
    elif ego_alpha < 0.95:
        rng_mask = ((np.arange(len(pts)) * 2654435761) & 1023) < int(ego_alpha * 1024)
        keep = (vid == 0) | rng_mask
    else:
        keep = np.ones(len(pts), bool)
    p = pts[keep]
    c = cols[keep]
    if len(p):
        u, v, z, ok = _project_pts(p, R_cam, t_cam, f, f, cx, cy)
        inb = ok & (u >= 1) & (u < rw - 2) & (v >= 1) & (v < rh - 2)
        u, v, z, c = u[inb], v[inb], z[inb], c[inb]
        if len(u):
            order = np.argsort(z)[::-1]
            ui = np.rint(u[order]).astype(np.int32)
            vi = np.rint(v[order]).astype(np.int32)
            zi = z[order].astype(np.float32)
            ci = c[order]
            offs = ((-1, -1), (0, -1), (1, -1), (-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)) if ss >= 1.4 else ((0, 0), (1, 0), (0, 1), (1, 1))
            for dx, dy in offs:
                buf[vi + dy, ui + dx] = ci
                zbuf[vi + dy, ui + dx] = zi
    labels = []
    if exo_cam_alpha > 0.02:
        pos = _draw_frustum_3d(buf, zbuf, np.zeros(3), np.eye(3), scene["K_exo"], scene["canvas"], cam_d * exo_cam_alpha,
                               R_cam, t_cam, f, f, cx, cy, COL_EXO, alpha=exo_cam_alpha, thickness=max(2, int(round(2 * ss))))
        if pos is not None and exo_cam_alpha > 0.45:
            labels.append((int(round(pos[0] / ss)), int(round(pos[1] / ss)), "Exo Cam", COL_EXO, (10, 8)))
    if ego_alpha > 0.02:
        pos = _draw_frustum_3d(buf, zbuf, scene["c_ego"], scene["R_ego"], scene["K_ego"], scene["canvas"], cam_d * ego_alpha,
                               R_cam, t_cam, f, f, cx, cy, COL_EGO, alpha=ego_alpha, thickness=max(2, int(round(2 * ss))))
        if pos is not None and ego_alpha > 0.45:
            labels.append((int(round(pos[0] / ss)), int(round(pos[1] / ss)), "Ego Cam", COL_EGO, (10, -24)))
    if mask_alpha > 0.08:
        cand_pts = scene.get("cand_pts", {})
        dot_r = max(4, int(round(5.0 * ss * min(1.0, mask_alpha * 1.4))))
        ring_r = max(7, int(round(9.0 * ss * min(1.0, mask_alpha * 1.4))))
        for c_id in scene.get("cands", []):
            c_int = int(c_id)
            if c_int == int(scene["wearer"]) or c_int not in cand_pts:
                continue
            pt_o = cand_pts[c_int]
            if mask_alpha > 0.35:
                _draw_dot_3d(buf, zbuf, pt_o, R_cam, t_cam, f, f, cx, cy, COL_OTHER, radius=ring_r, ring=True, xray=True)
            pos_o = _draw_dot_3d(buf, zbuf, pt_o, R_cam, t_cam, f, f, cx, cy, COL_OTHER, radius=dot_r, xray=True)
            if pos_o is not None and mask_alpha > 0.45:
                labels.append((int(round(pos_o[0] / ss)), int(round(pos_o[1] / ss)), f"#{c_int}", COL_OTHER, (10, -8)))
    if ray_prog > 0.01 and np.linalg.norm(scene["c_ego"]) > 1e-4:
        c_ego = scene["c_ego"]
        w_pt = scene["wearer_pt"]
        rdir = unit(c_ego)
        ray_len = max(float(np.linalg.norm(c_ego)), float(np.dot(w_pt, rdir)))
        tip = rdir * (ray_len * ray_prog)
        _draw_line_3d(buf, zbuf, np.zeros(3), tip, R_cam, t_cam, f, f, cx, cy, COL_EGO, thickness=max(5, int(round(5 * ss))), alpha=0.35, xray=True)
        _draw_line_3d(buf, zbuf, np.zeros(3), tip, R_cam, t_cam, f, f, cx, cy, (255, 240, 175), thickness=max(2, int(round(2 * ss))), alpha=0.95, xray=True)
        if ray_prog > 0.72:
            pulse = 0.5 + 0.5 * math.sin(ray_prog * 14.0)
            rad_ring = int(round((10 + 6 * pulse) * ss))
            pos_w = _draw_dot_3d(buf, zbuf, w_pt, R_cam, t_cam, f, f, cx, cy, COL_WEARER, radius=rad_ring, ring=True, xray=True)
            _draw_dot_3d(buf, zbuf, w_pt, R_cam, t_cam, f, f, cx, cy, COL_WEARER, radius=max(4, int(round(4 * ss))), xray=True)
            if pos_w is not None:
                labels.append((int(round(pos_w[0] / ss)), int(round(pos_w[1] / ss)), f"Wearer #{scene['wearer']}", COL_WEARER, (12, 10)))
    if ss != 1.0:
        out = cv2.resize(buf, (vp_w, vp_h), interpolation=cv2.INTER_AREA)
    else:
        out = buf
    return out, labels


def _scene_rig(scene):
    pts = scene["pts"]
    c_ego = scene["c_ego"]
    w_pt = scene["wearer_pt"]
    if len(pts) >= 20:
        lo, hi = np.percentile(pts, 12, axis=0), np.percentile(pts, 88, axis=0)
        med = np.median(pts, axis=0)
        span = float(np.linalg.norm(hi - lo))
        y_floor = float(np.percentile(pts[:, 1], 90))
    else:
        med = 0.5 * (c_ego + w_pt)
        span = max(float(np.linalg.norm(c_ego)), 2.0)
        y_floor = float(max(c_ego[1], w_pt[1]) + 0.5)
    focus = 0.34 * w_pt + 0.32 * c_ego + 0.20 * np.zeros(3) + 0.14 * med
    key_pts = np.stack([np.zeros(3), c_ego, w_pt, med], 0)
    rad_keys = float(np.max(np.linalg.norm(key_pts - focus[None, :], axis=1)))
    orbit_r = max(2.25 * rad_keys, 0.85 * span, 1.8)
    cam_d = float(np.clip(0.055 * max(span, rad_keys * 2.0), 0.12, 0.34))
    g_half = max(0.55 * span, rad_keys * 1.25)
    grid = []
    for k in range(-4, 5):
        off = k * (g_half / 4.0)
        grid.append((np.array([focus[0] - g_half, y_floor, focus[2] + off]), np.array([focus[0] + g_half, y_floor, focus[2] + off])))
        grid.append((np.array([focus[0] + off, y_floor, focus[2] - g_half]), np.array([focus[0] + off, y_floor, focus[2] + g_half])))
    return focus, orbit_r, cam_d, grid


def _compose_frame(vp, labels, exo_im, ego_im, scene, scores, phase_txt, bar_alpha, width, height, pad, left_w, hdr_h, img_h, vp_x, vp_y, fonts):
    f_title, f_small, f_tiny = fonts
    im = Image.new("RGB", (width, height), COL_BG)
    dr = ImageDraw.Draw(im)
    y_exo = pad
    y_ego = y_exo + hdr_h + img_h + pad
    y_bar = y_ego + hdr_h + img_h + pad
    bar_h = max(36, height - pad - y_bar)
    for rx, ry, rw, rh in ((pad, y_exo, left_w, hdr_h + img_h), (pad, y_ego, left_w, hdr_h + img_h), (pad, y_bar, left_w, bar_h), (vp_x, vp_y, vp.shape[1] + 2, vp.shape[0] + 2)):
        dr.rounded_rectangle((rx, ry, rx + rw, ry + rh), radius=8, fill=COL_CARD, outline=COL_BORDER, width=1)
    im.paste(Image.fromarray(exo_im), (pad + 1, y_exo + hdr_h - 1))
    im.paste(Image.fromarray(ego_im), (pad + 1, y_ego + hdr_h - 1))
    im.paste(Image.fromarray(vp), (vp_x + 1, vp_y + 1))
    dr = ImageDraw.Draw(im)
    dr.text((pad + 10, y_exo + max(3, (hdr_h - 14) // 2)), "EXO VIEW  (3rd-person)", fill=COL_EXO, font=f_small)
    dr.text((pad + 10, y_ego + max(3, (hdr_h - 14) // 2)), "EGO VIEW  (1st-person)", fill=COL_EGO, font=f_small)
    dr.text((pad + 10, y_bar + 5), "EGORAY READOUT  (lower = better)", fill=COL_MUTED, font=f_tiny)
    ranked = sorted(zip(scene["cands"], scores["angle"], scores["score"]), key=lambda x: x[2])[:4]
    max_s = max([r[2] for r in ranked if np.isfinite(r[2])] + [1.0])
    row_y = y_bar + 22
    row_step = max(13, (bar_h - 26) // max(len(ranked), 1))
    bx0 = pad + min(48, left_w // 5)
    bx1 = max(bx0 + 24, pad + left_w - min(88, left_w // 3))
    for cid, ang, sc in ranked:
        if row_y + 11 > y_bar + bar_h - 2:
            break
        is_w = int(cid) == scene["wearer"]
        lbl = f"#{cid}*" if is_w else f"#{cid}"
        dr.text((pad + 10, row_y), lbl, fill=COL_WEARER if is_w else COL_TEXT, font=f_tiny)
        dr.rounded_rectangle((bx0, row_y + 2, bx1, row_y + 10), radius=3, fill=(32, 39, 52))
        frac = float(np.clip(sc / max(max_s, 1e-6), 0.05, 1.0)) * float(bar_alpha)
        bw = max(4, int(round((bx1 - bx0) * frac)))
        dr.rounded_rectangle((bx0, row_y + 2, bx0 + bw, row_y + 10), radius=3, fill=COL_WEARER if is_w else (140, 92, 98))
        val = f"{ang:.1f}° · {sc:.2f}" if bar_alpha > 0.1 else "..."
        dr.text((bx1 + 6, row_y), val, fill=COL_WEARER if is_w else COL_MUTED, font=f_tiny)
        row_y += row_step
    px, py = vp_x + 12, vp_y + 10
    pill_w = min(vp.shape[1] - 24, max(200, len(phase_txt) * 8 + 26))
    dr.rounded_rectangle((px, py, px + pill_w, py + 26), radius=13, fill=(14, 18, 26), outline=COL_BORDER, width=1)
    dr.text((px + 12, py + 5), phase_txt, fill=COL_TEXT, font=f_title)
    if vp.shape[1] >= 580:
        lx = vp_x + vp.shape[1] - 312
        if lx > px + pill_w + 10:
            dr.rounded_rectangle((lx, py, vp_x + vp.shape[1] - 10, py + 26), radius=13, fill=(14, 18, 26), outline=COL_BORDER, width=1)
            cx_leg = lx + 12
            for name, col in (("Exo", COL_EXO), ("Ego", COL_EGO), ("Wearer", COL_WEARER), ("Other", COL_OTHER)):
                dr.ellipse((cx_leg, py + 8, cx_leg + 9, py + 17), fill=col)
                dr.text((cx_leg + 13, py + 6), name, fill=COL_MUTED, font=f_tiny)
                cx_leg += 72
    placed = []
    ordered_labels = sorted(labels, key=lambda x: 1 if x[2].startswith("#") else 0)
    for lx_i, ly_i, txt, col, (ox, oy) in ordered_labels:
        tw = max(32 if txt.startswith("#") else 56, len(txt) * 7 + 12)
        tx = int(np.clip(vp_x + lx_i + ox, vp_x + 8, vp_x + vp.shape[1] - tw - 8))
        ty = int(np.clip(vp_y + ly_i + oy, vp_y + 42, vp_y + vp.shape[0] - 24))
        for px0, py0, px1, py1 in placed:
            if not (tx + tw + 4 < px0 or tx > px1 + 4 or ty + 20 < py0 or ty > py1 + 4):
                ty = min(vp_y + vp.shape[0] - 24, py1 + 4)
        placed.append((tx, ty, tx + tw, ty + 18))
        dr.rounded_rectangle((tx, ty, tx + tw, ty + 18), radius=5, fill=(14, 18, 26), outline=col, width=1)
        dr.text((tx + 6, ty + 3), txt, fill=col, font=f_tiny)
    return np.asarray(im)


def render_animation(scene, exo, ego, q, regs, scores, uv_exo, uv_ego, out_path, width=960, height=480, frames=135, fps=15, ss=1.5, still_path=None):
    pad = max(8, int(round(min(width, height) * 0.021)))
    left_w = max(210, int(round(width * 0.31)))
    hdr_h = max(20, int(round(height * 0.044)))
    bar_min = max(72, int(round(height * 0.19)))
    img_h = max(72, (height - 4 * pad - 2 * hdr_h - bar_min) // 2)
    vp_x = pad + left_w + pad
    vp_y = pad
    vp_w = width - vp_x - pad
    vp_h = height - 2 * pad
    base_exo, ann_exo, base_ego, ann_ego = _prepare_exo_cards(exo, ego, q, regs, scene["wearer"], uv_exo, uv_ego, left_w - 2, img_h)
    focus, orbit_r, cam_d, grid_pts = _scene_rig(scene)
    f_scale = min(1.0, height / 520.0)
    fonts = (_font(max(10, int(round(13 * f_scale))), True), _font(max(9, int(round(12 * f_scale))), True), _font(max(9, int(round(11 * f_scale))), False))
    exo_dir = unit(np.zeros(3) - focus)
    base_az = math.atan2(exo_dir[0], exo_dir[2])
    base_el = math.asin(np.clip(-exo_dir[1], -0.85, 0.85))
    out_frames = []
    still_idx = int(round(frames * 0.72))
    for k in range(frames):
        u = k / max(frames, 1)
        if u < 0.22:
            p = _ease(u / 0.22)
            az = base_az + math.radians(15.0) * p
            el = base_el + math.radians(11.0) * p
            rad = float(np.linalg.norm(focus)) * (1.0 - p) + orbit_r * p
            exo_cam_a, ego_a, mask_a, ray_p, bar_a = p, 0.0, 0.0, 0.0, 0.0
            phase_txt = "1/4  3D Scene Reconstruction"
        elif u < 0.44:
            p = _ease((u - 0.22) / 0.22)
            az = base_az + math.radians(15.0 + 9.0 * p)
            el = base_el + math.radians(11.0 + 5.0 * p)
            rad = orbit_r
            exo_cam_a, ego_a, mask_a, ray_p, bar_a = 1.0, p, _ease(max(0.0, (p - 0.65) / 0.35)) * 0.5, 0.0, 0.0
            phase_txt = "2/4  Exo + Ego Relative Pose"
        elif u < 0.84:
            p = _ease((u - 0.44) / 0.40)
            az = base_az + math.radians(24.0 - 42.0 * p)
            el = base_el + math.radians(16.0 - 3.0 * p)
            rad = orbit_r * (1.0 - 0.04 * math.sin(math.pi * p))
            exo_cam_a, ego_a = 1.0, 1.0
            mask_a = 0.5 + 0.5 * _ease(min(1.0, p * 3.0))
            ray_p = _ease(min(1.0, max(0.0, (p - 0.08) / 0.48)))
            bar_a = _ease(min(1.0, max(0.0, (p - 0.22) / 0.40)))
            phase_txt = f"3/4  EgoRay Epipole -> Wearer #{scene['wearer']}"
        else:
            p = _ease((u - 0.84) / 0.16)
            az = base_az + math.radians(-18.0 * (1.0 - p))
            el = base_el + math.radians(13.0 * (1.0 - p))
            rad = orbit_r * (1.0 - p) + float(np.linalg.norm(focus)) * p
            fade = 1.0 - _ease(max(0.0, (p - 0.50) / 0.50))
            exo_cam_a, ego_a, mask_a, ray_p, bar_a = fade, fade, fade, fade, fade
            phase_txt = f"4/4  Wearer #{scene['wearer']} Identified"
        el = float(np.clip(el, math.radians(-25.0), math.radians(48.0)))
        eye = focus + rad * np.array([math.cos(el) * math.sin(az), -math.sin(el), math.cos(el) * math.cos(az)], np.float64)
        R_cam, t_cam = _look_at(eye, focus)
        vp, labels = _render_viewport(scene, R_cam, t_cam, vp_w - 2, vp_h - 2, ss, mask_a, ego_a, ray_p, exo_cam_a, grid_pts, cam_d)
        exo_im = cv2.addWeighted(base_exo, 1.0 - mask_a, ann_exo, mask_a, 0.0)
        ego_im = cv2.addWeighted(base_ego, 1.0 - mask_a, ann_ego, mask_a, 0.0)
        frame = _compose_frame(vp, labels, exo_im, ego_im, scene, scores, phase_txt, bar_a, width, height, pad, left_w, hdr_h, img_h, vp_x, vp_y, fonts)
        out_frames.append(frame)
        if still_path and k == still_idx:
            Path(still_path).parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(frame).save(str(still_path))
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".gif":
        pil_frames = [Image.fromarray(fr).quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE) for fr in out_frames]
        pil_frames[0].save(str(out), save_all=True, append_images=pil_frames[1:], duration=int(round(1000 / fps)), loop=0, optimize=True)
    else:
        try:
            import imageio.v2 as imageio

            imageio.mimsave(str(out), out_frames, fps=fps, macro_block_size=8)
        except Exception:
            wr = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), float(fps), (width, height))
            for fr in out_frames:
                wr.write(cv2.cvtColor(fr, cv2.COLOR_RGB2BGR))
            wr.release()
    return str(out)
