"""火把落点轨迹（2D 俯视，标 z 坐标）—— 修正版"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"D:\GitHub\LitematicaBE\work\render"
S, PAD = 42, 64
img = Image.new("RGBA", (16 * S + PAD * 2, 16 * S + PAD * 2 + 60), (252, 252, 254, 255))
d = ImageDraw.Draw(img, "RGBA")
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 21)
fS = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
fB = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 15)

ox, oy = PAD, PAD + 30
for i in range(17):
    col = (150, 150, 165, 255) if i % 4 == 0 else (228, 228, 234, 255)
    d.line([ox + i * S, oy, ox + i * S, oy + 16 * S], fill=col, width=2 if i % 4 == 0 else 1)
    d.line([ox, oy + i * S, ox + 16 * S, oy + i * S], fill=col, width=2 if i % 4 == 0 else 1)
    d.text((ox + i * S - 6, oy + 16 * S + 6), str(i), font=fS, fill=(90, 90, 105, 255))
    d.text((ox - 22, oy + i * S - 8), str(i), font=fS, fill=(90, 90, 105, 255))

def box(x, z, color, label=None):
    d.rectangle([ox + x * S, oy + z * S, ox + (x + 2) * S, oy + (z + 2) * S],
                fill=color + (70,), outline=color + (255,), width=3)
    if label:
        d.text((ox + x * S + 4, oy + z * S + 9), label, font=fB, fill=(20, 20, 30, 235))

box(7, 13, (0, 150, 70), "固定")
for i, z in enumerate([8, 6, 4, 2]):
    box(7, z, (200, 40 + i * 12, 30), f"{i + 1}档")

ly = oy + 16 * S + 44
d.rectangle([ox, ly, ox + 26, ly + 16], fill=(0, 150, 70, 90), outline=(0, 150, 70, 255), width=2)
d.text((ox + 34, ly), "固定火把（输出端）：z 13–15", font=fS, fill=(40, 40, 55, 255))
d.rectangle([ox + 360, ly, ox + 386, ly + 16], fill=(200, 60, 40, 90), outline=(200, 60, 40, 255), width=2)
d.text((ox + 394, ly), "可动火把（输入端）：1–4 档 z 8-10 / 6-8 / 4-6 / 2-4", font=fS, fill=(40, 40, 55, 255))
d.text((ox, 14), "中继器火把落点（修正后：每支火把 5 个 cube 围成 2 像素截面，全部在方块内）",
       font=fT, fill=(26, 26, 36, 255))
p = os.path.join(OUT, "rc_track_v8.png")
img.save(p)
print("saved", p)
