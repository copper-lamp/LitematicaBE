from PIL import Image, ImageChops
import os, hashlib

orig = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"
proj = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\textures\blocks"

pairs = [
    (orig + r"\repeater_off.png", proj + r"\ghost\ghost_repeater_off.png"),
    (orig + r"\repeater_on.png", proj + r"\ghost\ghost_repeater_on.png"),
    (orig + r"\comparator_off.png", proj + r"\ghost\ghost_comparator_off.png"),
    (orig + r"\comparator_on.png", proj + r"\ghost\ghost_comparator_on.png"),
    (orig + r"\redstone_torch_off.png", proj + r"\ghost\ghost_rtorch_off.png"),
    (orig + r"\redstone_torch_on.png", proj + r"\ghost\ghost_rtorch_on.png"),
    (orig + r"\stone_slab_top.png", proj + r"\ghost\ghost_comp_slab.png"),
    (orig + r"\repeater_off.png", proj + r"\repeater.png"),
    (orig + r"\repeater_on.png", proj + r"\repeater_on.png"),
    (orig + r"\comparator_off.png", proj + r"\comparator.png"),
    (orig + r"\comparator_on.png", proj + r"\comparator_on.png"),
]

for a, b in pairs:
    if not (os.path.exists(a) and os.path.exists(b)):
        print("MISSING", a, b)
        continue
    ia = Image.open(a).convert("RGBA")
    ib = Image.open(b).convert("RGBA")
    same_px = ia.size == ib.size and ImageChops.difference(ia, ib).getbbox() is None
    diff = 0
    if ia.size == ib.size:
        pa, pb = ia.load(), ib.load()
        for y in range(ia.size[1]):
            for x in range(ia.size[0]):
                if pa[x, y] != pb[x, y]:
                    diff += 1
    print(f"{os.path.basename(a):26s} -> {os.path.basename(b):30s} size={ia.size}/{ib.size} identical={same_px} diffpx={diff}")
