"""娲诲�炰几鍑烘�佷袱鏍煎缓妯¤嚜妫�锛歜ase锛堣嚜韬�鏍硷級+ piston_head锛堟湞鍚戠浉閭绘牸锛夌粍鍚堟覆鏌撱��

澶嶇敤 work/render_check.py 鐨勫厜鏍呭寲绛栫暐锛坺-buffer + Bedrock 闈㈤《鐐圭害瀹氾級锛�
棰濆�栨敮鎸�"澶氭柟鍧楁寜鏍煎瓙鍋忕Щ鎷煎悓涓�涓�鍦烘櫙"锛岀敤浜庣‘璁わ細
  路 extended=true 鏃� base 鍙�鍓� 12/16锛堥《閮ㄧ┖鍑猴級
  路 head 鐨勮噦娈典粠 base 椤堕潰 12 澶勬帴涓婏紝澶存澘钀藉湪鐩搁偦鏍煎�栫�� 4/16
  路 6 涓�鏈濆悜鐨勬棆杞�鏂瑰悜
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

# 寮曟搸鍐呯疆婊℃牸鍑犱綍锛坙it:g_generic 绛夌敤鐨勶級锛屾病鏈夊疄浣� JSON
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
    """Bedrock transformation.rotation锛氬嚑浣曞潗鏍囷紙XZ 浠ユ柟鍧椾腑蹇冧负 0锛孻 浠ュ簳閮ㄤ负 0锛夛紝
    鏃嬭浆涓�蹇冩槸鏂瑰潡涓�蹇� (0,8,0)锛岃�掑害涓洪『鏃堕拡锛堝乏鎵嬬郴锛屼粠杞存�ｆ柟鍚戠湅鍚戝師鐐癸級銆�"""
    x, y, z = p[0] - center[0], p[1] - center[1], p[2] - center[2]
    rx, ry, rz = [math.radians(a) for a in rot]
    # Z锛堝乏鎵嬶級
    x, y = x * math.cos(rz) + y * math.sin(rz), -x * math.sin(rz) + y * math.cos(rz)
    # Y锛堝乏鎵嬶級
    x, z = x * math.cos(ry) - z * math.sin(ry), x * math.sin(ry) + z * math.cos(ry)
    # X锛堝乏鎵嬶級
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
            best = p  # 鍚庡尮閰嶈�嗙洊鍏堝尮閰嶏紙Bedrock 璇�涔夛級
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
        # 鍑犱綍鍧愭爣锛歑Z 浠ユ柟鍧椾腑蹇冧负 0锛孻 浠ュ簳閮ㄤ负 0
        x1, y1, z1 = c["origin"][0], c["origin"][1], c["origin"][2]
        x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
        for fname, fd in c["uv"].items():
            inst = fd.get("material_instance", "*")
            mm = (mats.get(inst) or mats.get("*") or {"texture": "ghost_stone", "render_method": "blend"})
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
        # UV 鎸夊嚑浣曠殑 texture_width/height 褰掍竴鍖栧悗鍐嶆槧灏勫埌璇ラ潰瀹為檯璐村浘鐨勫昂瀵�
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
    """浼稿嚭/鏀剁缉鐜板湪鏄�涓や釜鐙�绔嬫柟鍧楋紙涓嶅啀闈� lit:extended 鍒囧嚑浣曪級锛岃繖閲岃�佹寜鐘舵�侀�夋柟鍧楁枃浠躲��"""
    if extended:
        base_file = f"g_sticky_piston_extended_f{facing}.json" if sticky else f"g_piston_side_extended_f{facing}.json"
    else:
        base_file = f"g_sticky_piston_f{facing}.json" if sticky else f"g_piston_side_f{facing}.json"
    items = [(base_file, {"lit:facing": facing}, (0, 0, 0))]
    if extended:
        off = HEAD_OFF[facing]
        # head 鏂瑰潡鑷�韬�鐨� facing 涓� base 鐩稿悓锛涙覆鏌撴椂鎶� head 鏀惧埌鏈濆悜鐩搁偦鏍�
        items.append((f"g_piston_head_f{facing}.json", {"lit:facing": facing, "lit:sticky": "true" if sticky else "false"}, off))
    return items

def main():
    os.makedirs(OUT, exist_ok=True)

    # 鍐呴潰璐村浘楠岃瘉锛氭敹缂╂椂 base 椤� = 娲诲�為潰锛堟湪鑹诧級锛涗几鍑哄悗 base 椤� = 鍐呴潰锛堢伆鑹插甫鏉嗗瓟锛�
    tiles = [
        (render_scene(scene(1, False), title="鏀剁缉 路 淇�瑙嗭細base 椤� = 娲诲�為潰"), "鏀剁缉鎬侊紙淇�瑙嗭級"),
        (render_scene(scene(1, True), title="浼稿嚭 路 淇�瑙嗭細base 椤� = 鍐呴潰"), "浼稿嚭鎬侊紙淇�瑙嗭紝12/16 澶勬槸鍐呴潰锛�"),
        (render_scene(scene(1, True), cam=(1.0, -0.55, 1.0), title="浼稿嚭 路 浠拌�嗭細澶存澘鍐呴潰"), "浼稿嚭鎬侊紙浠拌�嗭紝澶存澘鍐呴潰锛�"),
    ]
    grid(tiles, 3, "娲诲�炰几鍑哄悗鐨勫唴闈㈣创鍥撅紙piston_inner锛�", os.path.join(OUT, "piston_inner_face.png"))

    # 淇�澶嶅墠 vs 淇�澶嶅悗锛氫慨澶嶅墠 piston_head 娌℃湁 ghost 鏄犲皠 鈫� 鍥炶惤 lit:g_generic锛堝崐閫忔槑鐏板潡锛�
    tiles = []
    for before in (True, False):
        items = scene(1, True)
        if before:
            items = [items[0], ("g_generic.json", {}, (0, 1, 0))]
        im = render_scene(items, yaw_deg=0, title="淇�澶嶅墠锛氭椿濉炶噦浣嶇疆 = generic 鐏板潡" if before else "淇�澶嶅悗锛歜ase 12/16 + 鑷� + 澶存澘")
        tiles.append((im, "淇�澶嶅墠锛坓eneric 鐏板潡锛�" if before else "淇�澶嶅悗锛堝師鐗堜袱鏍奸�犲瀷锛�"))
    grid(tiles, 2, "娲诲�炰几鍑烘�� 路 before / after", os.path.join(OUT, "piston_before_after.png"))

    tiles = []
    for facing in (1, 2):
        for ext in (False, True):
            im = render_scene(scene(facing, ext), yaw_deg=0,
                              title=f"facing={DIRS[facing]}  {'浼稿嚭' if ext else '鏀剁缉'}")
            tiles.append((im, f"{DIRS[facing]} 路 {'extended=true' if ext else 'extended=false'}"))
    grid(tiles, 2, "娲诲�� base + head锛堟櫘閫氭椿濉烇級", os.path.join(OUT, "piston_base_head.png"))

    tiles = []
    for facing in range(6):
        im = render_scene(scene(facing, True), yaw_deg=0, title=f"浼稿嚭 路 facing={DIRS[facing]}")
        tiles.append((im, f"facing={facing} ({DIRS[facing]})"))
    grid(tiles, 3, "浼稿嚭鎬� 6 鏈濆悜锛坆ase + head 缁勫悎锛�", os.path.join(OUT, "piston_facings.png"))

    tiles = []
    for sticky in (0, 1):
        im = render_scene(scene(1, True, sticky), yaw_deg=0, title="榛忔�ф椿濉�" if sticky else "鏅�閫氭椿濉�")
        tiles.append((im, "sticky_piston" if sticky else "piston"))
    grid(tiles, 2, "鏅�閫� / 榛忔�э紙facing=up 浼稿嚭锛�", os.path.join(OUT, "piston_sticky.png"))



def main_now():
    os.makedirs(OUT, exist_ok=True)
    shots = [
        (render_scene(scene(1, True), title="extended f1 top view"), "now_extended_f1.png"),
        (render_scene(scene(2, True), title="extended f2 top view"), "now_extended_f2.png"),
        (render_scene(scene(1, True, 1), title="sticky extended f1"), "now_sticky_extended_f1.png"),
        (render_scene(scene(1, True), cam=(1.0, -0.55, 1.0), title="extended f1 iso from below"), "now_extended_f1_below.png"),
    ]
    for im, name in shots:
        im.save(os.path.join(OUT, name))
        print("saved", name)

main_now()
