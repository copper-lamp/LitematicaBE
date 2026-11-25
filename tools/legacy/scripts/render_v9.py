"""比较器镜像后渲染（新文件名）。"""
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc", "exec"), g)
render = g["render"]; OUT = g["OUT"]; grid = g["grid"]

tiles = []
for mode in (0, 1):
    for powered in (0, 1):
        im = render("g_comparator.json", {"lit:dir": 0, "lit:mode": mode, "lit:powered": powered}, 0)
        tiles.append((im, f"{'减法' if mode else '比较'}模式 · {'激活' if powered else '未激活'}"))
grid(tiles, 2, "比较器 · 输出端与两枚输入火把镜像对调（输出 z12-14 / 输入 z3-5）",
     os.path.join(OUT, "rc_v9_comparator.png"))
print("saved rc_v9_comparator.png")
