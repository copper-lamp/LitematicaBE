import json, os, glob, re

root = r"D:\GitHub\LitematicaBE\resources\addon"
rp = os.path.join(root, "LitematicaBE_RP")
bp_blocks = os.path.join(root, "LitematicaBE_BP", "blocks")
models = os.path.join(rp, "models", "blocks")
tex_ghost = os.path.join(rp, "textures", "blocks", "ghost")
terrain = os.path.join(rp, "textures", "terrain_texture.json")
errors = []

with open(terrain, encoding='utf-8') as fh:
    tex_data = json.load(fh).get('texture_data', {})

def mi_of(f):
    with open(f, encoding='utf-8') as fh:
        d = json.load(fh)
    return d.get('minecraft:block', {}).get('components', {}).get('minecraft:material_instances', {})

# --- 1. 伸出态模型：材质名 + UV ---
for f in sorted(glob.glob(os.path.join(models, "lit_piston_extended_f*.json"))):
    with open(f, encoding='utf-8') as fh:
        d = json.load(fh)
    inner_n = side_n = bottom_n = 0
    for geom in d.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    m = spec.get('material_instance')
                    if m == 'inner': inner_n += 1
                    elif m == 'side':
                        side_n += 1
                        if spec.get('uv_size') != [-16, -12]:
                            errors.append(f"{os.path.basename(f)} {face} side uv 非16x12: {spec.get('uv_size')}")
                    elif m == 'bottom': bottom_n += 1
    if inner_n != 1 or side_n != 4:
        errors.append(f"{os.path.basename(f)} 材质名分布异常: inner={inner_n} side={side_n}")

# --- 2. 活塞头模型：plate_side UV ---
for f in sorted(glob.glob(os.path.join(models, "lit_piston_head_f*.json"))):
    with open(f, encoding='utf-8') as fh:
        d = json.load(fh)
    for geom in d.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    if spec.get('material_instance') == 'plate_side' and spec.get('uv_size') != [16, 4]:
                        errors.append(f"{os.path.basename(f)} {face} plate_side uv 非16x4")

# --- 3. BP 材质 ---
for f in sorted(glob.glob(os.path.join(bp_blocks, "g_*extended_f[0-5].json"))):
    mi = mi_of(f)
    if 'top' in mi: errors.append(f"{os.path.basename(f)} 仍含 top 材质")
    if mi.get('side', {}).get('texture') != 'ghost_piston_side_spec': errors.append(f"{os.path.basename(f)} side!=side_spec")
    if mi.get('inner', {}).get('texture') != 'ghost_piston_inner': errors.append(f"{os.path.basename(f)} inner!=inner")
    if mi.get('bottom', {}).get('texture') != 'ghost_piston_bottom': errors.append(f"{os.path.basename(f)} bottom!=bottom")

for f in sorted(glob.glob(os.path.join(bp_blocks, "g_piston_head_f[0-5].json"))):
    mi = mi_of(f)
    if mi.get('plate_top', {}).get('texture') != 'ghost_piston_top_normal': errors.append(f"{os.path.basename(f)} plate_top!=top_normal")
    if mi.get('plate_side', {}).get('texture') != 'ghost_piston_top_side': errors.append(f"{os.path.basename(f)} plate_side!=top_side")
    if mi.get('plate_back', {}).get('texture') != 'ghost_piston_top_normal': errors.append(f"{os.path.basename(f)} plate_back!=top_normal")
for f in sorted(glob.glob(os.path.join(bp_blocks, "g_sticky_piston_head_f[0-5].json"))):
    mi = mi_of(f)
    if mi.get('plate_top', {}).get('texture') != 'ghost_piston_top_sticky': errors.append(f"{os.path.basename(f)} plate_top!=top_sticky")
    if mi.get('plate_side', {}).get('texture') != 'ghost_piston_top_side': errors.append(f"{os.path.basename(f)} plate_side!=top_side")
    if mi.get('plate_back', {}).get('texture') != 'ghost_piston_top_normal': errors.append(f"{os.path.basename(f)} plate_back!=top_normal")

for f in sorted(glob.glob(os.path.join(bp_blocks, "g_piston_side_f[0-5].json"))):
    mi = mi_of(f)
    if mi.get('top_carried', {}).get('texture') != 'ghost_piston_top_normal': errors.append(f"{os.path.basename(f)} top_carried!=top_normal")
    if mi.get('side', {}).get('texture') != 'ghost_piston_side': errors.append(f"{os.path.basename(f)} side!=side")
for f in sorted(glob.glob(os.path.join(bp_blocks, "g_sticky_piston_f[0-5].json"))):
    mi = mi_of(f)
    if mi.get('top_carried', {}).get('texture') != 'ghost_piston_top_sticky': errors.append(f"{os.path.basename(f)} top_carried!=top_sticky")
    if mi.get('side', {}).get('texture') != 'ghost_piston_side': errors.append(f"{os.path.basename(f)} side!=side")

# --- 4. 引用链路 + 无旧残留 ---
used = set()
for f in glob.glob(os.path.join(bp_blocks, "g_*piston*.json")):
    for name, inst in mi_of(f).items():
        t = inst.get('texture')
        if not t: continue
        used.add(t)
        if t not in tex_data:
            errors.append(f"{os.path.basename(f)} 引用未注册短名 {t}")
        else:
            path = tex_data[t]['textures']
            if not os.path.exists(os.path.join(rp, path + '.png')):
                errors.append(f"注册 {t} 但 png 缺失: {path}.png")

for t in ['ghost_piston_top', 'ghost_piston_plate_side', 'ghost_piston_plate_top', 'ghost_piston_plate_back']:
    if t in used: errors.append(f"仍有 BP 引用旧贴图 {t}")
    if t in tex_data: errors.append(f"terrain_texture 仍注册旧短名 {t}")
    if os.path.exists(os.path.join(tex_ghost, t + '.png')): errors.append(f"旧贴图文件仍在: {t}.png")

print(f"引用的贴图短名: {sorted(used)}")
if errors:
    print("发现错误:")
    for e in errors: print("  -", e)
else:
    print("全部通过: 模型材质名/UV、BP 材质、引用链路、无旧残留均符合新规则")
