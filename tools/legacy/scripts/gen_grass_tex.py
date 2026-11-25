"""草类贴图着色：BE 的草贴图是灰白的（客户端按生物群系染色），投影里必须自己染。

乘法染色 = 保留原图明暗层次（BE / Java 的 biome tint 就是乘法）。
输出到 ghost 目录，文件名统一带 _tint 后缀，避免覆盖同名的灰白旧图。
"""
import os
from PIL import Image

GHOST = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\textures\blocks\ghost"
VAN = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"

# 平原草色 #91BD59（与 Java 的 biome tint 一致）
GRASS_TINT = (145, 189, 89)
# ghost 不受游戏光照提亮（贴图乘完 tint 会明显偏暗），补一点增益贴近实机观感
GAIN = 1.30

JOBS = [
    # (输出名, 源文件, 是否染色)
    ("ghost_short_grass_tint.png", os.path.join(GHOST, "ghost_short_grass.png"), True),
    ("ghost_fern_tint.png", os.path.join(GHOST, "ghost_fern.png"), True),
    ("ghost_tall_grass_top_tint.png", os.path.join(VAN, "double_plant_grass_top.tga"), True),
    ("ghost_tall_grass_bottom_tint.png", os.path.join(VAN, "double_plant_grass_bottom.tga"), True),
    ("ghost_large_fern_top_tint.png", os.path.join(VAN, "double_plant_fern_top.tga"), True),
    ("ghost_large_fern_bottom_tint.png", os.path.join(VAN, "double_plant_fern_bottom.tga"), True),
    ("ghost_bush_tint.png", os.path.join(VAN, "bush.png"), True),
    ("ghost_grass_block_top_tint.png", os.path.join(VAN, "grass_top.png"), True),
    # 草方块侧面：原版 grass_side 是灰图（草边和土都不分色），直接用"手持版"侧面图
    # （grass_side_carried 已经带土色 + 绿草边），不再二次染色
    ("ghost_grass_block_side.png", os.path.join(VAN, "grass_side_carried.png"), False),
    # 本身已带色的干草/萤火虫灌木：直接拷（不染色）
    ("ghost_short_dry_grass.png", os.path.join(VAN, "short_dry_grass.png"), False),
    ("ghost_tall_dry_grass.png", os.path.join(VAN, "tall_dry_grass.png"), False),
    ("ghost_firefly_bush.png", os.path.join(VAN, "firefly_bush.png"), False),
]


def avg(img):
    px = img.load()
    w, h = img.size
    r = g = b = n = 0
    for y in range(h):
        for x in range(w):
            R, G, B, A = px[x, y]
            if A < 16:
                continue
            r += R; g += G; b += B; n += 1
    return (r // n, g // n, b // n) if n else None


def tint(img, t):
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            R, G, B, A = px[x, y]
            if A == 0:
                continue
            px[x, y] = (
                min(255, int(R * t[0] / 255 * GAIN)),
                min(255, int(G * t[1] / 255 * GAIN)),
                min(255, int(B * t[2] / 255 * GAIN)),
                A,
            )
    return out


for name, src, do_tint in JOBS:
    if not os.path.exists(src):
        print("  MISSING", src)
        continue
    img = Image.open(src).convert("RGBA")
    before = avg(img)
    if do_tint:
        img = tint(img, GRASS_TINT)
    dst = os.path.join(GHOST, name)
    img.save(dst)
    print(f"  {name:<34} {str(before):<18}-> {avg(img)}  ({img.size[0]}x{img.size[1]})")
