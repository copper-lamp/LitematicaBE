"""离线渲染：草类「修复前（整块 + 灰白图）」vs「修复后（交叉板 + 染色）」，外加草方块。

复用 work/render_model.py（已支持 cube 绕 Y 旋转与整格线框）。
"""
import json, os, sys
from PIL import Image, ImageDraw

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources", "addon", "LitematicaBE_RP")
BP = os.path.join(ROOT, "resources", "addon", "LitematicaBE_BP")
sys.path.insert(0, os.path.join(ROOT, "work"))
import render_model as R  # noqa: E402

OUT = os.path.join(ROOT, "work", "render")
TMP = os.path.join(OUT, "_tmp3")
os.makedirs(TMP, exist_ok=True)
FACES = ["north", "south", "east", "west", "up", "down"]
UV16 = {f: {"uv": [0, 0], "uv_size": [16, 16]} for f in FACES}


def bake(gid):
    block_path = os.path.join(BP, "blocks", gid.replace("lit:", "") + ".json")
    blk = json.load(open(block_path, encoding="utf-8"))["minecraft:block"]
    geo_name = blk["components"]["minecraft:geometry"].replace("geometry.", "")
    if geo_name == "minecraft:full_block":
        geo = json.load(open(old_full_block("ghost_generic", gid.replace("lit:", "") + "_fb"), encoding="utf-8"))
    else:
        geo_path = os.path.join(RP, "models", "blocks", geo_name + ".json")
        geo = json.load(open(geo_path, encoding="utf-8"))
    mi = blk["components"]["minecraft:material_instances"]
    tr = (blk["components"].get("minecraft:transformation") or {}).get("translation", [0, 0, 0])
    for cube in geo["minecraft:geometry"][0]["bones"][0]["cubes"]:
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


def old_full_block(tex, name):
    geo = {
        "format_version": "1.19.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.tmp", "texture_width": 16, "texture_height": 16,
                            "visible_bounds_width": 1, "visible_bounds_height": 1, "visible_bounds_offset": [0, 0, 0]},
            "bones": [{"name": "body", "pivot": [0, 0, 0], "cubes": [{
                "origin": [-8, 0, -8], "size": [16, 16, 16],
                "uv": {f: {**UV16[f], "material_instance": tex} for f in FACES},
            }]}],
        }],
    }
    p = os.path.join(TMP, name + "_old.json")
    json.dump(geo, open(p, "w", encoding="utf-8"), indent=1)
    return p


def label(img, text):
    W, H = img.size
    bar = Image.new("RGBA", (W, H + 24), (245, 245, 248, 255))
    bar.paste(img, (0, 0))
    ImageDraw.Draw(bar).text((6, H + 5), text, fill=(30, 30, 40, 255))
    return bar


# (标题, 新 id, 旧 full_block 用的贴图)
JOBS = [
    ("草 short_grass", "lit:g_short_grass", "ghost_short_grass"),
    ("蕨 fern", "lit:g_fern", "ghost_fern"),
    ("高草 tall_grass 下", "lit:g_tall_grass_bottom", "ghost_tall_grass_bottom_tint"),
    ("高草 tall_grass 上", "lit:g_tall_grass_top", "ghost_tall_grass_top_tint"),
    ("大蕨 large_fern 下", "lit:g_large_fern_bottom", "ghost_large_fern_bottom_tint"),
    ("枯木 deadbush", "lit:g_deadbush", "ghost_dead_bush"),
    ("灌木 bush", "lit:g_bush", "ghost_bush_tint"),
    ("虞美人 poppy", "lit:g_poppy", "ghost_poppy"),
    ("草方块 grass_block", "lit:g_grass_block", "ghost_grass_block_top"),
]

pairs = []
for title, gid, old_tex in JOBS:
    model, texmap = bake(gid)
    p_new = R.render(model, texmap, os.path.join(OUT, gid.replace("lit:", "") + "_new.png"), S=22, box=True)
    p_old = old_full_block(old_tex, gid.replace("lit:", ""))
    p_old_png = R.render(p_old, {old_tex: old_tex}, os.path.join(OUT, gid.replace("lit:", "") + "_old.png"), S=22, box=True)
    a = label(Image.open(p_old_png), "BEFORE  full_block")
    b = label(Image.open(p_new), "AFTER   cross + tint")
    h = max(a.height, b.height)
    pair = Image.new("RGBA", (a.width + b.width, h), (255, 255, 255, 255))
    pair.paste(a, (0, 0)); pair.paste(b, (a.width, 0))
    pairs.append((title, pair))

cols = 3
rows = (len(pairs) + cols - 1) // cols
cell_w = max(p.width for _, p in pairs)
cell_h = max(p.height for _, p in pairs)
sheet = Image.new("RGBA", (cell_w * cols + 8 * (cols + 1), (cell_h + 26) * rows + 8), (255, 255, 255, 255))
for i, (title, pair) in enumerate(pairs):
    r, c = divmod(i, cols)
    x = 8 + c * (cell_w + 8)
    y = 8 + r * (cell_h + 26)
    draw = ImageDraw.Draw(sheet)
    draw.text((x + 4, y), title, fill=(20, 20, 30, 255))
    sheet.paste(pair, (x, y + 14))
out = os.path.join(OUT, "grass_fix.png")
sheet.save(out)
print("saved", out, sheet.size)
