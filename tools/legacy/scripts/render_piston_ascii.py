# -*- coding: utf-8 -*-
"""render_piston_ascii.py — 活塞 ghost 建模的离屏校验（不依赖游戏）

把 geometry + BP 材质实例按「基岩方块几何」语义搭起来，正交投影后用材质首字母
画成字符图，用来肉眼判读：
  * 伸出态本体侧面是不是 12 高的壳体
  * 内腔面（I）朝哪一侧，横向活塞是否指对方向
  * 头板、细杆、臂段的位置与拼接

朝向已经是硬编码坐标，所以这里不再做任何旋转。

字符：S=活塞侧面 I=内腔 B=底面 T=活塞推面(木) K=活塞推面(粘液)
      P=头板侧 A=臂 R=细杆 C=端盖
用法：python work/render_piston_ascii.py
"""
import json
import os
import sys

from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, 'resources/addon/LitematicaBE_RP')
BP = os.path.join(ROOT, 'resources/addon/LitematicaBE_BP')

TERRAIN = json.load(open(os.path.join(RP, 'textures/terrain_texture.json'), encoding='utf-8'))['texture_data']
CH = {
    'ghost_piston_side': 'S', 'ghost_piston_top_normal': 'T', 'ghost_piston_top_sticky': 'K',
    'ghost_piston_bottom': 'B', 'ghost_piston_inner': 'I', 'ghost_piston_plate_side': 'P',
    'ghost_piston_plate_top': 'T', 'ghost_piston_plate_top_sticky': 'K',
    'ghost_piston_plate_back': 'k', 'ghost_piston_arm1': 'A', 'ghost_piston_arm2': 'R',
    'ghost_piston_arm_cap': 'C',
}

_tex = {}


def tex(name):
    if name not in _tex:
        _tex[name] = Image.open(os.path.join(RP, TERRAIN[name]['textures'] + '.png')).convert('RGBA')
    return _tex[name]


# 面名: (u 方向, v 方向[贴图 v 增大 = 向下]) —— 基岩：north = -Z
FACES = {
    'north': ((1, 0, 0), (0, -1, 0)),
    'south': ((-1, 0, 0), (0, -1, 0)),
    'west': ((0, 0, 1), (0, -1, 0)),
    'east': ((0, 0, -1), (0, -1, 0)),
    'up': ((1, 0, 0), (0, 0, 1)),
    'down': ((1, 0, 0), (0, 0, -1)),
}


def cube_faces(cube, mats):
    ox, oy, oz = cube['origin']
    sx, sy, sz = cube['size']
    out = []
    for fname, (ua, va) in FACES.items():
        data = cube['uv'].get(fname)
        if data is None:
            continue
        tname = mats.get(data.get('material_instance', '*')) or mats.get('*')
        if fname == 'north':
            corner, w, h = (ox, oy + sy, oz), sx, sy
        elif fname == 'south':
            corner, w, h = (ox + sx, oy + sy, oz + sz), sx, sy
        elif fname == 'west':
            corner, w, h = (ox, oy + sy, oz), sz, sy
        elif fname == 'east':
            corner, w, h = (ox + sx, oy + sy, oz + sz), sz, sy
        elif fname == 'up':
            corner, w, h = (ox, oy + sy, oz), sx, sz
        else:
            corner, w, h = (ox, oy, oz + sz), sx, sz
        out.append((corner, ua, va, w, h, tname, data['uv'], data['uv_size']))
    return out


def project(p, view):
    x, y, z = p
    return {
        'south': (x, y), 'north': (-x, y), 'east': (-z, y),
        'west': (z, y), 'up': (x, -z), 'down': (x, z),
    }[view]


def depth_of(p, view):
    x, y, z = p
    return {'south': z, 'north': -z, 'east': x, 'west': -x, 'up': y, 'down': -y}[view]


def render(blocks, view, label, scale=1):
    cells = {}
    for geo, mats, off in blocks:
        for cube in geo['bones'][0]['cubes']:
            for (corner, ua, va, w, h, tname, uv, uvsz) in cube_faces(cube, mats):
                im = tex(tname)
                for i in range(int(round(w))):
                    for j in range(int(round(h))):
                        pu = uv[0] + (i + 0.5) / w * uvsz[0]
                        pv = uv[1] + (j + 0.5) / h * uvsz[1]
                        col = im.getpixel((min(15, int(pu)), min(15, int(pv))))
                        if col[3] < 8:
                            continue
                        p = [corner[k] + ua[k] * (i + 0.5) + va[k] * (j + 0.5) + off[k] for k in range(3)]
                        a, b = project(p, view)
                        d = depth_of(p, view)
                        key = (int(a // scale), int(b // scale))
                        if key not in cells or d > cells[key][0]:
                            cells[key] = (d, CH.get(tname, '?'))
    plane = {k: v[1] for k, v in cells.items()}
    xs = [k[0] for k in plane]
    ys = [k[1] for k in plane]
    print('--- %s  view=%s ---' % (label, view))
    for b in range(max(ys), min(ys) - 1, -1):
        print('   ' + ''.join(plane.get((a, b), '.') for a in range(min(xs), max(xs) + 1)))
    print()


def load(prefix, f):
    b = json.load(open(os.path.join(BP, 'blocks', '%s_f%d.json' % (prefix, f)), encoding='utf-8'))['minecraft:block']
    gid = b['components']['minecraft:geometry'].replace('geometry.', '')
    geo = json.load(open(os.path.join(RP, 'models/blocks', gid + '.json'), encoding='utf-8'))['minecraft:geometry'][0]
    mats = {k: v['texture'] for k, v in b['components']['minecraft:material_instances'].items()}
    return geo, mats


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'

    if which in ('all', 'extended'):
        for f in (1, 5):
            base = load('g_piston_side_extended', f)
            head = load('g_piston_head', f)
            off = {1: [0, 16, 0], 5: [16, 0, 0]}[f]
            name = {1: 'up', 5: 'east'}[f]
            render([(base[0], base[1], [0, 0, 0]), (head[0], head[1], off)],
                   'south' if f == 1 else 'north', '伸出态 普通 朝向=%s（本体+前格）' % name)

    if which in ('all', 'sticky'):
        base = load('g_sticky_piston_extended', 1)
        head = load('g_sticky_piston_head', 1)
        render([(base[0], base[1], [0, 0, 0]), (head[0], head[1], [0, 16, 0])],
               'south', '伸出态 黏性 朝向=up')

    if which in ('all', 'collapsed'):
        for f, name in ((1, 'up'), (5, 'east')):
            base = load('g_piston_side', f)
            render([(base[0], base[1], [0, 0, 0])], 'up', '收回态 普通 朝向=%s 俯视' % name)

    if which in ('all', 'faces'):
        # 只看头板推面：普通应是木色 T，黏性应是粘液 K
        for pref, name in (('g_piston_head', '普通'), ('g_sticky_piston_head', '黏性')):
            head = load(pref, 1)
            render([(head[0], head[1], [0, 0, 0])], 'south', '头格 %s 朝向=up' % name)


if __name__ == '__main__':
    main()
