"""火把整体 z 偏移候选：0 / +2 / +4。输出端固定、输入端四等分。未部署。"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "compare_variants.py"), encoding="utf-8").read()
src = src.split("tiles = []")[0]
g = {}
exec(compile(src, "cv", "exec"), g)

SHAPE = g["SHAPE"]; render = g["render"]

def pick(delay, shift):
    out = []
    for c in SHAPE:
        if c.get("if") and c["if"] != f"repeater_delay == {delay}":
            continue
        c = dict(c)
        if c.get("terrainTexture") and c.get("translate"):
            t = list(c["translate"])
            t[2] = (12 if not c.get("if") else 6 + 2 * delay) + shift
            out.append({**c, "translate": t})
        else:
            out.append(c)
    return out

tiles = []
for shift in (0, 2, 4):
    for delay in (0, 3):
        tiles.append((render(pick(delay, shift)), f"z 偏移 +{shift} · {delay + 1} 档"))

pad, capH = 16, 30
cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
cols = 2
rows = 3
W = cols * cw + (cols + 1) * pad
H = 56 + rows * (ch + capH + pad) + pad
out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
dr = ImageDraw.Draw(out)
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 22)
fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
dr.text((pad, 14), "中继器火把整体 z 偏移候选（输出端固定 / 输入端四等分，未部署）", font=fT, fill=(26, 26, 36, 255))
for i, (im, cap) in enumerate(tiles):
    r, c = divmod(i, cols)
    x = pad + c * (cw + pad); y = 56 + pad + r * (ch + capH + pad)
    bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
    bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
    out.paste(bg, (x, y))
    dr.text((x + 8, y + ch + 4), cap, font=fC, fill=(52, 52, 68, 255))
p = os.path.join(g["OUT"], "compare_shift.png")
out.save(p)
print("saved", p, out.size)
