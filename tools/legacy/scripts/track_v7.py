"""中继器火把位置轨迹图（2D 俯视，标 z 坐标）：固定火把 vs 四档可动火把。"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r"D:\GitHub\LitematicaBE"
RP = os.path.join(ROOT, "resources/addon/LitematicaBE_RP")
OUT = os.path.join(ROOT, "work/render")
S = 42
PAD = 64

img = Image.new("RGBA", (16 * S + PAD * 2, 16 * S + PAD * 2 + 40), (252, 252, 254, 255))
d = ImageDraw.Draw(img, "RGBA")
fT = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 22)
fS = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
fB = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 16)

ox, oy = PAD, PAD + 30
# 网格
for i in range(17):
    w = 2 if i % 4 == 0 else 1
    col = (150, 150, 165, 255) if i % 4 == 0 else (225, 225, 232, 255)
    d.line([ox + i * S, oy, ox + i * S, oy + 16 * S], fill=col, width=w)
    d.line([ox, oy + i * S, ox + 16 * S, oy + i * S], fill=col, width=w)
    d.text((ox + i * S - 6, oy + 16 * S + 6), str(i), font=fS, fill=(90, 90, 105, 255))
    d.text((ox - 22, oy + i * S - 8), str(i), font=fS, fill=(90, 90, 105, 255))
d.text((ox - 50, oy - 26), "z", font=fB, fill=(70, 70, 85, 255))
d.text((ox + 16 * S - 30, oy + 16 * S + 30), "x", font=fB, fill=(70, 70, 85, 255))
d.text((ox, oy - 30), "俯视（z=0 在上，x=0 在左）", font=fS, fill=(70, 70, 85, 255))

def box(x, z, color, label=None):
    d.rectangle([ox + x * S, oy + z * S, ox + (x + 2) * S, oy + (z + 2) * S],
                fill=color + (70,), outline=color + (255,), width=3)
    if label:
        d.text((ox + x * S + 4, oy + z * S + 10), label, font=fB, fill=(20, 20, 30, 230))

# 固定火把 z=13（绿）
box(7, 13, (0, 150, 70), "固定")

# 可动火把 1..4 档 z = 8/6/4/2（红，档位越深越靠上）
for i, z in enumerate([8, 6, 4, 2]):
    a = 60 + i * 55
    box(7, z, (200, 40 + i * 10, 30), f"{i + 1}档")

# 图例
ly = oy + 16 * S + 44
d.rectangle([ox, ly, ox + 26, ly + 16], fill=(0, 150, 70, 90), outline=(0, 150, 70, 255), width=2)
d.text((ox + 34, ly), "固定火把（输出端）z=13–14", font=fS, fill=(40, 40, 55, 255))
d.rectangle([ox + 330, ly, ox + 356, ly + 16], fill=(200, 60, 40, 90), outline=(200, 60, 40, 255), width=2)
d.text((ox + 364, ly), "可动火把（输入端）1–4 档 z=8-9 / 6-7 / 4-5 / 2-3", font=fS, fill=(40, 40, 55, 255))

d.text((ox, 16), "中继器火把落点轨迹（当前项目几何：固定 z=13-14，可动 8-9/6-7/4-5/2-3）",
       font=fT, fill=(26, 26, 36, 255))
p = os.path.join(OUT, "rc_track_v7.png")
img.save(p)
print("saved", p, img.size)
