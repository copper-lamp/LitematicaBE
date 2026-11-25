import json, os, re, glob

root = r"D:\GitHub\LitematicaBE\resources\addon"
rp = os.path.join(root, "LitematicaBE_RP")
bp_blocks = os.path.join(root, "LitematicaBE_BP", "blocks")
models = os.path.join(rp, "models", "blocks")
tex_ghost = os.path.join(rp, "textures", "blocks", "ghost")
terrain = os.path.join(rp, "textures", "terrain_texture.json")

errors = []

# 1. 所有改动的 JSON 有效
check_files = (glob.glob(os.path.join(models, "lit_piston_extended_f*.json"))
               + glob.glob(os.path.join(models, "lit_piston_head_f*.json"))
               + glob.glob(os.path.join(bp_blocks, "g_*piston*.json"))
               + [terrain])
for f in check_files:
    try:
        with open(f, encoding='utf-8') as fh:
            json.load(fh)
    except Exception as e:
        errors.append(f"JSON 无效 {os.path.basename(f)}: {e}")

# 2. terrain_texture 注册表
with open(terrain, encoding='utf-8') as fh:
    tt = json.load(fh)
tex_data = tt.get('texture_data', {})

# 3. 每个 BP 引用的 texture 短名 -> 注册 -> png 存在
used = set()
for f in glob.glob(os.path.join(bp_blocks, "g_*piston*.json")):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    mi = data.get('minecraft:block', {}).get('components', {}).get('minecraft:material_instances', {})
    for name, inst in mi.items():
        t = inst.get('texture')
        if t:
            used.add(t)
            if t not in tex_data:
                errors.append(f"{os.path.basename(f)} 引用未注册短名 {t}")
            else:
                path = tex_data[t]['textures']  # 'textures/blocks/ghost/xxx'
                png = os.path.join(rp, path + '.png')
                if not os.path.exists(png):
                    errors.append(f"注册 {t} 但 png 缺失: {path}.png")

# 4. 无旧引用残留
old = ['ghost_piston_top', 'ghost_piston_plate_side', 'ghost_piston_plate_top']
for t in old:
    if t in used:
        errors.append(f"仍有 BP 引用旧贴图 {t}")
    if t in tex_data:
        errors.append(f"terrain_texture 仍注册旧短名 {t}")
    png = os.path.join(tex_ghost, t + '.png')
    if os.path.exists(png):
        errors.append(f"旧贴图文件仍在: {t}.png")

# 5. UV 检查
for f in glob.glob(os.path.join(models, "lit_piston_extended_f*.json")):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    if spec.get('material_instance') == 'inner':
                        if spec.get('uv_size') != [-16, -12] or spec.get('uv') != [16, 12]:
                            errors.append(f"{os.path.basename(f)} {face} inner uv 未改: {spec.get('uv')}/{spec.get('uv_size')}")
for f in glob.glob(os.path.join(models, "lit_piston_head_f*.json")):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    if spec.get('material_instance') == 'plate_side':
                        if spec.get('uv_size') != [16, 4]:
                            errors.append(f"{os.path.basename(f)} {face} plate_side uv 异常: {spec.get('uv_size')}")

# 6. 输出
print(f"检查文件数: {len(check_files)}, 引用的贴图短名: {sorted(used)}")
if errors:
    print("发现错误:")
    for e in errors:
        print("  -", e)
else:
    print("全部通过: JSON 有效、引用链路完整、无旧引用残留、UV 正确")
