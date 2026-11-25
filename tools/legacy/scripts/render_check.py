"""按 BP 的 permutation 实际选择（geometry + material_instances + transformation）渲染等轴测自检图。
   与游戏内所见一致：z-buffer 深度测试、opaque 面背面剔除、blend 面双面；
   UV 按 Bedrock 面约定采样；面顶点顺序 TL/TR/BL/BR。
"""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources/addon/LitematicaBE_RP")
BP = os.path.join(ROOT, "resources/addon/LitematicaBE_BP")
OUT = os.path.join(ROOT, "work/render")

TERRAIN = json.load(open(os.path.join(RP, "textures/terrain_texture.json"), encoding="utf-8"))["texture_data"]
MODELS = {}
for fn in os.listdir(os.path.join(RP, "models/blocks")):
    if fn.endswith(".json"):
        g = json.load(open(os.path.join(RP, "models/blocks", fn), encoding="utf-8"))
        MODELS[g["minecraft:geometry"][0]["description"]["identifier"]] = g["minecraft:geometry"][0]

_tex = {}
def texture(name):
    ent = TERRAIN[name]
    path = ent["textures"] if isinstance(ent["textures"], str) else ent["textures"][0]
    p = os.path.join(RP, path + ".png")
    if p not in _tex:
        _tex[p] = np.array(Image.open(p).convert("RGBA"), dtype=np.float32) / 255.0
    return _tex[p]

def corners(face, x1, y1, z1, x2, y2, z2):
    return {
        "north": [(x2, y2, z1), (x1, y2, z1), (x2, y1, z1), (x1, y1, z1)],
        "south": [(x1, y2, z2), (x2, y2, z2), (x1, y1, z2), (x2, y1, z2)],
        "west": [(x1, y2, z1), (x1, y2, z2), (x1, y1, z1), (x1, y1, z2)],
        "east": [(x2, y2, z2), (x2, y2, z1), (x2, y1, z2), (x2, y1, z1)],
        "up": [(x1, y2, z2), (x2, y2, z2), (x1, y2, z1), (x2, y2, z1)],
        "down": [(x1, y1, z1), (x2, y1, z1), (x1, y1, z2), (x2, y1, z2)],
    }[face]

NORMAL = {"north": (0, 0, -1), "south": (0, 0, 1), "west": (-1, 0, 0),
          "east": (1, 0, 0), "up": (0, 1, 0), "down": (0, -1, 0)}
SHADE = {"up": 1.0, "down": 0.62, "north": 0.74, "south": 0.92, "west": 0.8, "east": 0.68}

CAM = np.array([1.0, 0.9, 1.0]); CAM /= np.linalg.norm(CAM)
D = -CAM
RIGHT = np.cross([0.0, 1.0, 0.0], D); RIGHT /= np.linalg.norm(RIGHT)
UP2 = np.cross(D, RIGHT)

def rot_y(p, deg, center=(8, 8)):
    if deg % 360 == 0:
        return p
    th = math.radians(deg)
    c, s = math.cos(th), math.sin(th)
    x, y, z = p
    dx, dz = x - center[0], z - center[1]
    return (center[0] + dx * c + dz * s, y, center[1] - dx * s + dz * c)

