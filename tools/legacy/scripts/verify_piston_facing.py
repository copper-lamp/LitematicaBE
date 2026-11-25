# -*- coding: utf-8 -*-
"""verify_piston_facing.py — 校验 36 个活塞 ghost 方块的朝向是否严格对应 facing_direction

facing_direction 语义（基岩版）：0=down 1=up 2=north(-Z) 3=south(+Z) 4=west(-X) 5=east(+X)
活塞臂必须沿这个方向伸出，内腔面必须朝这个方向。
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
BASE = r'D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\models\blocks'
DIR = {0: (0, -1, 0), 1: (0, 1, 0), 2: (0, 0, -1), 3: (0, 0, 1), 4: (-1, 0, 0), 5: (1, 0, 0)}
NAME = {0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east'}


def cubes(name, f):
    p = os.path.join(BASE, f'{name}_f{f}.json')
    return json.load(open(p, encoding='utf-8'))['minecraft:geometry'][0]['bones'][0]['cubes']


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def center(c):
    return [c['origin'][i] + c['size'][i] / 2 for i in range(3)]


fail = 0
print('=== 伸出态 base：臂段必须朝 facing_direction 方向 ===')
for f in range(6):
    cs = cubes('lit_piston_extended', f)
    body, arm = cs[0], cs[1]
    ac = center(arm)
    bc = center(body)
    rel = [ac[i] - bc[i] for i in range(3)]
    ok = dot(rel, DIR[f]) > 0
    inner = [k for k, v in body['uv'].items() if v['material_instance'] == 'inner']
    inner_ok = inner == [NAME[f]]
    if not (ok and inner_ok):
        fail += 1
    print('  f={} {:6s} 臂心={} 相对本体={} 内腔面={} {}'.format(
        f, NAME[f], [round(v, 1) for v in ac], [round(v, 1) for v in rel], inner,
        'OK' if ok and inner_ok else 'FAIL'))

print()
print('=== 头格：头板必须落在朝向一侧 ===')
for f in range(6):
    cs = cubes('lit_piston_head', f)
    plate = cs[2]
    pc = center(plate)
    rel = [pc[0], pc[1] - 8, pc[2]]
    ok = dot(rel, DIR[f]) > 0
    if not ok:
        fail += 1
    print('  f={} {:6s} 头板心={} 相对格心={} {}'.format(
        f, NAME[f], [round(v, 1) for v in pc], [round(v, 1) for v in rel], 'OK' if ok else 'FAIL'))

print()
print('=== 收回态：整格 16/16，顶面朝 facing_direction ===')
for f in range(6):
    cs = cubes('lit_piston', f)
    c = cs[0]
    size_ok = c['size'] == [16, 16, 16] and c['origin'] == [-8, 0, -8]
    top_faces = [k for k, v in c['uv'].items() if v['material_instance'] == 'top']
    ok = size_ok and top_faces == [NAME[f]]
    if not ok:
        fail += 1
    print('  f={} {:6s} size={} 活塞面={} {}'.format(
        f, NAME[f], c['size'], top_faces, 'OK' if ok else 'FAIL'))

print()
print('=== 全部 cube 是否仍在 0..16 方块内 ===')
for name in ('lit_piston', 'lit_piston_extended', 'lit_piston_head'):
    for f in range(6):
        for c in cubes(name, f):
            ox, oy, oz = c['origin']
            sx, sy, sz = c['size']
            bad = []
            if oy < -0.01 or oy + sy > 16.01:
                bad.append('y {}..{}'.format(oy, oy + sy))
            if ox < -8.01 or ox + sx > 8.01:
                bad.append('x {}..{}'.format(ox, ox + sx))
            if oz < -8.01 or oz + sz > 8.01:
                bad.append('z {}..{}'.format(oz, oz + sz))
            if bad:
                fail += 1
                print('  FAIL {}_{} cube {}'.format(name, f, ' '.join(bad)))
print('  检查完毕' if fail == 0 else '')
print()
print('结果：{}'.format('PASS' if fail == 0 else 'FAIL {} 项'.format(fail)))
sys.exit(0 if fail == 0 else 1)
