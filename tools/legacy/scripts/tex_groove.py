from PIL import Image
import os

orig = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"

def classify(p):
    r, g, b, a = p
    mx, mn = max(r, g, b), min(r, g, b)
    sat = mx - mn
    if a == 0:
        return " "
    if sat > 30 and r > g:            # 偏红（红石线/凹槽）
        return "R" if r > 120 else "r"
    if mx > 200 and sat < 20:         # 高光白
        return "W"
    if mx > 150:
        return "#"                    # 石台亮面
    if mx > 110:
        return "+"                    # 石台中间调
    return "."                         # 暗部

for name in ["repeater_off.png", "repeater_on.png"]:
    im = Image.open(os.path.join(orig, name)).convert("RGBA")
    print(f"=== {name}")
    print("    " + "".join(str(x % 10) for x in range(16)))
    reds = []
    for y in range(16):
        row = ""
        for x in range(16):
            c = classify(im.getpixel((x, y)))
            row += c
            if c in "Rr":
                reds.append((x, y))
        print(f"{y:3d} {row}")
    xs = [p[0] for p in reds]; ys = [p[1] for p in reds]
    print("red pixels:", len(reds), "x", min(xs), "..", max(xs), " y", min(ys), "..", max(ys))
    # 每行的红像素 x 范围
    for y in range(16):
        r = [x for (x, yy) in reds if yy == y]
        if r:
            print(f"  y={y}: x {min(r)}..{max(r)}")
