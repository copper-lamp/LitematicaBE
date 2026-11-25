from PIL import Image
import os

orig = r"C:\Users\25491\Desktop\建模贴图\resource\bedrock-samples-v1.26.60.5-full\resource_pack\textures\blocks"
names = ["repeater_off.png", "repeater_on.png", "comparator_off.png", "comparator_on.png",
         "redstone_torch_off.png", "redstone_torch_on.png", "stone_slab_top.png"]
S = 24
tiles = []
for n in names:
    im = Image.open(os.path.join(orig, n)).convert("RGBA")
    bg = Image.new("RGBA", im.size, (40, 40, 48, 255))
    bg.alpha_composite(im)
    tiles.append((n, bg.resize((16 * S, 16 * S), Image.NEAREST)))

pad = 16
W = len(tiles) * (16 * S + pad) + pad
H = 16 * S + pad * 2 + 30
out = Image.new("RGBA", (W, H), (255, 255, 255, 255))
from PIL import ImageDraw
d = ImageDraw.Draw(out)
x = pad
for n, t in tiles:
    out.paste(t, (x, pad + 26))
    d.text((x, 8), n, fill=(0, 0, 0, 255))
    x += t.size[0] + pad
p = r"C:\Users\25491\Desktop\建模贴图\_atlas_preview.png"
out.save(p)
print("saved", p, out.size)
