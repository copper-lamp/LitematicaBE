import json, os, re, glob

rp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
bp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_BP\blocks"
models = os.path.join(rp, "models", "blocks")

# BP 材质贴图映射：identifier -> {材质名: 贴图}
bp_mats = {}
for f in glob.glob(os.path.join(bp, "g_*piston*.json")):
    d = json.load(open(f, encoding='utf-8'))
    ident = d['minecraft:block']['description']['identifier']
    mi = d['minecraft:block']['components']['minecraft:material_instances']
    bp_mats[ident] = {k: v.get('texture') for k, v in mi.items()}

print("=== 每个活塞模型的活塞头外面贴图（top_normal/top_sticky）面数 ===")
for f in sorted(glob.glob(os.path.join(models, "lit_piston*.json"))):
    base = os.path.basename(f)
    if not re.match(r'lit_piston(f|_extended|_head)_f[0-5]\.json', base): continue
    d = json.load(open(f, encoding='utf-8'))
    # 找对应 BP（从 identifier 反查：geometry.lit_xxx -> g_xxx）
    geo_id = d['minecraft:geometry'][0]['description']['identifier']
    # 反查 BP 引用该 geometry
    bp_ident = None
    for ident, mats in bp_mats.items():
        bd = json.load(open(os.path.join(bp, ident.split(':')[1] + '.json'), encoding='utf-8'))
        if bd['minecraft:block']['components'].get('minecraft:geometry') == geo_id:
            bp_ident = ident; break
    if not bp_ident: continue
    mats = bp_mats[bp_ident]
    head_faces = []
    for g in d['minecraft:geometry']:
        for b in g['bones']:
            for c in b['cubes']:
                for face, spec in c.get('uv', {}).items():
                    m = spec.get('material_instance', '*')
                    tex = mats.get(m, '?')
                    if tex in ('ghost_piston_top_normal', 'ghost_piston_top_sticky'):
                        head_faces.append(f"{face}({m}->{tex})")
    print(f"{base}: 外面面数={len(head_faces)}  {head_faces}")
