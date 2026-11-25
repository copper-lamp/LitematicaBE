"""俯视图：把底座 up 面贴图按 Bedrock 约定铺开，叠加两根火把的落点，用于比对"是否在槽里"。"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources/addon/LitematicaBE_RP")
MODELDIR = os.path.join(RP, "models/blocks")
OUT = os.path.join(ROOT, "work/render")
S = 36

def draw_top(model_file, tex_name, title, path, v_along_minus_z=True):
    model = json.load(open(os.path.join(MODELDIR, model_file), encoding="utf-8"))
    cubes = model["minecraft:geometry"][0]["bones"][0]["cubes"]
    base = cubes[0]
    tex = Image.open(os.path.join(RP, "textures/blocks/ghost", tex_name + ".png")).convert("RGBA")

    W = 16 * S
    img = Image.new("RGBA", (W, W), (250, 250, 252, 255))
    # 顶面：uv [0,0] 16x16 全图
    # v 沿 -z（Java 约定）：贴图 v=0 -> z=16（屏幕底）, v=16 -> z=0（屏幕顶）
    # 屏幕 y = z*S，所以贴图 v 对应 z = 16 - v
    src = tex.resize((W, W), Image.NEAREST)
    if v_along_minus_z:
        src = src.transpose(Image.FLIP_TOP_BOTTOM)
    img.alpha_composite(src, (0, 0))

    d = ImageDraw.Draw(img, "RGBA")
    # 火把落点（截面 2x2），z 从 model 的 origin[2]+8
    torch_boxes = []
    for c in cubes:
        uv = c.get("uv") or {}
        if "down" in uv and uv["down"].get("material_instance") == "torch":
            x = c["origin"][0] + 8
            z = c["origin"][2] + 8
            torch_boxes.append((x, z))
    for i, (x, z) in enumerate(torch_boxes):
        d.rectangle([x * S, z * S, (x + 2) * S - 1, (z + 2) * S - 1], outline=(0, 200, 0, 255), width=3)

    # 坐标刻度（每格 4 像素）
    for g in range(0, 17, 4):
        d.line([g * S, 0, g * S, W], fill=(0, 0, 0, 40), width=1)
        d.line([0, g * S, W, g * S], fill=(0, 0, 0, 40), width=1)
        d.text((g * S + 2, 2), str(g), fill=(0, 0, 0, 160))
        d.text((2, g * S + 2), str(g), fill=(0, 0, 0, 160))
    d.text((6, W - 22), "北在上 · 绿框=火把截面 · 数字=x/z 像素坐标", fill=(30, 30, 40, 220))

    canvas = Image.new("RGBA", (W + 24, W + 56), (247, 247, 250, 255))
    canvas.paste(img, (12, 40))
    dr = ImageDraw.Draw(canvas)
    f = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 20)
    dr.text((12, 10), title, font=f, fill=(26, 26, 36, 255))
    canvas.save(path)
    print("saved", path, "torches at (x,z):", torch_boxes)

for d, name in [(0, "1 档"), (1, "2 档"), (2, "3 档"), (3, "4 档")]:
    f = "lit_repeater.json" if d == 0 else f"lit_repeater_d{d}.json"
    draw_top(f, "ghost_repeater_off", f"中继器 {name} · 俯视（贴图 + 火把落点）",
             os.path.join(OUT, f"top_d{d}.png"))
