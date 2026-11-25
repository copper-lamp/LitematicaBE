import os
from PIL import Image

def analyze(path):
    try:
        im = Image.open(path).convert('RGBA')
        w, h = im.size
        px = list(im.getdata())
        colors = set(px)
        # 平均色（忽略全透明像素）
        opaque = [p for p in px if p[3] > 0]
        avg = None
        if opaque:
            n = len(opaque)
            avg = tuple(sum(c[i] for c in opaque) // n for i in range(4))
        # 主色（出现最多的颜色）
        from collections import Counter
        c = Counter(px)
        top = c.most_common(3)
        return f"{os.path.basename(path):28s} {w}x{h}  colors={len(colors):3d}  avg={avg}  top={top}"
    except Exception as e:
        return f"{os.path.basename(path):28s} ERROR {e}"

user_dir = r"C:\Users\25491\Desktop\新建文件夹"
proj_dir = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\textures\blocks\ghost"

print("=== USER TEXTURES ===")
for f in sorted(os.listdir(user_dir)):
    if f.endswith('.png'):
        print(analyze(os.path.join(user_dir, f)))

print("\n=== PROJECT EXISTING PISTON TEXTURES ===")
for f in sorted(os.listdir(proj_dir)):
    if f.endswith('.png') and 'piston' in f:
        print(analyze(os.path.join(proj_dir, f)))
