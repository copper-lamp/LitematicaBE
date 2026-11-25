from PIL import Image
import os

orig = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"

def classify(p):
    r, g, b, a = p
    if a == 0:
        return " "
    mx, mn = max(r, g, b), min(r, g, b)
    if r > 120 and r > g + 40 and r > b + 40:
        return "R" if r > 180 else "r"   # 红/暗红
    if r > 200 and g > 190 and b > 180 and mx - mn < 25:
        return "W"                       # 近白（石英）
    if mx - mn < 18:
        return "#" if mx > 150 else ("+" if mx > 100 else ".")
    return "?"

for name in ["repeater_off.png", "repeater_on.png", "comparator_off.png", "comparator_on.png"]:
    im = Image.open(os.path.join(orig, name)).convert("RGBA")
    print("===", name, im.size)
    print("    " + "".join(str(x % 10) for x in range(16)))
    for y in range(im.size[1]):
        row = "".join(classify(im.getpixel((x, y))) for x in range(im.size[0]))
        print(f"{y:3d} {row}")
    print()
