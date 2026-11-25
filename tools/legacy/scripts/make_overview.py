from PIL import Image, ImageDraw, ImageFont
import os

R = r"D:\GitHub\LitematicaBE\work\render"
items = [
    ("repeater_off.png", "中继器 · 未激活 (delay0)"),
    ("repeater_on.png", "中继器 · 激活"),
    ("repeater_d3.png", "中继器 · delay3"),
    ("comparator_off.png", "比较器 · 比较模式"),
    ("comparator_on.png", "比较器 · 比较模式(激活)"),
    ("comparator_sub.png", "比较器 · 减法模式"),
]
imgs = []
for f, cap in items:
    im = Image.open(os.path.join(R, f)).convert("RGBA")
    imgs.append((im, cap))

pad = 18
capH = 34
cols = 3
rows = 2
cw = max(i.width for i, _ in imgs)
ch = max(i.height for i, _ in imgs)
W = cols * cw + (cols + 1) * pad
H = 46 + rows * (ch + capH) + (rows + 1) * pad
out = Image.new("RGBA", (W, H), (247, 247, 250, 255))
d = ImageDraw.Draw(out)
try:
    fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 22)
    fC = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
except Exception:
    fT = fC = ImageFont.load_default()
d.text((pad, 12), "红石中继器 / 红石比较器 · 原版建模复刻自检（等轴测）", font=fT, fill=(28, 28, 38, 255))
for i, (im, cap) in enumerate(imgs):
    r, c = divmod(i, cols)
    x = pad + c * (cw + pad)
    y = 46 + pad + r * (ch + capH + pad)
    bg = Image.new("RGBA", (cw, ch), (255, 255, 255, 255))
    bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
    out.paste(bg, (x, y))
    d.text((x + 6, y + ch + 4), cap, font=fC, fill=(60, 60, 76, 255))
p = os.path.join(R, "rc_overview.png")
out.save(p)
print("saved", p, out.size)
