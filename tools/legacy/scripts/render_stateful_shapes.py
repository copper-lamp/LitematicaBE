"""离线渲染三族形态对比：楼梯 下/上、活板门 关-下 / 关-上 / 开、门 下段/上段。

复用 work/render_model.py 的正交渲染；把 BP 的材质与位移/旋转烘焙进几何后渲染。
线框是整格 0..16 的参照，用来判断"半格/平移/上下翻转"是否到位。
"""
import json, os, sys
from PIL import Image, ImageDraw

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources", "addon", "LitematicaBE_RP")
BP = os.path.join(ROOT, "resources", "addon", "LitematicaBE_BP")
sys.path.insert(0, os.path.join(ROOT, "work"))
import render_model as R  # noqa: E402

OUT = os.path.join(ROOT, "work", "render")
TMP = os.path.join(OUT, "_tmp2")
os.makedirs(TMP, exist_ok=True)


def bake(gid):
    block_path = os.path.join(BP, "blocks", gid.replace("lit:", "") + ".json")
    blk = json.load(open(block_path, encoding="utf-8"))["minecraft:block"]
    geo_name = blk["components"]["minecraft:geometry"].replace("geometry.", "")
    geo_path = os.path.join(RP, "models", "blocks", geo_name + ".json")
    geo = json.load(open(geo_path, encoding="utf-8"))
    mi = blk["components"]["minecraft:material_instances"]
    tr = (blk["components"].get("minecraft:transformation") or {}).get("translation", [0, 0, 0])
    for cube in geo["minecraft:geometry"][0]["bones"][0]["cubes"]:
        # 把 components 里的位移烘进 origin（translation 单位是方块比例，×16 转像素）
        cube["origin"] = [cube["origin"][i] + tr[i] * 16 for i in range(3)]
        for face, fdef in cube["uv"].items():
            inst = mi.get(face) or mi.get("*")
            fdef["material_instance"] = inst["texture"]
    out = os.path.join(TMP, gid.replace("lit:", "") + "_baked.json")
    json.dump(geo, open(out, "w", encoding="utf-8"), indent=1)
    names = set()
    for cube in geo["minecraft:geometry"][0]["bones"][0]["cubes"]:
        for fdef in cube["uv"].values():
            names.add(fdef.get("material_instance", "*"))
    return out, {n: n for n in names}


def label(img, text):
    W, H = img.size
    bar = Image.new("RGBA", (W, H + 24), (245, 245, 248, 255))
    bar.paste(img, (0, 0))
    ImageDraw.Draw(bar).text((6, H + 5), text, fill=(30, 30, 40, 255))
    return bar


GROUPS = [
    ("楼梯", [("lit:g_oak_stairs", "stairs  half=bottom"), ("lit:g_oak_stairs_up", "stairs_up  half=top")]),
    ("活板门", [("lit:g_trapdoor", "close  half=bottom"), ("lit:g_trapdoor_top", "close  half=top"),
              ("lit:g_trapdoor_open", "open")]),
    ("门", [("lit:g_wooden_door", "door  lower"), ("lit:g_wooden_door_upper", "door  upper"),
           ("lit:g_wooden_door_open", "door_open  lower")]),
]

rows = []
for title, items in GROUPS:
    tiles = []
    for gid, cap in items:
        model, texmap = bake(gid)
        p = R.render(model, texmap, os.path.join(OUT, gid.replace("lit:", "") + "_shape.png"), S=24, box=True)
        tiles.append(label(Image.open(p), cap))
    h = max(t.height for t in tiles)
    w = sum(t.width for t in tiles)
    row = Image.new("RGBA", (w + 8 * len(tiles), h + 6), (255, 255, 255, 255))
    x = 4
    for t in tiles:
        row.paste(t, (x, 3))
        x += t.width + 8
    rows.append((title, row))

W = max(r.width for _, r in rows) + 8
H = sum(r.height + 14 for _, r in rows) + 10
sheet = Image.new("RGBA", (W, H), (255, 255, 255, 255))
y = 6
for title, r in rows:
    sheet.paste(r, (4, y))
    y += r.height + 14
out = os.path.join(OUT, "stateful_shapes.png")
sheet.save(out)
print("saved", out, sheet.size)
