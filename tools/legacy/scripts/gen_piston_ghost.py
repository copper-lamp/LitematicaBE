# -*- coding: utf-8 -*-
"""活塞 ghost 几何重建器（从零生成，不读任何旧模型/文档）。

方案：
  收缩态      1 cube：16x16x16，四侧 side，推面 top_carried，背面 bottom
  伸出态本体  cube1 16x12x16（四侧 inner、背面 bottom、前脸 top）
              cube2 6x4x6 臂段（本格内 12..16）
  头格        cube 6x4x6 臂段(0..4) + 4x8x4 杆(4..12) + 16x4x16 板(12..16)
  六朝向：以「朝上」为基准做刚体旋转，坐标硬编码，不用 transformation。
"""
import json, os

BP = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_BP\blocks"
RP = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\models\blocks"

FACING = {0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east'}

# ---- 旋转：把 +y（基准推出方向）转到目标方向；点以方块中心为原点 ----
def rot(name):
    return {
        'up':    lambda x, y, z: (x, y, z),
        'down':  lambda x, y, z: (x, -y, -z),
        'north': lambda x, y, z: (x, z, -y),
        'south': lambda x, y, z: (x, -z, y),
        'east':  lambda x, y, z: (y, -x, z),
        'west':  lambda x, y, z: (-y, x, z),
    }[name]

# 基准面法向量
NORMALS = {
    'up': (0, 1, 0), 'down': (0, -1, 0),
    'north': (0, 0, -1), 'south': (0, 0, 1),
    'east': (1, 0, 0), 'west': (-1, 0, 0),
}
def face_of(vec):
    for k, v in NORMALS.items():
        if v == vec:
            return k
    raise ValueError(vec)

def uv_all(u, v, w, h):
    return {k: {"uv": [u, v], "uv_size": [w, h]} for k in NORMALS}

# 基准 cube（朝上姿态，中心坐标系，y 已居中：几何 y 0..16 → -8..8）
# 每项：origin(px, 中心系), size, 语义面 -> (uv原点, uv尺寸, 材质)
BASE_BODY_CONTRACT = {
    'origin': (-8, -8, -8), 'size': (16, 16, 16),
    'faces': {
        'up':    ([0, 0], [16, 16], 'top_carried'),
        'down':  ([0, 0], [16, 16], 'bottom'),
        'north': ([0, 0], [16, 16], 'side'),
        'south': ([0, 0], [16, 16], 'side'),
        'east':  ([0, 0], [16, 16], 'side'),
        'west':  ([0, 0], [16, 16], 'side'),
    },
}

BASE_BODY_EXT = {
    'origin': (-8, -8, -8), 'size': (16, 12, 16),   # y: -8..4
    'faces': {
        'up':    ([0, 0], [16, 16], 'inner'),
        'down':  ([0, 0], [16, 16], 'bottom'),
        'north': ([0, 0], [16, 12], 'side'),
        'south': ([0, 0], [16, 12], 'side'),
        'east':  ([0, 0], [16, 12], 'side'),
        'west':  ([0, 0], [16, 12], 'side'),
    },
}

BASE_EXT_ARM = {   # 本体格内的臂段，y 4..8
    'origin': (-3, 4, -3), 'size': (6, 4, 6),
    'faces': {
        'up':    ([0, 0], [6, 6], 'arm_end'),
        'down':  ([0, 0], [6, 6], 'arm_end'),
        'north': ([0, 0], [6, 4], 'arm_stub'),
        'south': ([0, 0], [6, 4], 'arm_stub'),
        'east':  ([0, 0], [6, 4], 'arm_stub'),
        'west':  ([0, 0], [6, 4], 'arm_stub'),
    },
}

BASE_HEAD_ARM = {  # 头格：臂段 y -8..-4
    'origin': (-3, -8, -3), 'size': (6, 4, 6),
    'faces': BASE_EXT_ARM['faces'],
}

BASE_HEAD_ROD = {  # 头格：杆 y -4..4
    'origin': (-2, -4, -2), 'size': (4, 8, 4),
    'faces': {
        'up':    ([0, 0], [4, 4], 'arm_rod'),
        'down':  ([0, 0], [4, 4], 'arm_rod'),
        'north': ([0, 0], [4, 8], 'arm_rod'),
        'south': ([0, 0], [4, 8], 'arm_rod'),
        'east':  ([0, 0], [4, 8], 'arm_rod'),
        'west':  ([0, 0], [4, 8], 'arm_rod'),
    },
}

BASE_HEAD_PLATE = {  # 头格：板 y 4..8
    'origin': (-8, 4, -8), 'size': (16, 4, 16),
    'faces': {
        'up':    ([0, 0], [16, 16], 'plate_top'),
        'down':  ([0, 0], [16, 16], 'plate_back'),
        'north': ([0, 0], [16, 4], 'plate_side'),
        'south': ([0, 0], [16, 4], 'plate_side'),
        'east':  ([0, 0], [16, 4], 'plate_side'),
        'west':  ([0, 0], [16, 4], 'plate_side'),
    },
}


def transform_cube(base, facing):
    """把基准 cube 旋转到 facing 朝向，返回 geometry cube。"""
    R = rot(facing)
    ox, oy, oz = base['origin']
    sx, sy, sz = base['size']
    corners = []
    for dx in (0, sx):
        for dy in (0, sy):
            for dz in (0, sz):
                corners.append(R(ox + dx, oy + dy, oz + dz))
    xs = [c[0] for c in corners]; ys = [c[1] for c in corners]; zs = [c[2] for c in corners]
    nx0, ny0, nz0 = min(xs), min(ys), min(zs)
    nsz = [max(xs) - nx0, max(ys) - ny0, max(zs) - nz0]
    origin = [nx0, ny0 + 8, nz0]

    uv = {}
    for face, vec in NORMALS.items():
        nv = R(*vec)
        target = face_of(nv)          # 语义面 → 旋转后的几何面
        u0, u1, mat = base['faces'][face]
        uv[target] = {"uv": list(u0), "uv_size": list(u1), "material_instance": mat}
    return {"origin": [round(v, 4) for v in origin],
            "size": [round(v, 4) for v in nsz],
            "uv": uv}


def geometry(identifier, cubes):
    return {
        "format_version": "1.19.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": identifier,
                "texture_width": 16,
                "texture_height": 16,
                "visible_bounds_width": 3,
                "visible_bounds_height": 3,
                "visible_bounds_offset": [0, 1, 0],
            },
            "bones": [{"name": "body", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }


def dump(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


MATERIAL_DEFAULTS = lambda: {
    "side": "ghost_piston_side",
    "bottom": "ghost_piston_bottom",
}


def mat_instances(pairs):
    return {
        k: {"texture": v, "render_method": "blend",
            "face_dimming": False, "ambient_occlusion": False}
        for k, v in pairs.items()
    }


def block_def(identifier, geo, mats):
    return {
        "format_version": "1.21.70",
        "minecraft:block": {
            "description": {
                "identifier": identifier,
                "menu_category": {"category": "none"},
            },
            "components": {
                "minecraft:geometry": geo,
                "minecraft:material_instances": mats,
                "minecraft:collision_box": False,
                "minecraft:selection_box": False,
                "minecraft:destructible_by_mining": False,
                "minecraft:destructible_by_explosion": False,
                "minecraft:replaceable": {},
                "minecraft:light_dampening": 0,
                "minecraft:map_color": "#888888",
            },
        },
    }


os.makedirs(RP, exist_ok=True)
os.makedirs(BP, exist_ok=True)

for f, fname in FACING.items():
    # ---------- 1. 收缩态 ----------
    geo = geometry(f"geometry.lit_piston_f{f}", [transform_cube(BASE_BODY_CONTRACT, fname)])
    dump(os.path.join(RP, f"lit_piston_f{f}.json"), geo)
    for prefix, top, sticky in (("g_piston_side", "ghost_piston_top_normal", False),
                                ("g_sticky_piston", "ghost_piston_top_sticky", False)):
        mats = mat_instances({"side": "ghost_piston_side",
                              "bottom": "ghost_piston_bottom",
                              "top_carried": top})
        dump(os.path.join(BP, f"{prefix}_f{f}.json"),
             block_def(f"lit:{prefix}_f{f}", f"geometry.lit_piston_f{f}", mats))

    # ---------- 2. 伸出态本体 ----------
    cubes = [transform_cube(BASE_BODY_EXT, fname), transform_cube(BASE_EXT_ARM, fname)]
    dump(os.path.join(RP, f"lit_piston_extended_f{f}.json"),
         geometry(f"geometry.lit_piston_extended_f{f}", cubes))
    for prefix, sticky in (("g_piston_side_extended", False),
                           ("g_sticky_piston_extended", True)):
        mats = mat_instances({"side": "ghost_piston_side_spec",
                              "bottom": "ghost_piston_bottom",
                              "inner": "ghost_piston_inner",
                              "arm_stub": "ghost_piston_arm_stub",
                              "arm_end": "ghost_piston_arm_end"})
        dump(os.path.join(BP, f"{prefix}_f{f}.json"),
             block_def(f"lit:{prefix}_f{f}", f"geometry.lit_piston_extended_f{f}", mats))

    # ---------- 3. 头格 ----------
    cubes = [transform_cube(BASE_HEAD_ARM, fname),
             transform_cube(BASE_HEAD_ROD, fname),
             transform_cube(BASE_HEAD_PLATE, fname)]
    dump(os.path.join(RP, f"lit_piston_head_f{f}.json"),
         geometry(f"geometry.lit_piston_head_f{f}", cubes))
    for prefix in ("g_piston_head", "g_sticky_piston_head"):
        head_top = "ghost_piston_top_normal" if prefix == "g_piston_head" else "ghost_piston_top_sticky"
        mats = mat_instances({"arm_stub": "ghost_piston_arm_stub",
                              "arm_end": "ghost_piston_arm_end",
                              "arm_rod": "ghost_piston_arm_rod",
                              "plate_side": "ghost_piston_top_side",
                              "plate_top": head_top,
                              "plate_back": "ghost_piston_top_normal"})
        dump(os.path.join(BP, f"{prefix}_f{f}.json"),
             block_def(f"lit:{prefix}_f{f}", f"geometry.lit_piston_head_f{f}", mats))

print("生成完成：几何 18 / BP 36")
