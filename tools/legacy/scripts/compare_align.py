"""对比：当前几何（输出端 z=2）vs 整体下移 4 像素（输出端 z=6，火把落入底座凹槽）。未部署。"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "compare_variants.py"), encoding="utf-8").read().split("tiles = []")[0]
g = {}
exec(compile(src, "cv", "exec"), g)
SHAPE = g["SHAPE"]; render = g["render"]; OUT = g["OUT"]

def pick(delay, base_fixed, base_moving):
    out = []
    for c in SHAPE:
        if c.get("if") and c["if"] != f"repeater_delay == {delay}":
            continue
        c = dict(c)
        if c.get("terrainTexture") and c.get("translate"):
            t = list(c["translate"])
            t[2] = base_moving + 2 * delay if c.get("if") else base_fixed
            out.append({**c, "translate": t})
        else:
            out.append(c)
    return out

variants = [
    ("当前：输出端 z=2 / 输入端 6-8-10-12", 2, 6),
    ("下移4：输出端 z=6 / 输入端 8-10-12-14", 6, 8),
]

tiles = []
for label, bf, bm in variants:
    for delay in (0, 3):
        tiles.append((render(pick(delay, bf, bm)), f"{label} · {delay + 1}档"))

pad, capH = 16, 32
cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
cols = 2
rows = 2
W = cols * cw + (cols + 1) * pad
H = 58 + rows * (ch + capH + pad) + pad
out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
dr = ImageDraw.Draw(out)
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 22)
fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
dr.text((pad, 16), "中继器：火把与底座凹槽对齐（等轴测，未部署）", font=fT, fill=(26, 26, 36, 255))
for i, (im, cap) in enumerate(tiles):
    r, c = divmod(i, cols)
    x = pad + c * (cw + pad); y = 58 + pad + r * (ch + capH + pad)
    bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
    bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
    out.paste(bg, (x, y))
    dr.text((x + 8, y + ch + 4), cap, font=fC, fill=(52, 52, 68, 255))
p = os.path.join(OUT, "compare_align.png")
out.save(p)
print("saved", p, out.size)
