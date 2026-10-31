# AGENTS.md

本文件面向在本仓库中工作的编码助手与新贡献者，说明项目结构、构建发布流程与不可违反的约定。

## 项目概览

LitematicaBE 是 Minecraft 基岩版（BDS）的投影（Litematica）插件，基于 LeviLamina + LegacyScriptEngine（`nodejs` 变体）。

- 语言/运行时：JavaScript（CommonJS），运行在 LSE 的 Node 环境
- 插件入口：[index.js](file:///d:/26.10bds/plugins/LitematicaBE/index.js)，由 [manifest.json](file:///d:/26.10bds/plugins/LitematicaBE/manifest.json) 声明（`type: lse-nodejs`）
- 分发：lip（`tooth.json` v3）+ GitHub Release 资产（服务端 zip / 客户端 zip / mcaddon）
- 许可证：MIT

## 目录结构

| 路径 | 作用 |
|---|---|
| `index.js` | 插件入口：命令注册、事件、各子系统装配 |
| `manifest.json` | **LSE 插件清单**（可被直接复制进 `plugins/`），不是 lip 的 v4 清单 |
| `tooth.json` | lip 包清单（v3，`format_uuid = 289f771f-...`），含服务端默认变体与 `client` 变体 |
| `config.json` | 用户配置；允许 `//` 注释与尾随逗号（插件内用宽松解析） |
| `src/core/` | NBT、`.litematic` 解析、流式加载、Mega 分块存储、配置、日志、选区 |
| `src/render/` | 渲染调度：`ProjectionRenderer`（普通 ghost 渲染）、`RenderScheduler`、`LODRenderer`、`MegaProjectionRenderer` |
| `src/ghost/` | ghost 方块注册/守护/校验，addon 版本一致性检查 |
| `src/easyplace/` | 轻松放置：射线、库存、放置校验 |
| `src/mappings/` | Java ↔ 基岩方块/状态映射 |
| `src/ui/`、`src/utils/`、`src/data/`、`src/world/` | 表单 UI、材质统计、存档、世界快照 |
| `resources/addon/LitematicaBE_BP`、`_RP` | **BP/RP 源文件**（已入库，约 547 + 3884 个文件） |
| `resources/data/ghost_index.json`、`addon_expected.json` | **运行时索引**（由构建期产物，与 BP/RP 同批） |
| `resources/pack_icon.png` | 图标；经 `tooth.json` 的 `avatar_url` 指向仓库 raw 地址 |
| `tools/` | 构建工具：`zip.mjs`（零依赖可复现 zip）、`check-version.mjs`、`build-release.mjs` |
| `.github/workflows/` | `ci.yml`（push/PR 校验 + 构建）、`release.yml`（tag → Release） |
| `build/` | **生成物**，已被 gitignore，勿手改 |

`test_nbt.js` 是本地调试脚本，未跟踪，不属于发布内容。

## 常用命令

```shell
npm ci                    # 安装依赖（运行时仅 xlsx）
npm run check:version     # 校验版本一致性（不传参用 package.json 版本）
node tools/check-version.mjs v3.0.1   # 按 tag 校验
npm run build             # 生成 build/ 下全部发布产物
node --check index.js     # 语法检查（CI 对 index.js 与 src 全部 .js 执行）
```

构建产物（`build/`）：

- `LitematicaBE-server-<ver>.zip`：`plugin/`（含 `node_modules`）+ `packs/LitematicaBE_BP|RP/`
- `LitematicaBE-client-<ver>.zip`：`resource_packs/LitematicaBE_RP/` + `behavior_packs/LitematicaBE_BP/`
- `LitematicaBE-<ver>.zip`：手动安装版
- `LitematicaBE-client-<ver>.mcaddon`：由 `resources/addon` 现场打包
- `SHA256SUMS.txt`

## 发版流程

1. 三处版本号必须同步：`package.json`、`manifest.json`、`tooth.json`（`npm run check:version` 会强制）
2. 在 `CHANGELOG.md` 添加 `## [<ver>] - <日期>` 段落（Release notes 由此抽取）
3. 本地验证：`node tools/check-version.mjs v<ver>` → `npm run build`
4. 提交 → `git push origin main` → `git tag v<ver>` → `git push origin v<ver>`
5. `release.yml` 自动构建并上传资产；tag 含 `-` 时自动标记 prerelease

## 不可违反的约定

### 版本一致性

- **addon 版本三方必须相等**：`resources/data/ghost_index.json` 的 `addonVersion`、`resources/data/addon_expected.json` 的 `addonVersion`、`LitematicaBE_BP`/`_RP` 的 `manifest.json` 中 `header.version`（含 `modules[].version`）。构建脚本会直接失败，运行时 `AddonVersionCheck` 不通过会禁用 ghost 写入。
- 修改 addon 版本时三处必须一起改，不要只改 BP 或只改索引。

### BP/RP 与 mcaddon

- BP/RP 的唯一源是 `resources/addon/`；`.mcaddon` 不再入库，由 `build-release.mjs` 从 BP/RP 打包（根目录 `LitematicaBE-<addonVersion>/{BP,RP}`），避免版本漂移。
- 不要手动提交 `resources/addon/LitematicaBE.mcaddon`。
- BDS 目录名是 **`behavior_packs` / `resource_packs`**（美式拼写），`src/ghost/AddonVersionCheck.js` 按此扫描；文档里不要写成 `behaviour_packs`。

### lip 与 zip 布局

- `tooth.json` 中 `assets[].placements[].src` 必须与 `build-release.mjs` 产出的 zip 顶层路径逐字匹配（`plugin/`、`packs/LitematicaBE_BP/`、`packs/LitematicaBE_RP/`、`resource_packs/LitematicaBE_RP/`、`behavior_packs/LitematicaBE_BP/`）。改任一侧都要同步另一侧。
- 服务端默认变体装插件 + BP/RP；`label: client` 变体只装客户端 BP/RP。
- 资源 URL 使用 `https://{{tooth}}/releases/download/v{{version}}/<asset>` 模板，不要硬编码 tag。

### Mega 与大型投影

- `MegaProjectionRenderer` 在 `global.configManager` 赋值之前构造，`render.enableMega` 实际恒为 false，Mega 渲染尚未可用。
- 因此 `index.js` 的加载流程会跳过 Mega 分块加载，大型投影（> `megaSchematic.threshold`，默认 30000 方块）**回退普通加载与普通 ghost 渲染**；Mega 加载抛错时同样回退，不要把加载失败直接变成整个投影失败。
- 不要在没有让 Mega 渲染真正可用之前把 `megaAvailable` 放开，否则超大投影会“加载成功但完全不可见”。

### 依赖与提交

- 运行时依赖只有 `xlsx`（`src/utils/MaterialCounter.js`）。新增依赖需慎重，必须同步 `package.json` / `package-lock.json`，并确认能进入 server zip。
- 不提交：`node_modules/`、`build/`、`dist/`、`schematics/`、`mega_schematics/`、`exports/`、`data/`（插件运行期数据）、`debug_*`。
- 提交信息使用 conventional commit 前缀（`feat`、`fix`、`chore`、`docs` 等）+ 中文说明，例如 `fix(render): mega 未启用时大型投影回退普通渲染`。

## 代码风格

- CommonJS：`const X = require('...')` / `module.exports = { ... }`，不引入 ESM、不引入构建期转译。
- 注释与玩家提示均使用中文；日志统一走 `logger`（`ll.getLogger()` 或模块内 logger），避免裸 `console.log`。
- 配置文件读取统一走 `configManager.get('a.b', default)`；对用户配置保持宽松（允许注释/尾随逗号）。
- 运行期错误应 `player.tell` 给玩家可读提示，同时记录日志，不要静默吞掉。
- 修改 `src/` 下文件后至少跑 `node --check <file>`；改动加载/渲染流程请在真实 BDS 环境验证。

## 验证清单（提交前）

- [ ] `node --check index.js` 与改动文件语法通过
- [ ] `npm run check:version` 通过（涉及版本时）
- [ ] `npm run build` 成功，产物路径与 `tooth.json` 一致
- [ ] 涉及 addon：三处 `addonVersion` 一致
- [ ] 未把生成物或用户数据带进提交
