"""只渲染底座 up 面（顶视图），验证顶面贴图方向。"""
import json, os
import numpy as np
from PIL import Image

RP = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP"
TEXDIR = os.path.join(RP, "textures", "blocks", "ghost")
MODELDIR = os.path.join(RP, "models", "blocks")

S = 32
def render_top(model_file, top_tex, out):
    model = json.load(open(os.path.join(MODELDIR, model_file), encoding="utf-8"))
    cubes = model["minecraft:geometry"][0]["bones"][0]["cubes"]
    base = cubes[0]
    tex = np.array(Image.open(os.path.join(TEXDIR, top_tex + ".png")).convert("RGBA"), dtype=float) / 255.0
    th, tw = tex.shape[:2]
    u0, v0 = base["uv"]["up"]["uv"]
    uw, vh = base["uv"]["up"]["uv_size"]
    W = 16 * S
    img = np.zeros((W, W, 4), dtype=float)
    img[..., :3] = 0.15
    img[..., 3] = 1
    # up 面：屏幕 x = 世界 x，屏幕 y = 世界 z（从上方看，北在上）
    # MC 约定：u 沿 +x，v 沿 -z（v 小 = 南边）
    for sy in range(W):
        for sx in range(W):
            x = (sx + 0.5) / S      # 0..16
            z = (sy + 0.5) / S
            u = u0 + (x / 16.0) * uw
            v = v0 + ((16.0 - z) / 16.0) * vh
            if 0 <= u < tw and 0 <= v < th:
                c = tex[int(v), int(u)]
                if c[3] > 0:
                    img[sy, sx, :3] = c[:3]
                    img[sy, sx, 3] = 1
    Image.fromarray((img * 255).astype(np.uint8), "RGBA").save(out)
    print("saved", out)

os.makedirs(r"D:\GitHub\LitematicaBE\work\render", exist_ok=True)
render_top("lit_repeater.json", "ghost_repeater_off", r"D:\GitHub\LitematicaBE\work\render\top_repeater_off.png")
render_top("lit_comparator.json", "ghost_comparator_off", r"D:\GitHub\LitematicaBE\work\render\top_comparator_off.png")
