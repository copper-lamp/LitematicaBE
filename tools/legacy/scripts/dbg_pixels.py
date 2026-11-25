"""调试：统计每个面实际写入的不透明像素数，找出固定火把为何不可见。"""
import os
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc_mod", "exec"), g)

MODELS = g["MODELS"]; corners = g["corners"]; texture = g["texture"]
NORMAL = g["NORMAL"]; CAM = g["CAM"]; D = g["D"]; RIGHT = g["RIGHT"]; UP2 = g["UP2"]

MATS = {"*": {"texture": "ghost_comp_slab", "render_method": "opaque"},
        "top": {"texture": "ghost_repeater_off", "render_method": "opaque"},
        "torch": {"texture": "ghost_rtorch_off", "render_method": "blend"},
        "lamp": {"texture": "ghost_rtorch_off", "render_method": "blend"}}

geo = MODELS["geometry.lit_repeater"]
faces = []
for ci, c in enumerate(geo["bones"][0]["cubes"]):
    x1, y1, z1 = c["origin"][0] + 8, c["origin"][1], c["origin"][2] + 8
    x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
    for fname, fd in c["uv"].items():
        inst = fd.get("material_instance", "*")
        mm = MATS.get(inst, MATS["*"])
        pts = corners(fname, x1, y1, z1, x2, y2, z2)
        faces.append({"ci": ci, "face": fname, "pts": pts, "n": np.array(NORMAL[fname], float),
                      "uv": fd["uv"], "uvs": fd["uv_size"], "tex": mm["texture"],
                      "method": mm.get("render_method", "opaque")})

proj = lambda p: np.array([np.dot(p, RIGHT), -np.dot(p, UP2)]) * 26
order = sorted(range(len(faces)), key=lambda i: np.mean([np.dot(p, D) for p in faces[i]["pts"]]))
print(f"{'idx':>3} {'cube':>4} {'face':6} {'depth':>7} {'vis':>4} {'px':>6}")
for i in order:
    f = faces[i]
    depth = float(np.mean([np.dot(p, D) for p in f["pts"]]))
    vis = not (f["method"] == "opaque" and np.dot(f["n"], CAM) <= 0.001)
    P = np.array([proj(p) for p in f["pts"]])
    p0, p1, p2 = P[0], P[1], P[2]
    e1, e2 = p1 - p0, p2 - p0
    det = e1[0] * e2[1] - e1[1] * e2[0]
    cnt = 0
    if abs(det) > 1e-9:
        xs = np.arange(int(np.floor(P[:, 0].min())), int(np.ceil(P[:, 0].max())) + 1) + 0.5
        ys = np.arange(int(np.floor(P[:, 1].min())), int(np.ceil(P[:, 1].max())) + 1) + 0.5
        qx = xs[None, :] - p0[0]; qz = ys[:, None] - p0[1]
        a = (qx * e2[1] - qz * e2[0]) / det
        b = (e1[0] * qz - e1[1] * qx) / det
        mask = (a >= -0.004) & (a <= 1.004) & (b >= -0.004) & (b <= 1.004)
        tex = texture(f["tex"]); th, tw = tex.shape[:2]
        u = f["uv"][0] + a * f["uvs"][0]; v = f["uv"][1] + b * f["uvs"][1]
        ui = np.clip((u - 0.5).astype(int), 0, tw - 1); vi = np.clip((v - 0.5).astype(int), 0, th - 1)
        cnt = int(((tex[vi, ui][..., 3] > 0.004) & mask).sum())
    print(f"{i:>3} {f['ci']:>4} {f['face']:6} {depth:>7.2f} {str(vis):>4} {cnt:>6}")
