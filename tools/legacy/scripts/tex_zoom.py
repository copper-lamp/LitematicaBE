from PIL import Image
import os

orig = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"
out = r"D:\GitHub\LitematicaBE\work\render"
os.makedirs(out, exist_ok=True)
S = 32
for n in ["repeater_off.png", "repeater_on.png", "comparator_off.png", "comparator_on.png"]:
    im = Image.open(os.path.join(orig, n)).convert("RGBA")
    big = im.resize((16 * S, 16 * S), Image.NEAREST)
    canvas = Image.new("RGBA", (16 * S + 2, 16 * S + 2), (255, 0, 255, 255))
    canvas.alpha_composite(big, (1, 1))
    p = os.path.join(out, "tex_" + n.replace(".png", "_x32.png"))
    canvas.save(p)
    print("saved", p)

# 精确打印颜色（hex）
im = Image.open(os.path.join(orig, "repeater_off.png")).convert("RGBA")
print("\nrepeater_off RGB grid (x -> west-east, y -> top-bottom):")
for y in range(16):
    row = []
    for x in range(16):
        r, g, b, a = im.getpixel((x, y))
        row.append(f"{r:02x}{g:02x}{b:02x}")
    print(f"y={y:2d} " + " ".join(row))
