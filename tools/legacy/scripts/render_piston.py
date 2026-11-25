"""活塞伸出态两格建模自检：base（自身格）+ piston_head（朝向相邻格）组合渲染。

复用 work/render_check.py 的光栅化策略（z-buffer + Bedrock 面顶点约定），
额外支持"多方块按格子偏移拼同一个场景"，用于确认：
  · extended=true 时 base 只剩 12/16（顶部空出）
  · head 的臂段从 base 顶面 12 处接上，头板落在相邻格外端 4/16
  · 6 个朝向的旋转方向
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

# 引擎内置满格几何（lit:g_generic 等用的），没有实体 JSON
_full_uv = {f: {"uv": [0, 0], "uv_size": [16, 16]} for f in
            ("north", "south", "east", "west", "up", "down")}
MODELS["minecraft:geometry.full_block"] = {
    "description": {"identifier": "minecraft:geometry.full_block", "texture_width": 16, "texture_height": 16},
    "bones": [{"name": "body", "pivot": [0, 0, 0],
               "cubes": [{"origin": [-8, 0, -8], "size": [16, 16, 16], "uv": _full_uv}]}],
}

_tex = {}
def texture(name):
    ent = TERRAIN[name]
    p = os.path.join(RP, (ent["textures"] if isinstance(ent["textures"], str) else ent["textures"][0]) + ".png")
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

def apply_rot(p, rot, center=(0.0, 8.0, 0.0)):
    """Bedrock transformation.rotation：几何坐标（XZ 以方块中心为 0，Y 以底部为 0），
    旋转中心是方块中心 (0,8,0)，角度为顺时针（左手系，从轴正方向看向原点）。"""
    x, y, z = p[0] - center[0], p[1] - center[1], p[2] - center[2]
    rx, ry, rz = [math.radians(a) for a in rot]
    # Z（左手）
    x, y = x * math.cos(rz) + y * math.sin(rz), -x * math.sin(rz) + y * math.cos(rz)
    # Y（左手）
    x, z = x * math.cos(ry) - z * math.sin(ry), x * math.sin(ry) + z * math.cos(ry)
    # X（左手）
    y, z = y * math.cos(rx) + z * math.sin(rx), -y * math.sin(rx) + z * math.cos(rx)
    return (x + center[0], y + center[1], z + center[2])

def pick_perm(blk, match):
    best = None
    for p in blk.get("permutations", []):
        cond = p["condition"]
        ok = True
        for k, v in match.items():
            tok = f"'{k}') == {v}"
            if tok not in cond:
                ok = False
                break
        if ok:
            best = p  # 后匹配覆盖先匹配（Bedrock 语义）
    return best

def block_faces(block_file, match, offset, yaw=0):
    blk = json.load(open(os.path.join(BP, "blocks", block_file), encoding="utf-8"))["minecraft:block"]
    comp = dict(blk["components"])
    perm = pick_perm(blk, match)
    if perm:
        comp.update(perm["components"])
    geo = MODELS[comp["minecraft:geometry"]]
    mats = comp.get("minecraft:material_instances") or blk["components"]["minecraft:material_instances"]
    rot = (comp.get("minecraft:transformation") or {}).get("rotation", [0, 0, 0])
    faces = []
    for c in geo["bones"][0]["cubes"]:
        # 几何坐标：XZ 以方块中心为 0，Y 以底部为 0
        x1, y1, z1 = c["origin"][0], c["origin"][1], c["origin"][2]
        x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
        for fname, fd in c["uv"].items():
            inst = fd.get("material_instance", "*")
            mm = mats.get(inst, mats["*"])
            pts = []
            for p in corners(fname, x1, y1, z1, x2, y2, z2):
                q = apply_rot(p, rot)
                q = (q[0] + offset[0] * 16, q[1] + offset[1] * 16, q[2] + offset[2] * 16)
                pts.append(q)
            n = np.array(apply_rot(NORMAL[fname], rot, center=(0, 0, 0)), dtype=float)
            n /= (np.linalg.norm(n) or 1)
            faces.append({"pts": pts, "n": n, "uv": fd["uv"], "uvs": fd["uv_size"],
                          "tw": geo["description"]["texture_width"], "th": geo["description"]["texture_height"],
                          "tex": mm["texture"], "method": mm.get("render_method", "opaque"), "face": fname})
    return faces

def render_scene(items, S=20, yaw_deg=0, title="", cam=(1.0, 0.9, 1.0)):
    """items: [(block_file, match, (ox,oy,oz))]"""
    CAM = np.array(cam, dtype=float); CAM = CAM / np.linalg.norm(CAM)
    Dv = -CAM
    RIGHT = np.cross([0.0, 1.0, 0.0], Dv); RIGHT /= np.linalg.norm(RIGHT)
    UP2 = np.cross(Dv, RIGHT)

    faces = []
    for bf, match, off in items:
        faces.extend(block_faces(bf, match, off))

    a = math.radians(yaw_deg)
    ca, sa = math.cos(a), math.sin(a)
    def spin(p):
        return (p[0] * ca + p[2] * sa, p[1], -p[0] * sa + p[2] * ca)
    faces = [dict(f, pts=[spin(p) for p in f["pts"]], n=np.array(spin(tuple(f["n"])))) for f in faces]

    proj = lambda p: np.array([np.dot(p, RIGHT), -np.dot(p, UP2)]) * S
    allp = np.array([proj(p) for f in faces for p in f["pts"]])
    mn = allp.min(axis=0); mx = allp.max(axis=0)
    pad = 12
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
        u = (qx * e2[1] - qz * e2[0]) / det
        v = (e1[0] * qz - e1[1] * qx) / det
        mask = (u >= -0.004) & (u <= 1.004) & (v >= -0.004) & (v <= 1.004)
        if not mask.any():
            continue
        tex = texture(f["tex"]); th, tw = tex.shape[:2]
        # UV 按几何的 texture_width/height 归一化后再映射到该面实际贴图的尺寸
        su = (f["uv"][0] + u * f["uvs"][0]) / f["tw"]
        sv = (f["uv"][1] + v * f["uvs"][1]) / f["th"]
        if f["uvs"][0] < 0:
            su = (f["uv"][0] + (1 - u) * f["uvs"][0]) / f["tw"]
        if f["uvs"][1] < 0:
            sv = (f["uv"][1] + (1 - v) * f["uvs"][1]) / f["th"]
        ui = np.clip((su * tw - 0.5).astype(int), 0, tw - 1)
        vi = np.clip((sv * th - 0.5).astype(int), 0, th - 1)
        col = tex[vi, ui]
        pdepth = dep[0] + u * (dep[1] - dep[0]) + v * (dep[2] - dep[0])
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
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")
    out = Image.new("RGBA", (im.width, im.height + 26), (247, 247, 250, 255))
    out.alpha_composite(im, (0, 26))
    if title:
        d = ImageDraw.Draw(out)
        d.text((8, 4), title, font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17), fill=(30, 30, 40, 255))
    return out

def grid(tiles, cols, title, path):
    pad, capH = 14, 26
    cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
    rows = (len(tiles) + cols - 1) // cols
    W = cols * cw + (cols + 1) * pad
    H = 52 + rows * (ch + capH + pad) + pad
    out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
    dr = ImageDraw.Draw(out)
    dr.text((pad, 14), title, font=ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 22), fill=(26, 26, 36, 255))
    for i, (im, cap) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad); y = 52 + pad + r * (ch + capH + pad)
        bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
        bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
        out.paste(bg, (x, y))
        dr.text((x + 6, y + ch + 2), cap, font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16), fill=(52, 52, 68, 255))
    out.save(path)
    print("saved", path)

DIRS = {0: "down", 1: "up", 2: "north", 3: "south", 4: "west", 5: "east"}
HEAD_OFF = {0: (0, -1, 0), 1: (0, 1, 0), 2: (0, 0, -1), 3: (0, 0, 1), 4: (-1, 0, 0), 5: (1, 0, 0)}

def scene(facing, extended, sticky=0):
    """伸出/收缩现在是两个独立方块（不再靠 lit:extended 切几何），这里要按状态选方块文件。"""
    if extended:
        base_file = "g_sticky_piston_extended.json" if sticky else "g_piston_side_extended.json"
    else:
        base_file = "g_sticky_piston.json" if sticky else "g_piston_side.json"
    items = [(base_file, {"lit:facing": facing}, (0, 0, 0))]
    if extended:
        off = HEAD_OFF[facing]
        # head 方块自身的 facing 与 base 相同；渲染时把 head 放到朝向相邻格
        items.append(("g_piston_head.json", {"lit:facing": facing, "lit:sticky": "true" if sticky else "false"}, off))
    return items

def main():
    os.makedirs(OUT, exist_ok=True)

    # 内面贴图验证：收缩时 base 顶 = 活塞面（木色）；伸出后 base 顶 = 内面（灰色带杆孔）
    tiles = [
        (render_scene(scene(1, False), title="收缩 · 俯视：base 顶 = 活塞面"), "收缩态（俯视）"),
        (render_scene(scene(1, True), title="伸出 · 俯视：base 顶 = 内面"), "伸出态（俯视，12/16 处是内面）"),
        (render_scene(scene(1, True), cam=(1.0, -0.55, 1.0), title="伸出 · 仰视：头板内面"), "伸出态（仰视，头板内面）"),
    ]
    grid(tiles, 3, "活塞伸出后的内面贴图（piston_inner）", os.path.join(OUT, "piston_inner_face.png"))

    # 修复前 vs 修复后：修复前 piston_head 没有 ghost 映射 → 回落 lit:g_generic（半透明灰块）
    tiles = []
    for before in (True, False):
        items = scene(1, True)
        if before:
            items = [items[0], ("g_generic.json", {}, (0, 1, 0))]
        im = render_scene(items, yaw_deg=0, title="修复前：活塞臂位置 = generic 灰块" if before else "修复后：base 12/16 + 臂 + 头板")
        tiles.append((im, "修复前（generic 灰块）" if before else "修复后（原版两格造型）"))
    grid(tiles, 2, "活塞伸出态 · before / after", os.path.join(OUT, "piston_before_after.png"))

    tiles = []
    for facing in (1, 2):
        for ext in (False, True):
            im = render_scene(scene(facing, ext), yaw_deg=0,
                              title=f"facing={DIRS[facing]}  {'伸出' if ext else '收缩'}")
            tiles.append((im, f"{DIRS[facing]} · {'extended=true' if ext else 'extended=false'}"))
    grid(tiles, 2, "活塞 base + head（普通活塞）", os.path.join(OUT, "piston_base_head.png"))

    tiles = []
    for facing in range(6):
        im = render_scene(scene(facing, True), yaw_deg=0, title=f"伸出 · facing={DIRS[facing]}")
        tiles.append((im, f"facing={facing} ({DIRS[facing]})"))
    grid(tiles, 3, "伸出态 6 朝向（base + head 组合）", os.path.join(OUT, "piston_facings.png"))

    tiles = []
    for sticky in (0, 1):
        im = render_scene(scene(1, True, sticky), yaw_deg=0, title="黏性活塞" if sticky else "普通活塞")
        tiles.append((im, "sticky_piston" if sticky else "piston"))
    grid(tiles, 2, "普通 / 黏性（facing=up 伸出）", os.path.join(OUT, "piston_sticky.png"))

main()
