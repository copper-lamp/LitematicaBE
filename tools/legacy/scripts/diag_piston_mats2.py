import json, os, re, glob

rp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
bp = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_BP\blocks"
models = os.path.join(rp, "models", "blocks")

# 建立 geometry 名 -> BP identifier + 材质贴图 映射
geo2mats = {}
for f in glob.glob(os.path.join(bp, "g_*.json")):
    d = json.load(open(f, encoding='utf-8'))
    comp = d['minecraft:block']['components']
    geo = comp.get('minecraft:geometry')
    ident = d['minecraft:block']['description']['identifier']
    mi = comp.get('minecraft:material_instances', {})
    geo2mats.setdefault(geo, []).append((ident, {k: v.get('texture') for k, v in mi.items()}))

print("=== 活塞模型每面贴图（统计 top_normal/sticky 面数）===")
for f in sorted(glob.glob(os.path.join(models, "lit_piston*.json"))):
    base = os.path.basename(f)
    if not re.match(r'lit_piston(f|_extended|_head)_f[0-5]\.json', base): continue
    d = json.load(open(f, encoding='utf-8'))
    geo_id = d['minecraft:geometry'][0]['description']['identifier']
    cands = geo2mats.get(geo_id)
    if not cands:
        print(f"{base}: 无匹配 BP"); continue
    ident, mats = cands[0]
    head_faces, all_faces = [], []
    for g in d['minecraft:geometry']:
        for b in g['bones']:
            for c in b['cubes']:
                for face, spec in c.get('uv', {}).items():
                    m = spec.get('material_instance', '*')
                    tex = mats.get(m, '?')
                    all_faces.append(f"{face}={m}->{tex}")
                    if tex in ('ghost_piston_top_normal', 'ghost_piston_top_sticky'):
                        head_faces.append(f"{face}({m}->{tex})")
    print(f"{base} [{ident}] 外面面数={len(head_faces)}")
    print(f"    {head_faces if head_faces else '无'}")
