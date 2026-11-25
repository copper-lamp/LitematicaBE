"""比较器输出灯特写：未激活 vs 激活（同一几何、不同 lamp 材质）。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc", "exec"), g)
render = g["render"]; OUT = g["OUT"]

tiles = []
for powered in (0, 1):
    im = render("g_comparator.json", {"lit:dir": 0, "lit:mode": 0, "lit:powered": powered}, 0)
    # 裁出右下区域（输出灯附近）
    w, h = im.size
    crop = im.crop((int(w * 0.55), int(h * 0.45), w, h)).resize((int(w * 0.45 * 2), int(h * 0.55 * 2)), Image.NEAREST)
    tiles.append((crop, "比较模式 · 未激活（lamp=ghost_rtorch_off）" if not powered else "比较模式 · 激活（lamp=ghost_rtorch_on）"))

pad = 16
cw = max(t.width for t, _ in tiles); ch = max(t.height for t, _ in tiles)
W = 2 * cw + 3 * pad
H = ch + 90
out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
dr = ImageDraw.Draw(out)
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 20)
fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
dr.text((pad, 12), "比较器输出灯 · 材质切换检查（放大 2 倍）", font=fT, fill=(26, 26, 36, 255))
for i, (im, cap) in enumerate(tiles):
    x = pad + i * (cw + pad)
    out.paste(im, (x, 46))
    dr.text((x, 46 + ch + 8), cap, font=fC, fill=(52, 52, 68, 255))
p = os.path.join(OUT, "rc_v9_lamp_zoom.png")
out.save(p)
print("saved", p, out.size)
