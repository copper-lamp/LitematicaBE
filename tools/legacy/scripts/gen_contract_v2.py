# -*- coding: utf-8 -*-
"""收缩态活塞六向模型生成器 v2（用户方案：预旋转 length/cross 贴图，四面木制头朝外面）。
复用 gen_piston_ghost.transform_cube（几何旋转 + 底部系 + 面材质分配），
覆盖四面 side 的 UV，使木制头（length 头在贴图 v=0 顶部 / cross 头在 u=16 右侧）朝外面(F)。
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_piston_ghost import transform_cube, BASE_BODY_CONTRACT, FACING

RP = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\models\blocks"

# 基岩版面 t 的 v=0 方向（正 UV 时贴图 v=0 顶部朝哪）
V0 = {
    'up': (0, 0, -1),   # 北（还原：1.1.65 原假设）
    'down': (0, 0, 1),  # 南
    'north': (0, 1, 0), 'south': (0, 1, 0),
    'east': (0, 1, 0), 'west': (0, 1, 0),
}
# 基岩版面 t 的 u 轴正方向（正 UV 时贴图 u=16 右侧朝哪）
UA = {
    'up': (1, 0, 0), 'down': (1, 0, 0),
    'south': (1, 0, 0), 'north': (-1, 0, 0),
    'east': (0, 0, -1), 'west': (0, 0, 1),
}
# facing_direction -> 外面向量 F
F = {
    'up': (0, 1, 0), 'down': (0, -1, 0),
    'north': (0, 0, -1), 'south': (0, 0, 1),
    'west': (-1, 0, 0), 'east': (1, 0, 0),
}


def side_uv(face, Fv):
    """返回 (uv, uv_size, texture_key)。length 头朝 F 用 v 翻转，cross 头朝 F 用 u 翻转。"""
    v0, ua = V0[face], UA[face]
    if v0 == Fv:
        return [0, 0], [16, 16], 'side_length'
    if tuple(-x for x in v0) == Fv:
        return [0, 16], [16, -16], 'side_length'
    if ua == Fv or tuple(-x for x in ua) == Fv:
        # 用户确认：cross 贴图正立，不旋转（朝东时 xoy/xoz 平面 cross 均不旋转）
        return [0, 0], [16, 16], 'side_cross'
    # 兜底：优先 length（头朝 v0 最近方向）
    return [0, 0], [16, 16], 'side_length'


def make_model(fdir):
    fname = FACING[fdir]
    cube = transform_cube(BASE_BODY_CONTRACT, fname)
    Fv = F[fname]
    for face in ('north', 'south', 'east', 'west', 'up', 'down'):
        pass
    # 四面 side = 旋转后不是 top_carried/bottom 的面
    side_faces = [k for k, v in cube['uv'].items() if v['material_instance'] == 'side']
    for face in side_faces:
        uv, uv_size, tex = side_uv(face, Fv)
        cube['uv'][face] = {"uv": uv, "uv_size": uv_size, "material_instance": tex}
    return {
        "format_version": "1.19.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.lit_piston_f{fdir}",
                "texture_width": 16, "texture_height": 16,
                "visible_bounds_width": 3, "visible_bounds_height": 3,
                "visible_bounds_offset": [0, 1, 0],
            },
            "bones": [{"name": "body", "pivot": [0, 0, 0], "cubes": [cube]}],
        }],
    }


for fdir in range(6):
    path = os.path.join(RP, f"lit_piston_f{fdir}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(make_model(fdir), fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"lit_piston_f{fdir}.json 生成（{FACING[fdir]} 外面）")
