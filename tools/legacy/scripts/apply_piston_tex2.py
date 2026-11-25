import json, os, glob

rp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
bp_dir = os.path.join(rp, "..", "LitematicaBE_BP", "blocks")
models_dir = os.path.join(rp, "models", "blocks")

def save(f, data):
    with open(f, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write('\n')

# 1. 伸出态模型：material_instance top->inner, inner->side（同一 face 只判一次，安全）
print("=== 模型材质名调整 ===")
for f in sorted(glob.glob(os.path.join(models_dir, "lit_piston_extended_f*.json"))):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    changed = 0
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    mi = spec.get('material_instance')
                    if mi == 'top':
                        spec['material_instance'] = 'inner'; changed += 1
                    elif mi == 'inner':
                        spec['material_instance'] = 'side'; changed += 1
    if changed:
        save(f, data)
        print(f"  {os.path.basename(f)}: {changed} faces 调整")

# 2. 伸出态 BP：删除 material_instances['top']
print("\n=== 删除伸出态 BP top 材质 ===")
for f in sorted(glob.glob(os.path.join(bp_dir, "g_*extended_f[0-5].json"))):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    mi = data.get('minecraft:block', {}).get('components', {}).get('minecraft:material_instances', {})
    if 'top' in mi:
        del mi['top']
        save(f, data)
        print(f"  {os.path.basename(f)}: 删除 top 材质")

# 3. 活塞头 BP：plate_back -> ghost_piston_top_normal（无论黏性）
print("\n=== 活塞头 plate_back 改 top_normal ===")
for f in sorted(glob.glob(os.path.join(bp_dir, "g_*head_f[0-5].json"))):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    mi = data.get('minecraft:block', {}).get('components', {}).get('minecraft:material_instances', {})
    pb = mi.get('plate_back')
    if pb and pb.get('texture') != 'ghost_piston_top_normal':
        pb['texture'] = 'ghost_piston_top_normal'
        save(f, data)
        print(f"  {os.path.basename(f)}: plate_back -> ghost_piston_top_normal")

# 4. 收缩态黏性 BP：top_carried -> ghost_piston_top_sticky
print("\n=== 收缩态黏性 top_carried 改 sticky ===")
for f in sorted(glob.glob(os.path.join(bp_dir, "g_sticky_piston_f[0-5].json"))):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    mi = data.get('minecraft:block', {}).get('components', {}).get('minecraft:material_instances', {})
    tc = mi.get('top_carried')
    if tc and tc.get('texture') != 'ghost_piston_top_sticky':
        tc['texture'] = 'ghost_piston_top_sticky'
        save(f, data)
        print(f"  {os.path.basename(f)}: top_carried -> ghost_piston_top_sticky")
