"""统计草相关贴图的平均颜色（png / tga 都读），判断是否需要染色。"""
import os
from PIL import Image

GHOST = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\textures\blocks\ghost"
VAN = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"


def stats(path):
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    n = 0
    r = g = b = 0
    for y in range(h):
        for x in range(w):
            R, G, B, A = px[x, y]
            if A < 16:
                continue
            r += R; g += G; b += B; n += 1
    if n == 0:
        return None, (w, h)
    return (r // n, g // n, b // n), (w, h)


def show(label, path):
    if not os.path.exists(path):
        print(f"  {label:<34} MISSING  {os.path.basename(path)}")
        return
    rgb, size = stats(path)
    print(f"  {label:<34} {str(rgb):<18} {size[0]}x{size[1]}  {os.path.basename(path)}")


print("=== ghost（现状）")
for n in ["ghost_short_grass.png", "ghost_fern.png", "ghost_tall_grass_top.png",
          "ghost_large_fern_top.png", "ghost_dead_bush.png", "ghost_grass_block_top.png",
          "ghost_grass_block_side.png", "ghost_grass.png", "ghost_tall_grass.png"]:
    show(n, os.path.join(GHOST, n))

print("\n=== 原版 BE 资源包")
for n in ["grass_top.png", "grass_side.tga", "tallgrass.png", "fern.tga", "deadbush.png",
          "double_plant_grass_top.tga", "double_plant_grass_bottom.tga",
          "double_plant_fern_top.tga", "double_plant_fern_bottom.tga", "grass_block_snow.png"]:
    show(n, os.path.join(VAN, n))
