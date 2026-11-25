"""1.1.42 渲染：火把裁剪修复（不再拉长）+ 灯块分面 UV（有木柄）。"""
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read().replace("\nmain()\n", "\n")
g = {}
exec(compile(src, "rc", "exec"), g)
render = g["render"]; OUT = g["OUT"]; grid = g["grid"]

tiles = []
for delay in (0, 3):
    for powered in (0, 1):
        im = render("g_repeater.json", {"lit:dir": 0, "lit:delay": delay, "lit:powered": powered}, 0)
        tiles.append((im, f"中继器 {delay + 1} 档 · {'激活' if powered else '未激活'}"))
for mode in (0, 1):
    for powered in (0, 1):
        im = render("g_comparator.json", {"lit:dir": 0, "lit:mode": mode, "lit:powered": powered}, 0)
        tiles.append((im, f"比较器 {'减法' if mode else '比较'} · {'激活' if powered else '未激活'}"))
grid(tiles, 4, "1.1.42 · 火把高度修复 + 灯块分面 UV（alpha_test 不变）",
     os.path.join(OUT, "rc_v11_check.png"))
print("saved rc_v11_check.png")
