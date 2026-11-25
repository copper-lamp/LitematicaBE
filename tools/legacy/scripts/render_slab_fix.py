"""离线渲染：半砖类 ghost 方块「修复前（整块 full_block + 单张 side 图）」vs「修复后（半格几何 + 面贴图）」。

复用 work/render_model.py 的正交渲染（按 UV 逐像素采样），把 BP 里 material_instances
的面材质烘焙进 cube.uv.material_instance 后再渲染。
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources", "addon", "LitematicaBE_RP")
BP = os.path.join(ROOT, "resources", "addon", "LitematicaBE_BP")
sys.path.insert(0, os.path.join(ROOT, "work"))
import render_model as R  # noqa: E402

OUT = os.path.join(ROOT, "work", "render")
os.makedirs(OUT, exist_ok=True)

FACES = ["north", "south", "east", "west", "up", "down"]
UV16 = {f: {"uv": [0, 0], "uv_size": [16, 16]} for f in FACES}


def bake(geo_path, block_path, out_path):
    """把 BP 的面材质写进几何 UV，输出临时模型"""
    geo = json.load(open(geo_path, encoding="utf-8"))
    mi = json.load(open(block_path, encoding="utf-8"))["minecraft:block"]["components"]["minecraft:material_instances"]
    for cube in geo["minecraft:geometry"][0]["bones"][0]["cubes"]:
        for face, fdef in cube["uv"].items():
            inst = mi.get(face) or mi.get("*")
            fdef["material_instance"] = inst["texture"]
    json.dump(geo, open(out_path, "w", encoding="utf-8"), indent=1)
    return out_path


def full_block_geo(tex, out_path):
    """模拟修复前：整块几何、六面同一张贴图"""
    geo = {
        "format_version": "1.19.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.tmp_full", "texture_width": 16, "texture_height": 16,
                            "visible_bounds_width": 1, "visible_bounds_height": 1, "visible_bounds_offset": [0, 0, 0]},
            "bones": [{"name": "body", "pivot": [0, 0, 0], "cubes": [{
                "origin": [-8, 0, -8], "size": [16, 16, 16],
                "uv": {f: {**UV16[f], "material_instance": tex} for f in FACES},
            }]}],
        }],
    }
    json.dump(geo, open(out_path, "w", encoding="utf-8"), indent=1)
    return out_path


def texmap_of(model_path):
    geo = json.load(open(model_path, encoding="utf-8"))
    names = set()
    for c in geo["minecraft:geometry"][0]["bones"][0]["cubes"]:
        for fdef in c["uv"].values():
            names.add(fdef.get("material_instance", "*"))
    return {n: n for n in names}


def label(img, text):
    """在图片下方加标题条"""
    W, H = img.size
    bar = Image.new("RGBA", (W, H + 26), (245, 245, 248, 255))
    bar.paste(img, (0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(bar)
    d.text((8, H + 6), text, fill=(30, 30, 40, 255))
    return bar


JOBS = [
    # (标题, 新 ghost 块 id, 旧整块用的是哪张 side 贴图)
    ("石英台阶 quartz_slab", "lit:g_quartz_slab", "ghost_quartz_block_side"),
    ("砂岩台阶 sandstone_slab", "lit:g_sandstone_slab", "ghost_sandstone"),
    ("石头台阶 stone_slab", "lit:g_stone_slab", "ghost_stone"),
    ("平滑石英台阶 smooth_quartz_slab", "lit:g_smooth_quartz_slab", "ghost_quartz_block_bottom"),
    ("黑石台阶 blackstone_slab", "lit:g_blackstone_slab", "ghost_blackstone"),
    ("阳光传感器 daylight_detector", "lit:g_daylight_detector", "ghost_daylight_detector_top"),
    ("阳光传感器（反相）", "lit:g_daylight_detector_inverted", "ghost_daylight_detector_top"),
]

tiles = []
tmp = os.path.join(OUT, "_tmp")
os.makedirs(tmp, exist_ok=True)
for title, gid, old_tex in JOBS:
    short = gid.split(":")[1]
    block_path = os.path.join(BP, "blocks", short + ".json")
    if not os.path.exists(block_path):
        print("跳过（缺 BP）", gid)
        continue
    geo_name = json.load(open(block_path, encoding="utf-8"))["minecraft:block"]["components"]["minecraft:geometry"]
    geo_file = os.path.join(RP, "models", "blocks", geo_name.replace("geometry.", "") + ".json")
    # 新
    new_model = bake(geo_file, block_path, os.path.join(tmp, short + "_baked.json"))
    p_new = R.render(new_model, texmap_of(new_model), os.path.join(OUT, short + "_fixed.png"), S=26)
    # 旧
    old_model = full_block_geo(old_tex, os.path.join(tmp, short + "_old.json"))
    p_old = R.render(old_model, {old_tex: old_tex}, os.path.join(OUT, short + "_oldrender.png"), S=26)
    a = label(Image.open(p_old), "BEFORE  full block")
    b = label(Image.open(p_new), "AFTER   slab + face tex")
    h = max(a.height, b.height)
    pair = Image.new("RGBA", (a.width + b.width, h), (255, 255, 255, 255))
    pair.paste(a, (0, 0)); pair.paste(b, (a.width, 0))
    tiles.append((title, pair))

if tiles:
    pad = 10
    W = max(t.width for _, t in tiles)
    H = sum(t.height + pad for _, t in tiles) + 8
    sheet = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    y = 4
    for title, t in tiles:
        sheet.paste(t.convert("RGBA"), (4, y))
        y += t.height + pad
    out = os.path.join(OUT, "slab_fix_compare.png")
    sheet.save(out)
    print("saved", out, sheet.size)
