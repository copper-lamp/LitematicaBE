import json, os, re, glob

rp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
bp_dir = os.path.join(rp, "..", "LitematicaBE_BP", "blocks")
models_dir = os.path.join(rp, "models", "blocks")

# ---- 1. 伸出态模型 inner 面 UV: 16x16 -> 16x12 ----
print("=== 模型 UV 修改 ===")
for f in sorted(glob.glob(os.path.join(models_dir, "lit_piston_extended_f*.json"))):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    changed = 0
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                uv = cube.get('uv', {})
                for face, spec in uv.items():
                    if spec.get('material_instance') == 'inner':
                        if spec.get('uv') == [16, 16]:
                            spec['uv'] = [16, 12]
                        if spec.get('uv_size') == [-16, -16]:
                            spec['uv_size'] = [-16, -12]
                        changed += 1
    if changed:
        with open(f, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        print(f"  {os.path.basename(f)}: {changed} inner faces -> 16x12")

# ---- 2. BP material_instances texture 更新 ----
def map_texture(fname, mi_name, cur):
    base = os.path.basename(fname)
    if re.match(r'g_piston_side_f[0-5]\.json$', base):
        return {'top_carried': 'ghost_piston_top_normal'}.get(mi_name, cur)
    if re.match(r'g_sticky_piston_f[0-5]\.json$', base):
        # 黏性本体：按"其它规则与活塞一致"→ 顶面用普通 top_normal
        return {'top_carried': 'ghost_piston_top_normal'}.get(mi_name, cur)
    if re.match(r'g_piston_side_extended_f[0-5]\.json$', base):
        return {'side': 'ghost_piston_side_spec', 'top': 'ghost_piston_top_normal'}.get(mi_name, cur)
    if re.match(r'g_sticky_piston_extended_f[0-5]\.json$', base):
        return {'side': 'ghost_piston_side_spec', 'top': 'ghost_piston_top_normal'}.get(mi_name, cur)
    if re.match(r'g_piston_head_f[0-5]\.json$', base):
        return {'plate_side': 'ghost_piston_top_side', 'plate_top': 'ghost_piston_top_normal'}.get(mi_name, cur)
    if re.match(r'g_sticky_piston_head_f[0-5]\.json$', base):
        return {'plate_side': 'ghost_piston_top_side', 'plate_top': 'ghost_piston_top_sticky'}.get(mi_name, cur)
    return cur

print("\n=== BP 贴图引用更新 ===")
total_bp = 0
for f in sorted(glob.glob(os.path.join(bp_dir, "g_*piston*.json"))):
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    comps = data.get('minecraft:block', {}).get('components', {})
    mi = comps.get('minecraft:material_instances', {})
    changed = 0
    for name, inst in mi.items():
        cur = inst.get('texture')
        new = map_texture(f, name, cur)
        if new != cur:
            inst['texture'] = new
            changed += 1
    if changed:
        with open(f, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        total_bp += changed
        print(f"  {os.path.basename(f)}: {changed} texture updated")
print(f"  BP 总更新数: {total_bp}")
