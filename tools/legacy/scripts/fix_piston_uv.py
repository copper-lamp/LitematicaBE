import json, os, glob, shutil

models_dir = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\models\blocks"
bak = r"D:\GitHub\LitematicaBE\work\tex_backup3"
os.makedirs(bak, exist_ok=True)

targets = (glob.glob(os.path.join(models_dir, "lit_piston_f[0-5].json"))
           + glob.glob(os.path.join(models_dir, "lit_piston_extended_f[0-5].json"))
           + glob.glob(os.path.join(models_dir, "lit_piston_head_f[0-5].json")))

total = 0
for f in targets:
    shutil.copy(f, os.path.join(bak, os.path.basename(f)))
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    changed = 0
    for geom in data.get('minecraft:geometry', []):
        for bone in geom.get('bones', []):
            for cube in bone.get('cubes', []):
                for face, spec in cube.get('uv', {}).items():
                    sz = spec.get('uv_size')
                    if sz and (sz[0] < 0 or sz[1] < 0):
                        spec['uv'] = [0, 0]
                        spec['uv_size'] = [abs(sz[0]), abs(sz[1])]
                        changed += 1
    if changed:
        with open(f, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        total += changed
        print(f"{os.path.basename(f)}: {changed} 翻转面改正 UV")
print(f"总修复: {total} 处")
