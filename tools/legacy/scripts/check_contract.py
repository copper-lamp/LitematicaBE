import json, os, re
from PIL import Image

rp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
models = os.path.join(rp, "models", "blocks")

print("=== 收缩态模型四面 side UV（6 朝向）===")
for f in sorted(os.listdir(models)):
    m = re.fullmatch(r'lit_piston_f([0-5])\.json', f)
    if not m: continue
    fdir = m.group(1)
    with open(os.path.join(models, f), encoding='utf-8') as fh:
        data = json.load(fh)
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    mat = spec.get('material_instance')
                    uv, sz = spec.get('uv'), spec.get('uv_size')
                    print(f"f{fdir} {face:6s} mat={mat:12s} uv={uv} uv_size={sz}")

print("\n=== ghost_piston_side.png 方向性分析 ===")
im = Image.open(os.path.join(rp, "textures", "blocks", "ghost", "ghost_piston_side.png")).convert("RGBA")
w, h = im.size
px = im.load()
def region_mean(x0, y0, x1, y1):
    rs = gs = bs = n = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = px[x, y]
            rs += r; gs += g; bs += b; n += 1
    return (rs/n, gs/n, bs/n)
top = region_mean(0, 0, w, h//2)
bot = region_mean(0, h//2, w, h)
left = region_mean(0, 0, w//2, h)
right = region_mean(w//2, 0, w, h)
print(f"尺寸 {w}x{h} 上均值={tuple(round(v) for v in top)} 下均值={tuple(round(v) for v in bot)}")
print(f"左均值={tuple(round(v) for v in left)} 右均值={tuple(round(v) for v in right)}")
print("上下差异:", round(sum(abs(top[i]-bot[i]) for i in range(3))), "左右差异:", round(sum(abs(left[i]-right[i]) for i in range(3))))
