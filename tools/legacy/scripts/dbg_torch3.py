"""调试：火把组合（不含底座）与含底座的对比。"""
import os
import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc_mod", "exec"), g)

exec(open(os.path.join(here, "dbg_torch2.py"), encoding="utf-8").read().split("MATS =")[0].split("here = os.path.dirname")[0], g) if False else None

# 复用 dbg_torch2 的 render_cubes：直接再定义一次精简版
MODELS = g["MODELS"]; corners = g["corners"]; texture = g["texture"]
NORMAL = g["NORMAL"]; SHADE = g["SHADE"]; CAM = g["CAM"]; D = g["D"]; RIGHT = g["RIGHT"]; UP2 = g["UP2"]

def render_cubes(model_id, idxs, mats, S=26):
    geo = MODELS[model_id]
    faces = []
    for i in idxs:
        c = geo["bones"][0]["cubes"][i]
        x1, y1, z1 = c["origin"][0] + 8, c["origin"][1], c["origin"][2] + 8
        x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
        for fname, fd in c["uv"].items():
            inst = fd.get("material_instance", "*")
            mm = mats.get(inst, mats["*"])
            faces.append({"pts": [corners(fname, x1, y1, z1, x2, y2, z2)][0], "n": np.array(NORMAL[fname], float),
                          "uv": fd["uv"], "uvs": fd["uv_size"], "tex": mm["texture"],
                          "method": mm.get("render_method", "opaque"), "face": fname})
    proj = lambda p: np.array([np.dot(p, RIGHT), -np.dot(p, UP2)]) * S
    allp = np.array([proj(p) for f in faces for p in f["pts"]])
    mn, mx = allp.min(0), allp.max(0)
    pad = 12
    W, H = int(mx[0] - mn[0]) + pad * 2, int(mx[1] - mn[1]) + pad * 2
    img = np.ones((H, W, 4), np.float32); img[..., :3] = 0.985
    order = sorted(range(len(faces)), key=lambda i: np.mean([np.dot(p, D) for p in faces[i]["pts"]]))
    for i in order:
        f = faces[i]
        if f["method"] == "opaque" and np.dot(f["n"], CAM) <= 0.001:
            continue
        P = np.array([proj(p) - mn + pad for p in f["pts"]])
        p0, p1, p2 = P[0], P[1], P[2]
        e1, e2 = p1 - p0, p2 - p0
        det = e1[0] * e2[1] - e1[1] * e2[0]
        if abs(det) < 1e-9:
            continue
        bx0 = max(int(np.floor(P[:, 0].min())), 0); bx1 = min(int(np.ceil(P[:, 0].max())) + 1, W)
        by0 = max(int(np.floor(P[:, 1].min())), 0); by1 = min(int(np.ceil(P[:, 1].max())) + 1, H)
        if bx1 <= bx0 or by1 <= by0:
            continue
        xs = np.arange(bx0, bx1) + 0.5; ys = np.arange(by0, by1) + 0.5
        qx = xs[None, :] - p0[0]; qz = ys[:, None] - p0[1]
        a = (qx * e2[1] - qz * e2[0]) / det
        b = (e1[0] * qz - e1[1] * qx) / det
        mask = (a >= -0.004) & (a <= 1.004) & (b >= -0.004) & (b <= 1.004)
        if not mask.any():
            continue
        tex = texture(f["tex"]); th, tw = tex.shape[:2]
        u = f["uv"][0] + a * f["uvs"][0]; v = f["uv"][1] + b * f["uvs"][1]
        ui = np.clip((u - 0.5).astype(int), 0, tw - 1); vi = np.clip((v - 0.5).astype(int), 0, th - 1)
        col = tex[vi, ui]
        alpha = col[..., 3] * mask
        rgb = col[..., :3] * SHADE[f["face"]]
        sub = img[by0:by1, bx0:bx1]
        sub[..., :3] = sub[..., :3] * (1 - alpha[..., None]) + rgb * alpha[..., None]
        img[by0:by1, bx0:bx1] = sub
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA"), [(f["face"], f["method"], float(np.mean([np.dot(p, D) for p in f["pts"]]))) for f in faces]

MATS = {"*": {"texture": "ghost_comp_slab", "render_method": "opaque"},
        "top": {"texture": "ghost_repeater_off", "render_method": "opaque"},
        "torch": {"texture": "ghost_rtorch_off", "render_method": "blend"},
        "lamp": {"texture": "ghost_rtorch_off", "render_method": "blend"}}

out = r"D:\GitHub\LitematicaBE\work\render"
im1, info1 = render_cubes("geometry.lit_repeater", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], MATS)
im1.save(os.path.join(out, "dbg_both_torches.png")); print("saved both", im1.size)
im2, info2 = render_cubes("geometry.lit_repeater", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], MATS)
im2.save(os.path.join(out, "dbg_all.png")); print("saved all", im2.size)
