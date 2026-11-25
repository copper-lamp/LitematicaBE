import json, os, re
from PIL import Image

rp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
models = os.path.join(rp, "models", "blocks")
ghost = os.path.join(rp, "textures", "blocks", "ghost")

print("=== 活塞模型各面 UV 方向 ===")
for f in sorted(os.listdir(models)):
    if not re.fullmatch(r'lit_piston(f|_extended|_head)_f[0-5]\.json', f):
        continue
    with open(os.path.join(models, f), encoding='utf-8') as fh:
        data = json.load(fh)
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for ci, cube in enumerate(bone.get('cubes', [])):
                for face, spec in cube.get('uv', {}).items():
                    mat = spec.get('material_instance', '*')
                    uv, sz = spec.get('uv'), spec.get('uv_size')
                    flip = '翻转' if (sz and sz[0] < 0 or (sz and sz[1] < 0)) else '正'
                    print(f"{f[:-5]} cube{ci} {face:6s} mat={mat:11s} uv={uv} size={sz} {flip}")

print("\n=== 贴图方向性（上下/左右差）===")
for name in ['ghost_piston_side','ghost_piston_side_spec','ghost_piston_top_normal','ghost_piston_top_sticky','ghost_piston_bottom','ghost_piston_inner','ghost_piston_top_side','ghost_piston_arm_rod']:
    p = os.path.join(ghost, name + '.png')
    if not os.path.exists(p): continue
    im = Image.open(p).convert('RGBA'); w,h = im.size; px = im.load()
    def rm(x0,y0,x1,y1):
        rs=gs=bs=n=0
        for y in range(y0,y1):
            for x in range(x0,x1):
                r,g,b,a=px[x,y]; rs+=r; gs+=g; bs+=b; n+=1
        return (rs/n,gs/n,bs/n)
    top=rm(0,0,w,h//2); bot=rm(0,h//2,w,h); left=rm(0,0,w//2,h); right=rm(w//2,0,w,h)
    ud=round(sum(abs(top[i]-bot[i]) for i in range(3))); lr=round(sum(abs(left[i]-right[i]) for i in range(3)))
    print(f"{name} {w}x{h} 上下差={ud} 左右差={lr}")
