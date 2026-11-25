"""重新出图（新文件名，避免图片缓存）：当前几何 vs 已部署到服务器的几何。"""
import json, os, importlib.util
import numpy as np
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc", "exec"), g)
render = g["render"]; OUT = g["OUT"]; MODELS = g["MODELS"]

# 当前项目文件（固定 z=13 / 可动 8-6-4-2）已经在 resources 里
tiles = []
for delay in range(4):
    for powered in (0, 1):
        im = render("g_repeater.json", {"lit:dir": 0, "lit:delay": delay, "lit:powered": powered}, 0)
        tiles.append((im, f"{delay + 1} 档 · {'激活' if powered else '未激活'}"))
cg = g["grid"]
cg(tiles, 4, "中继器 · 当前项目几何（固定 z=13-14 / 可动 8-9·6-7·4-5·2-3）",
   os.path.join(OUT, "rc_v7_repeater.png"))
print("saved rc_v7_repeater.png")
