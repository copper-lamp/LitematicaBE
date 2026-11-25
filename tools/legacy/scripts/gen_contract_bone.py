# -*- coding: utf-8 -*-
"""收缩态活塞 ghost 模型生成器（用户方案：基准朝上 + bone rotation 整体翻转）。
每个朝向一个模型文件，bone rotation 旋转整个 bone（几何+UV+面材质一起转），
外面(top_carried)自动转到 facing 方向、底面(bottom)转到背面、四面(side)环绕。
"""
import json, os

RP = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\models\blocks"

# 基准(f1 朝上, 外面=up) -> 目标朝向 的 bone rotation（欧拉角，右手定则，度）
# 与 gen_piston_ghost.py 的 rot() 一致：
#   down:[180,0,0]  up:[0,0,0]  north:[-90,0,0]  south:[90,0,0]  west:[0,0,90]  east:[0,0,-90]
FACING_ROT = {
    0: [180, 0, 0],   # down 外面朝下
    1: [0, 0, 0],     # up   外面朝上（基准）
    2: [-90, 0, 0],   # north 外面朝北
    3: [90, 0, 0],    # south 外面朝南
    4: [0, 0, 90],    # west  外面朝西
    5: [0, 0, -90],   # east  外面朝东
}

def make_model(fdir):
    return {
        "format_version": "1.19.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.lit_piston_f{fdir}",
                "texture_width": 16,
                "texture_height": 16,
                "visible_bounds_width": 1,
                "visible_bounds_height": 1,
                "visible_bounds_offset": [0, 0, 0],
            },
            "bones": [{
                "name": "body",
                "pivot": [0, 0, 0],
                "rotation": FACING_ROT[fdir],
                "cubes": [{
                    "origin": [-8, -8, -8],
                    "size": [16, 16, 16],
                    "uv": {
                        "up":    {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "top_carried"},
                        "down":  {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "bottom"},
                        "north": {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "side"},
                        "south": {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "side"},
                        "east":  {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "side"},
                        "west":  {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "side"},
                    },
                }],
            }],
        }],
    }

for fdir in range(6):
    path = os.path.join(RP, f"lit_piston_f{fdir}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(make_model(fdir), fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"lit_piston_f{fdir}.json  rotation={FACING_ROT[fdir]}")
