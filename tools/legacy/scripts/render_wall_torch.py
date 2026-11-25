"""渲染墙挂火把（带 cube rotation 的斜插几何），4 个朝向。"""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources/addon/LitematicaBE_RP")
OUT = os.path.join(ROOT, "work/render")
S = 30

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

def apply_rot(p, rot, pivot):
    if not rot or (rot[0] == 0 and rot[1] == 0 and rot[2] == 0):
        return p
    x, y, z = p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]
    # X
    rx = math.radians(rot[0])
    if rx:
        y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    # Y
    ry = math.radians(rot[1])
    if ry:
        x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    # Z
    rz = math.radians(rot[2])
    if rz:
        x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (x + pivot[0], y + pivot[1], z + pivot[2])

def render(model_file, tex_name, yaw, S=S):
    g = json.load(open(os.path.join(RP, "models/blocks", model_file), encoding="utf-8"))
    cubes = g["minecraft:geometry"][0]["bones"][0]["cubes"]
    th = math.radians(yaw)
    def yaw_rot(p):
        x, z = p[0] - 8, p[2] - 8
        return (8 + x * math.cos(th) + z * math.sin(th), p[1], 8 - x * math.sin(th) + z * math.cos(th))

    faces = []
    for c in cubes:
        x1, y1, z1 = c["origin"][0] + 8, c["origin"][1], c["origin"][2] + 8
        x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
        rot = c.get("rotation"); piv = c.get("pivot")
        for fname in c["uv"]:
            pts = [yaw_rot(apply_rot(p, rot, piv)) for p in corners(fname, x1, y1, z1, x2, y2, z2)]
            faces.append({"pts": pts, "uv": c["uv"][fname]["uv"], "uvs": c["uv"][fname]["uv_size"],
                          "face": fname, "tex": tex_name})

    proj = lambda p: np.array([np.dot(p, RIGHT), -np.dot(p, UP2)]) * S
    allp = np.array([proj(p) for f in faces for p in f["pts"]])
    mn, mx = allp.min(0), allp.max(0)
    pad = 12
    W, H = int(mx[0] - mn[0]) + pad * 2, int(mx[1] - mn[1]) + pad * 2
    img = np.ones((H, W, 4), np.float32); img[..., :3] = 0.985
    zb = np.full((H, W), -1e9, np.float32)
    for f in faces:
        P = np.array([proj(p) - mn + pad for p in f["pts"]])
        dep = np.array([np.dot(np.array(p, float), CAM) for p in f["pts"]])
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
        tex = texture(f["tex"]); th2, tw = tex.shape[:2]
        u = f["uv"][0] + a * f["uvs"][0]; v = f["uv"][1] + b * f["uvs"][1]
        ui = np.clip((u - 0.5).astype(int), 0, tw - 1); vi = np.clip((v - 0.5).astype(int), 0, th2 - 1)
        col = tex[vi, ui]
        pd = dep[0] + a * (dep[1] - dep[0]) + b * (dep[2] - dep[0])
        sub = zb[by0:by1, bx0:bx1]
        alpha = col[..., 3] * mask
        wr = (alpha > 0.004) & (pd >= sub - 1e-6)
        if not wr.any(): continue
        sub[wr] = pd[wr]; zb[by0:by1, bx0:bx1] = sub
        rgb = col[..., :3] * SHADE[f["face"]]
        w = wr[..., None]
        dst = img[by0:by1, bx0:bx1]
        dst[..., :3] = np.where(w, dst[..., :3] * (1 - alpha[..., None]) + rgb * alpha[..., None], dst[..., :3])
        img[by0:by1, bx0:bx1] = dst
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")

tiles = []
for yaw, name in [(0, "朝东 0°"), (90, "朝南 90°"), (180, "朝西 180°"), (270, "朝北 270°")]:
    tiles.append((render("lit_torch_wall.json", "ghost_torch", yaw), f"普通火把 · {name}"))
for yaw, name in [(0, "朝东 0°"), (90, "朝南 90°")]:
    tiles.append((render("lit_redstone_torch_wall.json", "ghost_rtorch_off", yaw), f"红石火把 · {name}"))

pad, capH = 14, 30
cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
cols = 3
rows = 2
W = cols * cw + (cols + 1) * pad
H = 56 + rows * (ch + capH + pad) + pad
out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
dr = ImageDraw.Draw(out)
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 21)
fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
dr.text((pad, 14), "墙挂火把 · 斜插（绕底部倾斜 21.8°，仿原版 transform）", font=fT, fill=(26, 26, 36, 255))
for i, (im, cap) in enumerate(tiles):
    r, c = divmod(i, cols)
    x = pad + c * (cw + pad); y = 56 + pad + r * (ch + capH + pad)
    bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
    bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
    out.paste(bg, (x, y))
    dr.text((x + 8, y + ch + 3), cap, font=fC, fill=(52, 52, 68, 255))
p = os.path.join(OUT, "wall_torch_tilt.png")
out.save(p)
print("saved", p, out.size)
