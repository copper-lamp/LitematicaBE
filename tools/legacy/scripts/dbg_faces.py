"""调试：单独渲染底座 cube，打印各面屏幕坐标。"""
import json, os, math
import numpy as np

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources/addon/LitematicaBE_RP")
MODEL = json.load(open(os.path.join(RP, "models/blocks/lit_repeater.json"), encoding="utf-8"))["minecraft:geometry"][0]
CUBES = MODEL["bones"][0]["cubes"]

NORMAL = {"north": (0, 0, -1), "south": (0, 0, 1), "west": (-1, 0, 0), "east": (1, 0, 0), "up": (0, 1, 0), "down": (0, -1, 0)}

def corners(face, x1, y1, z1, x2, y2, z2):
    return {
        "north": [(x2, y2, z1), (x1, y2, z1), (x2, y1, z1), (x1, y1, z1)],
        "south": [(x1, y2, z2), (x2, y2, z2), (x1, y1, z2), (x2, y1, z2)],
        "west": [(x1, y2, z1), (x1, y2, z2), (x1, y1, z1), (x1, y1, z2)],
        "east": [(x2, y2, z2), (x2, y2, z1), (x2, y1, z2), (x2, y1, z1)],
        "up": [(x1, y2, z2), (x2, y2, z2), (x1, y2, z1), (x2, y2, z1)],
        "down": [(x1, y1, z1), (x2, y1, z1), (x1, y1, z2), (x2, y1, z2)],
    }[face]

cam = np.array([1.0, 0.9, 1.0]); cam /= np.linalg.norm(cam)
d = -cam
right = np.cross([0.0, 1.0, 0.0], d); right /= np.linalg.norm(right)
up2 = np.cross(d, right)
proj = lambda p: np.array([np.dot(p, right), -np.dot(p, up2)]) * 24

c = CUBES[0]
x1, y1, z1 = c["origin"][0] + 8, c["origin"][1], c["origin"][2] + 8
x2, y2, z2 = x1 + c["size"][0], y1 + c["size"][1], z1 + c["size"][2]
print("base cube world:", x1, y1, z1, "->", x2, y2, z2)
for fname in ["up", "down", "north", "south", "east", "west"]:
    pts = [proj(p) for p in corners(fname, x1, y1, z1, x2, y2, z2)]
    n = np.array(NORMAL[fname], dtype=float)
    vis = np.dot(n, cam) > 0
    # 平行四边形自检
    p0, p1, p2, p3 = pts
    ok = np.allclose(p0 + p3, p1 + p2, atol=1e-6)
    print(f"{fname:6s} visible={vis} dot={np.dot(n, cam):+.2f} parallelogram={ok} "
          + " ".join(f"({p[0]:.0f},{p[1]:.0f})" for p in pts))
