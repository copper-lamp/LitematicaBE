"""楼梯修复自检：4 朝向 × 正置/倒置。"""
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc", "exec"), g)
render = g["render"]; OUT = g["OUT"]; grid = g["grid"]

tiles = []
for upside in (0, 1):
    for d in range(4):
        im = render("g_acacia_stairs.json", {"lit:dir": d, "lit:upside": upside}, 0)
        tiles.append((im, f"dir={d} · {'倒置' if upside else '正置'}"))
grid(tiles, 4, "楼梯 · 4 朝向 × 正置/倒置（geometry.lit_stairs / lit_stairs_up）",
     os.path.join(OUT, "stairs_check.png"))
print("saved stairs_check.png")
