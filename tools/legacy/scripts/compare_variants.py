"""对比两种火把布局：A=输出端固定(原数据) / B=交换(输出端随档位动)。不写入项目资源。"""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources/addon/LitematicaBE_RP")
OUT = os.path.join(ROOT, "work/render")
SHAPE = json.load(open(r"C:/Users/25491/Desktop/建模对应清单/shape_models.json", encoding="utf-8"))["repeater"]
TERRAIN = json.load(open(os.path.join(RP, "textures/terrain_texture.json"), encoding="utf-8"))["texture_data"]

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
MATS = {"*": "ghost_comp_slab", "top": "ghost_repeater_off", "torch": "ghost_rtorch_off", "lamp": "ghost_rtorch_off"}

def pick(delay, variant):
    out = []
    for c in SHAPE:
        if c.get("if") and c["if"] != f"repeater_delay == {delay}":
            continue
        c = dict(c)
        if c.get("terrainTexture") and c.get("translate"):
            t = list(c["translate"])
            if variant == "B":
                t[2] = 8 - 2 * delay if c.get("if") else 12
            out.append({**c, "translate": t})
        else:
            out.append(c)
    return out

def render(cubes, S=24):
    faces = []
    for c in cubes:
        t = c.get("translate") or [0, 0, 0]
        x1 = c["pos"][0] - 8 + t[0] + 8; y1 = c["pos"][1] + t[1]; z1 = c["pos"][2] - 8 + t[2] + 8
        x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
        faces.append((c, x1, y1, z1, x2, y2, z2))

    polys = []
    for c, x1, y1, z1, x2, y2, z2 in faces:
        # 面 UV（与生成器一致：缺省投影法）
        pos = c["pos"]; size = c["size"]
        def defuv(face):
            p, s = pos, size
            d = {
                "west": ([p[2], 16 - p[1] - s[1]], [s[2], s[1]]),
                "east": ([16 - p[2] - s[2], 16 - p[1] - s[1]], [s[2], s[1]]),
                "down": ([p[0], 16 - p[2] - s[2]], [s[0], s[2]]),
                "up": ([p[0], 16 - p[2] - s[2]], [s[0], s[2]]),
                "north": ([16 - p[0] - s[0], 16 - p[1] - s[1]], [s[0], s[1]]),
                "south": ([p[0], 16 - p[1] - s[1]], [s[0], s[1]]),
            }
            return d[face]
        for face in ["north", "south", "east", "west", "up", "down"]:
            # 只保留可见面（零厚度）
            if size[0] == 0 and face != "west": continue
            if size[1] == 0 and face != "down": continue
            if size[2] == 0 and face != "north": continue
            uv0, uvs = defuv(face)
            key = c.get("uv") or {}
            u = key.get(face) or (key.get("side") if face in ("north", "south", "east", "west") else None) or key.get("*")
            if u:
                uv0, uvs = u, uvs
            inst = (c.get("terrainTexture") and ("torch")) or ("top" if face == "up" else "*")
            if not c.get("terrainTexture") and face == "up":
                inst = "top"
            if c.get("terrainTexture"):
                inst = "torch"
            # UV 越界裁剪
            if uv0[1] < 0 and uvs[1] > 0 and face not in ("up", "down"):
                cut = -uv0[1]
                if size[1] - cut <= 0: continue
                # 只裁几何
                pass
            polys.append((face, corners(face, x1, y1, z1, x2, y2, z2), uv0, uvs, MATS[inst]))

    proj = lambda p: np.array([np.dot(p, RIGHT), -np.dot(p, UP2)]) * S
    allp = np.array([proj(p) for _, c, _, _, _ in polys for p in c])
    mn, mx = allp.min(0), allp.max(0)
    pad = 10
    W, H = int(mx[0] - mn[0]) + pad * 2, int(mx[1] - mn[1]) + pad * 2
    img = np.ones((H, W, 4), np.float32); img[..., :3] = 0.985
    zb = np.full((H, W), -1e9, np.float32)
    for face, pts, uv0, uvs, texn in polys:
        P = np.array([proj(p) - mn + pad for p in pts])
        dep = np.array([np.dot(np.array(p, float), CAM) for p in pts])
        p0, p1, p2 = P[0], P[1], P[2]
        e1, e2 = p1 - p0, p2 - p0
        det = e1[0] * e2[1] - e1[1] * e2[0]
        if abs(det) < 1e-9: continue
        bx0 = max(int(np.floor(P[:, 0].min())), 0); bx1 = min(int(np.ceil(P[:, 0].max())) + 1, W)
        by0 = max(int(np.floor(P[:, 1].min())), 0); by1 = min(int(np.ceil(P[:, 1].max())) + 1, H)
        if bx1 <= bx0 or by1 <= by0: continue
        xs = np.arange(bx0, bx1) + 0.5; ys = np.arange(by0, by1) + 0.5
        qx = xs[None, :] - p0[0]; qz = ys[:, None] - p0[1]
        a = (qx * e2[1] - qz * e2[0]) / det
        b = (e1[0] * qz - e1[1] * qx) / det
        mask = (a >= -0.004) & (a <= 1.004) & (b >= -0.004) & (b <= 1.004)
        tex = texture(texn); th, tw = tex.shape[:2]
        u = uv0[0] + a * uvs[0]; v = uv0[1] + b * uvs[1]
        if v.min() < 0 or v.max() > th or u.min() < 0 or u.max() > tw:
            pass
        ui = np.clip((u - 0.5).astype(int), 0, tw - 1); vi = np.clip((v - 0.5).astype(int), 0, th - 1)
        col = tex[vi, ui]
        pd = dep[0] + a * (dep[1] - dep[0]) + b * (dep[2] - dep[0])
        sub = zb[by0:by1, bx0:bx1]
        alpha = col[..., 3] * mask
        wr = (alpha > 0.004) & (pd >= sub - 1e-6)
        if not wr.any(): continue
        sub[wr] = pd[wr]; zb[by0:by1, bx0:bx1] = sub
        rgb = col[..., :3] * SHADE[face]
        w = wr[..., None]
        dst = img[by0:by1, bx0:bx1]
        dst[..., :3] = np.where(w, dst[..., :3] * (1 - alpha[..., None]) + rgb * alpha[..., None], dst[..., :3])
        img[by0:by1, bx0:bx1] = dst
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")

tiles = []
for variant, vlabel in [("A", "方案A：输出端固定(z=2) / 输入端 6-8-10-12"),
                        ("B", "方案B：输入端固定(z=12) / 输出端 8-6-4-2")]:
    for delay in (0, 3):
        tiles.append((render(pick(delay, variant)), f"{vlabel} · {delay + 1}档"))

pad, capH = 16, 30
cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
cols = 2
rows = 2
W = cols * cw + (cols + 1) * pad
H = 56 + rows * (ch + capH + pad) + pad
out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
dr = ImageDraw.Draw(out)
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 22)
fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
dr.text((pad, 14), "中继器火把布局对比（等轴测，未部署）", font=fT, fill=(26, 26, 36, 255))
for i, (im, cap) in enumerate(tiles):
    r, c = divmod(i, cols)
    x = pad + c * (cw + pad); y = 56 + pad + r * (ch + capH + pad)
    bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
    bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
    out.paste(bg, (x, y))
    dr.text((x + 8, y + ch + 4), cap, font=fC, fill=(52, 52, 68, 255))
p = os.path.join(OUT, "compare_torch_layout.png")
out.save(p)
print("saved", p, out.size)
