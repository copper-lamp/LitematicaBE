import json, os, re
from PIL import Image

models_dir = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\models\blocks"

print("=== 伸出态模型 inner 面 UV 检查 ===")
for f in sorted(os.listdir(models_dir)):
    if re.fullmatch(r'lit_piston_extended_f[0-5]\.json', f):
        p = os.path.join(models_dir, f)
        with open(p, encoding='utf-8') as fh:
            data = json.load(fh)
        for geom in data.get('minecraft:geometry', []):
            for bone in geom.get('bones', []):
                for cube in bone.get('cubes', []):
                    uv = cube.get('uv', {})
                    for face, spec in uv.items():
                        if spec.get('material_instance') == 'inner':
                            print(f"{f}: face={face} uv={spec.get('uv')} uv_size={spec.get('uv_size')}")

print("\n=== 活塞头模型 plate_side UV 检查 ===")
for f in sorted(os.listdir(models_dir)):
    if re.fullmatch(r'lit_piston_head_f[0-5]\.json', f):
        p = os.path.join(models_dir, f)
        with open(p, encoding='utf-8') as fh:
            data = json.load(fh)
        for geom in data.get('minecraft:geometry', []):
            for bone in geom.get('bones', []):
                for cube in bone.get('cubes', []):
                    uv = cube.get('uv', {})
                    for face, spec in uv.items():
                        if spec.get('material_instance') == 'plate_side':
                            print(f"{f}: face={face} uv={spec.get('uv')} uv_size={spec.get('uv_size')}")

print("\n=== 用户贴图尺寸 ===")
user_dir = r"C:\Users\25491\Desktop\新建文件夹"
for f in sorted(os.listdir(user_dir)):
    if f.endswith('.png'):
        im = Image.open(os.path.join(user_dir, f))
        print(f"{f}: {im.size}")
