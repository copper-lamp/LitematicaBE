"""调试：分别只看固定火把 / 可调火把，确认两者都被渲染。"""
import importlib.util, sys, os
import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("rc", os.path.join(here, "render_check.py"))
rc = importlib.util.module_from_spec(spec)
# 阻止 main() 执行：把 main 替换掉
src = open(os.path.join(here, "render_check.py"), encoding="utf-8").read()
src = src.replace("\nmain()\n", "\n")
exec(compile(src, "render_check_nomian", "exec"), rc.__dict__)

MODEL = rc.MODELS["geometry.lit_repeater"]
cubes = MODEL["bones"][0]["cubes"]
print("cubes:", len(cubes))
for i, c in enumerate(cubes):
    print(i, "origin", c["origin"], "size", c["size"], "faces", list(c["uv"].keys()))

# 打印每个 cube 的世界范围
for i, c in enumerate(cubes):
    x1, y1, z1 = c["origin"][0] + 8, c["origin"][1], c["origin"][2] + 8
    print(f"cube{i}: x {x1:.0f}..{x1 + c['size'][0]:.0f}  y {y1:.0f}..{y1 + c['size'][1]:.0f}  z {z1:.0f}..{z1 + c['size'][2]:.0f}")
