# LitematicaBE 模型查看器

不进游戏即可预览、对比、校验 `resources/addon/LitematicaBE_RP/models/blocks/` 下的基岩版方块几何模型（`lit_*.json`，格式 `minecraft:geometry`），并自动关联 BP 方块定义里的真实幽灵纹理（`textures/blocks/ghost/*.png`）。

## 特性

- **模型浏览器**：列出全部 58 个 `lit_*` 模型，按家族分组，支持搜索。
- **材质/纹理关联**：选中模型 → 自动列出所有使用该几何的 BP 方块 → 一键切换贴图（含"纯色"）。
- **变体导航**：`◀ 上一个 / 下一个 ▶` 在家族内切换（composter l1-l8、piston f0-f5、repeater d1-d3、door/trapdoor 开合、stairs 上下、comparator sub/on 等）。
- **视口**：轨道旋转/缩放/平移、线框叠加、双面渲染、可见包围盒、坐标轴、相机预设（前/顶/等距/重置）。
- **方块变换预览**：可应用 BP 方块 `minecraft:transformation`（旋转/缩放/平移，绕方块中心）。
- **UV/几何校验**：右侧实时显示结构检查（缺 uv、负尺寸、越界、UV 超出图集、缺 pivot 等）。
- **无头体检**：`check.mjs` 校验所有模型并输出报告（可 `--json`，可作 CI 检查）。
- **无光照渲染**：与原版一致（这些 ghost 方块 `face_dimming:false` / `ambient_occlusion:false`），用 `MeshBasicMaterial` 忠实还原建模与贴图，不做光影模拟。

## 运行

```shell
node tools/model-viewer/server.mjs        # 启动，默认 http://localhost:8123
node tools/model-viewer/server.mjs 9000   # 指定端口
```

浏览器打开 `http://localhost:8123/`。

无头体检：

```shell
node tools/model-viewer/check.mjs         # 人类可读报告（有错误则退出码 1）
node tools/model-viewer/check.mjs --json  # 机器可读 JSON
node tools/model-viewer/_verify.mjs       # 几何构建数学回归检查（法向/UV/旋转）
```

## 依赖

- Node.js（任意现代版本，本项目 v24 已验证）。
- `vendor/three.min.js` + `vendor/OrbitControls.js`（Three.js r128，已随工具提供）。

## 目录结构

```
tools/model-viewer/
├── server.mjs      # 静态服务器 + manifest 构建（零依赖）
├── index.html      # 查看器页面
├── viewer.js       # Three.js 逻辑（解析/渲染/交互/变体/校验）
├── style.css
├── check.mjs       # 无头体检
├── vendor/         # three.min.js + OrbitControls.js
└── README.md
```

## 坐标与 UV 说明

- 模型单位为 1/16 方块；方块中心在 `(0.5, 0.5, 0.5)`，Y 朝上。
- `origin` 为 cube 最小角，`size` 为边长（模型单位）。
- 图集 UV 原点在左上，渲染时翻转到 Three.js 左下原点。
- 支持 per-cube `rotation`+`pivot`（绕枢轴旋转）与 bone `rotation`+`pivot`。
- 渲染方法与原版对齐：`blend` → 透明，`alpha_test` → alphaTest。

## 注意事项

- 该工具为开发/QA 用途，不影响发布产物；按仓库约定不纳入 `build/`。
- 首次使用无需联网（Three.js 已 vendored）。
- 若模型文件被修改，点 `⟳ 刷新` 重新加载。
