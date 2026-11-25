"""中继器当前几何渲染（新文件名，避免缓存）。"""
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc", "exec"), g)
render = g["render"]; OUT = g["OUT"]; grid = g["grid"]

tiles = []
for delay in range(4):
    for powered in (0, 1):
        im = render("g_repeater.json", {"lit:dir": 0, "lit:delay": delay, "lit:powered": powered}, 0)
        tiles.append((im, f"{delay + 1} 档 · {'激活' if powered else '未激活'}"))
grid(tiles, 4, "中继器 · 固定火把 z13-15 / 可动 1-4 档 z8-10·6-8·4-6·2-4",
     os.path.join(OUT, "rc_v8_repeater.png"))
print("saved rc_v8_repeater.png")