def render(block_file, match, yaw, S=22):
    blk = json.load(open(os.path.join(BP, "blocks", block_file), encoding="utf-8"))["minecraft:block"]
    perm = None
    for p in blk.get("permutations", []):
        if all(f"'{k}') == {v}" in p["condition"] for k, v in match.items()):
            perm = p
            break
    if perm is None:
        raise SystemExit(f"no permutation for {match}")
    comp = perm["components"]
    geo = MODELS[comp["minecraft:geometry"]]
    mats = comp.get("minecraft:material_instances") or blk["components"]["minecraft:material_instances"]

    faces = []
    for c in geo["bones"][0]["cubes"]:
        x1, y1, z1 = c["origin"][0] + 8, c["origin"][1], c["origin"][2] + 8
        x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
        for fname, fd in c["uv"].items():
            inst = fd.get("material_instance", "*")
            mm = mats.get(inst, mats["*"])
            pts = [rot_y(p, yaw) for p in corners(fname, x1, y1, z1, x2, y2, z2)]
            n = np.array(rot_y(NORMAL[fname], yaw), dtype=float)
            faces.append({"pts": pts, "n": n, "uv": fd["uv"], "uvs": fd["uv_size"],
                          "tex": mm["texture"], "method": mm.get("render_method", "opaque"), "face": fname})

    proj = lambda p: np.array([np.dot(p, RIGHT), -np.dot(p, UP2)]) * S
    allp = np.array([proj(p) for f in faces for p in f["pts"]])
    mn = allp.min(axis=0); mx = allp.max(axis=0)
    pad = 10
    W, H = int(mx[0] - mn[0]) + pad * 2, int(mx[1] - mn[1]) + pad * 2
    img = np.ones((H, W, 4), dtype=np.float32); img[..., :3] = 0.985
    zbuf = np.full((H, W), -1e9, dtype=np.float32)

    for f in faces:
        if f["method"] == "opaque" and np.dot(f["n"], CAM) <= 0.001:
            continue
        P = np.array([proj(p) - mn + pad for p in f["pts"]])
        dep = np.array([np.dot(np.array(p, dtype=float), CAM) for p in f["pts"]])
        p0, p1, p2 = P[0], P[1], P[2]
        e1, e2 = p1 - p0, p2 - p0
        det = e1[0] * e2[1] - e1[1] * e2[0]
        if abs(det) < 1e-9:
            continue
        bx0 = max(int(np.floor(P[:, 0].min())), 0); bx1 = min(int(np.ceil(P[:, 0].max())) + 1, W)
        by0 = max(int(np.floor(P[:, 1].min())), 0); by1 = min(int(np.ceil(P[:, 1].max())) + 1, H)
        if bx1 <= bx0 or by1 <= by0:
            continue
        xs = np.arange(bx0, bx1) + 0.5
        ys = np.arange(by0, by1) + 0.5
        qx = xs[None, :] - p0[0]
        qz = ys[:, None] - p0[1]
        a = (qx * e2[1] - qz * e2[0]) / det
        b = (e1[0] * qz - e1[1] * qx) / det
        mask = (a >= -0.004) & (a <= 1.004) & (b >= -0.004) & (b <= 1.004)
        if not mask.any():
            continue
        tex = texture(f["tex"]); th, tw = tex.shape[:2]
        u = f["uv"][0] + a * f["uvs"][0]
        v = f["uv"][1] + b * f["uvs"][1]
        ui = np.clip((u - 0.5).astype(int), 0, tw - 1)
        vi = np.clip((v - 0.5).astype(int), 0, th - 1)
        col = tex[vi, ui]
        pdepth = dep[0] + a * (dep[1] - dep[0]) + b * (dep[2] - dep[0])
        sub_d = zbuf[by0:by1, bx0:bx1]
        alpha = col[..., 3] * mask
        write = (alpha > 0.004) & (pdepth >= sub_d - 1e-6)
        if not write.any():
            continue
        sub_d[write] = pdepth[write]
        zbuf[by0:by1, bx0:bx1] = sub_d
        rgb = col[..., :3] * SHADE[f["face"]]
        w = write[..., None]
        sub = img[by0:by1, bx0:bx1]
        sub[..., :3] = np.where(w, sub[..., :3] * (1 - alpha[..., None]) + rgb * alpha[..., None], sub[..., :3])
        img[by0:by1, bx0:bx1] = sub
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")

def grid(tiles, cols, title, path):
    pad, capH = 16, 30
    cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
    rows = (len(tiles) + cols - 1) // cols
    W = cols * cw + (cols + 1) * pad
    H = 56 + rows * (ch + capH + pad) + pad
    out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
    dr = ImageDraw.Draw(out)
    fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 24)
    fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
    dr.text((pad, 16), title, font=fT, fill=(26, 26, 36, 255))
    for i, (im, cap) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad); y = 56 + pad + r * (ch + capH + pad)
        bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
        bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
        out.paste(bg, (x, y))
        dr.text((x + 10, y + ch + 3), cap, font=fC, fill=(52, 52, 68, 255))
    out.save(path)
    print("saved", path)

def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = []
    for delay in range(4):
        for powered in (0, 1):
            im = render("g_repeater.json", {"lit:dir": 0, "lit:delay": delay, "lit:powered": powered}, 0)
            tiles.append((im, f"中继器 · {delay + 1} 档 · {'激活' if powered else '未激活'}"))
    grid(tiles, 4, "中继器 · 等轴测自检（lit:dir=0，按 BP permutation 实渲染）", os.path.join(OUT, "check_repeater.png"))

    tiles = []
    for mode in (0, 1):
        for powered in (0, 1):
            im = render("g_comparator.json", {"lit:dir": 0, "lit:mode": mode, "lit:powered": powered}, 0)
            tiles.append((im, f"比较器 · {'减法' if mode else '比较'}模式 · {'激活' if powered else '未激活'}"))
    grid(tiles, 2, "比较器 · 等轴测自检（lit:dir=0）", os.path.join(OUT, "check_comparator.png"))

    tiles = []
    for dv in range(4):
        im = render("g_repeater.json", {"lit:dir": dv, "lit:delay": 0, "lit:powered": 0}, dv * 90)
        tiles.append((im, f"lit:dir={dv} → 模型旋转 {dv * 90}°"))
    grid(tiles, 4, "朝向验证 · 中继器 1 档（dir 0–3）", os.path.join(OUT, "check_dirs.png"))

main()
