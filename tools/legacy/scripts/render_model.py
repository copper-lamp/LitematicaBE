"""按 Bedrock JSON 模型面数据做正交渲染，用于自检 ghost 几何/贴图。"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

RP = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
TEXDIR = os.path.join(RP, "textures", "blocks", "ghost")
MODELDIR = os.path.join(RP, "models", "blocks")

# MC/Bedrock 每面顶点顺序：TL, TR, BL, BR（世界坐标 0..16，y 向上）
# 面名 -> 由 (x1,y1,z1)-(x2,y2,z2) 生成四角
def face_corners(face, x1, y1, z1, x2, y2, z2):
    if face == "north":
        return [(x2, y2, z1), (x1, y2, z1), (x1, y1, z1), (x2, y1, z1)]
    if face == "south":
        return [(x1, y2, z2), (x2, y2, z2), (x2, y1, z2), (x1, y1, z2)]
    if face == "west":
        return [(x1, y2, z1), (x1, y2, z2), (x1, y1, z2), (x1, y1, z1)]
    if face == "east":
        return [(x2, y2, z2), (x2, y2, z1), (x2, y1, z1), (x2, y1, z2)]
    if face == "up":
        return [(x1, y2, z2), (x2, y2, z2), (x2, y2, z1), (x1, y2, z1)]
    if face == "down":
        return [(x1, y1, z2), (x2, y1, z2), (x2, y1, z1), (x1, y1, z1)]
    raise ValueError(face)


def load_tex(name):
    p = os.path.join(TEXDIR, name + ".png")
    return np.array(Image.open(p).convert("RGBA"), dtype=np.float64) / 255.0


def render(model_path, texmap, out_path, S=26, dist_scale=1.0, box=False):
    model = json.load(open(model_path, encoding="utf-8"))
    geo = model["minecraft:geometry"][0]
    cubes = geo["bones"][0]["cubes"]

    # 相机（正交）
    d = np.array([1.0, -0.86, 1.0])
    d /= np.linalg.norm(d)
    right = np.cross([0.0, 1.0, 0.0], d)
    right /= np.linalg.norm(right)
    up2 = np.cross(d, right)

    faces = []
    for c in cubes:
        # origin 为中心坐标 -> 世界 0..16
        x1 = c["origin"][0] + 8
        y1 = c["origin"][1]
        z1 = c["origin"][2] + 8
        x2 = x1 + c["size"][0]
        y2 = y1 + c["size"][1]
        z2 = z1 + c["size"][2]
        # 支持 cube.rotation（这里只需要绕 Y 的 ±45°，交叉板用）；pivot 同为中心坐标
        rot = c.get("rotation")
        pivot = c.get("pivot") or [0, 0, 0]
        px, pz = (pivot[0] if rot else 0), (pivot[2] if rot else 0)
        ry = math.radians(rot[1]) if rot else 0.0

        def rp(p):
            if not rot:
                return p
            dx, dz = p[0] - px, p[2] - pz
            return (px + dx * math.cos(ry) + dz * math.sin(ry), p[1], pz - dx * math.sin(ry) + dz * math.cos(ry))

        for fname, fdef in c["uv"].items():
            mat = fdef.get("material_instance", "*")
            tex = texmap.get(mat, "ghost_generic")
            uv = fdef["uv"]
            uvsize = fdef["uv_size"]
            corners = [rp(p) for p in face_corners(fname, x1, y1, z1, x2, y2, z2)]
            faces.append({"corners": corners, "uv": uv, "uvsize": uvsize, "tex": tex, "face": fname})

    # 屏幕投影
    def project(p):
        p = np.array(p, dtype=float)
        return np.array([np.dot(p, right) * S, -np.dot(p, up2) * S])

    pts = [project(c) for f in faces for c in f["corners"]]
    # box=True：把整格 0..16 的立方体也纳入画布范围，这样半格/平移能看出相对位置
    if box:
        for cx in (0.0, 16.0):
            for cy in (0.0, 16.0):
                for cz in (0.0, 16.0):
                    pts.append(project((cx, cy, cz)))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs); miny, maxy = min(ys), max(ys)
    pad = 8
    W = int(maxx - minx) + pad * 2; H = int(maxy - miny) + pad * 2
    canvas = Image.new("RGBA", (W, H), (250, 250, 252, 255))
    arr = np.array(canvas, dtype=np.float64) / 255.0
    zbuf = np.full((H, W), -1e9)

    def to_screen(p):
        q = project(p)
        return np.array([q[0] - minx + pad, q[1] - miny + pad])

    # 按面中心深度排序（远的先画）
    for f in faces:
        f["depth"] = np.mean([np.dot(np.array(c, dtype=float), -d) for c in f["corners"]])
    faces.sort(key=lambda f: f["depth"])

    for f in faces:
        p0, p1, p2, p3 = [to_screen(c) for c in f["corners"]]
        # 跳过退化（numpy 2.x 的 np.cross 不再接受 2D 向量，手写标量叉积）
        if abs((p1[0] - p0[0]) * (p3[1] - p0[1]) - (p1[1] - p0[1]) * (p3[0] - p0[0])) < 1e-6:
            continue
        tex = load_tex(f["tex"])
        th, tw = tex.shape[:2]
        u0, v0 = f["uv"]; uw, vh = f["uvsize"]
        # 贴图在 quad 上的采样：corner TL=(u0,v0), TR=(u0+uw,v0), BL=(u0,v0+vh), BR=+both
        bbox_min = np.floor(np.minimum.reduce([p0, p1, p2, p3])).astype(int)
        bbox_max = np.ceil(np.maximum.reduce([p0, p1, p2, p3])).astype(int)
        bbox_min = np.maximum(bbox_min, 0); bbox_max = np.minimum(bbox_max, [W, H])
        if (bbox_max <= bbox_min).any():
            continue
        # 重心坐标基
        e1 = p1 - p0
        e2 = p3 - p0
        det = e1[0] * e2[1] - e1[1] * e2[0]
        if abs(det) < 1e-9:
            continue
        for yy in range(bbox_min[1], bbox_max[1]):
            for xx in range(bbox_min[0], bbox_max[0]):
                q = np.array([xx + 0.5, yy + 0.5]) - p0
                a = (q[0] * e2[1] - q[1] * e2[0]) / det
                b = (e1[0] * q[1] - e1[1] * q[0]) / det
                if a < -0.002 or a > 1.002 or b < -0.002 or b > 1.002:
                    continue
                # 对面的四点（可能平行四边形，a/b 有效）
                u = u0 + a * uw
                v = v0 + b * vh
                if u < 0 or u >= tw or v < 0 or v >= th:
                    continue
                col = tex[int(v), int(u)]
                if col[3] <= 0.004:
                    continue
                dst = arr[yy, xx]
                a_f = col[3]
                arr[yy, xx, :3] = arr[yy, xx, :3] * (1 - a_f) + col[:3] * a_f
                arr[yy, xx, 3] = 1.0

    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGBA")
    if box:
        # 整格线框：给"半格 / 平移 / 上下翻转"一个参照
        d = ImageDraw.Draw(img)
        cs = {(a, b, c): tuple(to_screen((a, b, c))) for a in (0.0, 16.0) for b in (0.0, 16.0) for c in (0.0, 16.0)}
        edges = [
            ((0, 0, 0), (16, 0, 0)), ((0, 0, 16), (16, 0, 16)), ((0, 16, 0), (16, 16, 0)), ((0, 16, 16), (16, 16, 16)),
            ((0, 0, 0), (0, 0, 16)), ((16, 0, 0), (16, 0, 16)), ((0, 16, 0), (0, 16, 16)), ((16, 16, 0), (16, 16, 16)),
            ((0, 0, 0), (0, 16, 0)), ((16, 0, 0), (16, 16, 0)), ((0, 0, 16), (0, 16, 16)), ((16, 0, 16), (16, 16, 16)),
        ]
        for p, q in edges:
            d.line([cs[p], cs[q]], fill=(170, 170, 182, 255), width=1)
    img = img.resize((img.width * 2, img.height * 2), Image.NEAREST)
    img.save(out_path)
    return out_path


TEXTURES = {
    "*": "ghost_comp_slab",
    "top": "ghost_repeater_off",
    "torch": "ghost_rtorch_off",
    "lamp": "ghost_rtorch_off",
}

if __name__ == "__main__":
    jobs = [
        ("lit_repeater.json", {**TEXTURES, "top": "ghost_repeater_off"}, "repeater_off.png"),
        ("lit_repeater_on.json", {**TEXTURES, "top": "ghost_repeater_on", "torch": "ghost_rtorch_on"}, "repeater_on.png"),
        ("lit_repeater_d1.json", {**TEXTURES, "top": "ghost_repeater_off"}, "repeater_d1.png"),
        ("lit_repeater_d3.json", {**TEXTURES, "top": "ghost_repeater_off"}, "repeater_d3.png"),
        ("lit_comparator.json", {**TEXTURES, "top": "ghost_comparator_off"}, "comparator_off.png"),
        ("lit_comparator_on.json", {**TEXTURES, "top": "ghost_comparator_on", "torch": "ghost_rtorch_on"}, "comparator_on.png"),
        ("lit_comparator_sub.json", {**TEXTURES, "top": "ghost_comparator_off", "lamp": "ghost_rtorch_on"}, "comparator_sub.png"),
    ]
    outdir = r"D:\GitHub\LitematicaBE\work\render"
    os.makedirs(outdir, exist_ok=True)
    for m, tm, out in jobs:
        p = render(os.path.join(MODELDIR, m), tm, os.path.join(outdir, out))
        print("saved", p)
