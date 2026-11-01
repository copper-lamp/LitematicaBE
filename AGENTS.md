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
| `tools/` | 构建工具：`zip.mjs`（零依赖可复现 zip）、`check-version.mjs`、`build-release.mjs`（**只有这三个入库**，其余开发脚本被 gitignore） |
| `tests/` | **离线回归测试（已入库）**：19 个 `test_*.js` + 2 个体检器 + `run_all.js`；`npm test` 串跑 21 个脚本（276 项断言），任一失败非零退出，CI 在 build 前执行 |
| `.github/workflows/` | `ci.yml`（push/PR 校验 + 测试 + 构建）、`release.yml`（tag → Release） |
| `build/` | **生成物**，已被 gitignore，勿手改 |
| `work/`、`docs/` | 本地开发辅助目录，**已 gitignore，不进仓库** |

`test_nbt.js` 是本地调试脚本，不属于发布内容。

## 常用命令

```shell
npm ci                    # 安装依赖（运行时仅 xlsx）
npm test                  # 离线回归：tests/run_all.js 串跑 21 个脚本（276 项断言）
npm run check:version     # 校验版本一致性（不传参用 package.json 版本）
node tools/check-version.mjs v3.0.1   # 按 tag 校验
npm run build             # 生成 build/ 下全部发布产物
node --check index.js     # 语法检查（CI 对 index.js、src、tests 全部 .js 执行）
```

构建产物（`build/`）：

- `LitematicaBE-server-<ver>.zip`：`plugin/`（含 `node_modules`）+ `packs/LitematicaBE_BP|RP/`
- `LitematicaBE-client-<ver>.zip`：`resource_packs/LitematicaBE_RP/` + `behavior_packs/LitematicaBE_BP/`
- `LitematicaBE-<ver>.zip`：手动安装版
- `LitematicaBE-client-<ver>.mcaddon`：由 `resources/addon` 现场打包
- `SHA256SUMS.txt`

## 发版流程

1. 四处版本号必须同步：`package.json`、`manifest.json`、`tooth.json`、`index.js` 的 `PLUGIN_VERSION`（`npm run check:version` 会强制前三个 + 常量）
2. 在 `CHANGELOG.md` 添加 `## [<ver>] - <日期>` 段落（Release notes 由此抽取）
3. 本地验证：`node tools/check-version.mjs v<ver>` → `npm run build`
4. 提交 → `git push origin main` → `git tag v<ver>` → `git push origin v<ver>`
5. `release.yml` 自动构建并上传资产；tag 含 `-` 时自动标记 prerelease

## 不可违反的约定

### 版本一致性

- **版本必须四处相等**：`package.json` 的 `version`、`manifest.json` 的 `version`、`tooth.json` 的 `version`、**`index.js` 的 `PLUGIN_VERSION` 常量**。前三个由 `npm run check:version` 强制，第四个（`PLUGIN_VERSION`）由 `check-version.mjs` 与 `build-release.mjs` 一并校验。漏掉 `PLUGIN_VERSION` 会出现「清单写 3.0.1、BDS 启动日志却打印 v3.0.0」的错位，排查线上问题时极易被误判成 manifest 被改过。
- 排查部署问题：核对 `manifest.version` 与 `index.js` 的 `PLUGIN_VERSION` 是否一致、二者是否同源、以及 `index.js` 是否与仓库当前版本一致，可直接分辨「清单错」与「代码是旧的」。
- 历史上没有任何代码会自动改写 `plugins/LitematicaBE/manifest.json`：插件本体只读、`build-release.mjs`/`check-version.mjs` 只校验、`tools/ghost_map_apply.js` 写的是 `tools/ghost_manifest.json`（addon 映射）。该文件只会在部署时被拷入。所以「版本号自己变了」的怀疑对象永远是**拷进去的那份源**，而不是运行期。

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

- 大型投影（> `megaSchematic.threshold`，默认 30000 方块）不再进内存，走 `.mcmega` 分块存储（`BinaryChunkStorage`，`CHUNK_SIZE = 32` **硬编码，磁盘格式冻结，不要改**）。
- 渲染链路：`ProjectionRenderer.startRender` 遇到 `isMega && blocks.length === 0` 时建**空队列会话**（`GhostRenderer.enqueue(..., { deferBlocks: true })`，快照/期望/撤销照常），方块由 `MegaProjectionRenderer` 每 tick 用 `GhostRenderer.appendBlocks` 增量注入。
- 注入是**全量**的，不做 LOD 抽样：每 tick 只读 1 个分块（同步 `readFileSync + gunzipSync`，必须限量），铺设速度由 `render.ghostWritesPerTick` 决定。
- `MegaProjectionRenderer` 构造早于 `global.configManager` 赋值，所以构造期读配置会拿到默认值。**配置一律用 `isEnabled()` 实时读**，`index.js` 在 `global.configManager` 赋值后会补调一次 `loadConfig()`；不要再用「注册时求值」的 `enabled: !!megaRenderer.enabled` 写法（那会把开关永久锁死）。
- `appendBlocks` 与 `updateBlocks` 语义不同：前者只往队列尾部追加、不动游标与已写格；后者整体替换队列（换批次会重铺、账本错乱）。Mega 只用前者。
- Mega 加载抛错时回退普通加载，不要把加载失败直接变成整个投影失败。
- **`appendBlocks` 追加后必须复位 `state`**：会话已判过 `done` 又进来新分块时，要把它改回 `building`，否则 tick 只挑 `building` 会话，后追加的格子永远写不进世界（表现为"少几格"，不报错）。
- **逐层显示**：`mega.setLayerMode(stateId, layer)` 只保留 `cy = floor(layer/32)` 那一行分块，`injectChunk` 再按 `y === layer` 精确过滤。切层入口统一收口在 `ProjectionRenderer.applyLayer`（普通投影走 `gr.setLayer`，MEGA 走 `setMegaLayer`），木剑 / 命令 / 表单三条路都走它。切层会先撤掉旧层的 ghost（整会话顺次还原），6 万方块量级会有一次明显卡顿，属已知待优化项。
- **强退残留**：MEGA 的注入状态（`renderStates`）是纯内存的，服务器重启后没有任何东西能接管世界里的 ghost。所以 `GhostRenderer.enqueue(..., {deferBlocks})` 会给快照打 `meta.mega`，启动时 `index.js` **先删这些格的期望记录**再 `restoreOrphaned({ restoreMega: true })` **无条件还原**——不能沿用普通投影的「held 保留 + restoreAll 补齐」，否则 ghost 永久留在世界，玩家既看不到"已加载"也没有会话可撤销。手动兜底是 `/litematica ghost clean`（`ProjectionRenderer.reclaimOrphans`），它不依赖内存会话，会跳过活跃会话。
- **`isMega` 必须是布尔，且判定只走一个地方**：`src/data/projectionFlags.js` 的 `isMegaProjection()` / `normalizeProjection()`。历史写法 `const isMega = schematic.isMega && schematic.schematicId` 会短路返回字符串，落盘成 `"isMega":"mega_xxx"`；再遇到 `!== true` 的严格判定，MEGA 投影就在重启后被判「未就绪」、切层报「注入状态缺失」。`DataManager` 的读接口已全部归一化，新增代码不要再手写 `projection.isMega && ...`。另：`startRender` 起不来时**不许删 `playerData.currentProjectionId`**——那等于把玩家的投影弄丢，只清渲染态即可。

### 依赖与提交

- 运行时依赖只有 `xlsx`（`src/utils/MaterialCounter.js`）。新增依赖需慎重，必须同步 `package.json` / `package-lock.json`，并确认能进入 server zip。
- 不提交：`node_modules/`、`build/`、`dist/`、`schematics/`、`mega_schematics/`、`exports/`、`data/`（插件运行期数据）、`debug_*`。
- 提交信息使用 conventional commit 前缀（`feat`、`fix`、`chore`、`docs` 等）+ 中文说明，例如 `fix(render): mega 未启用时大型投影回退普通渲染`。

## 代码风格

- CommonJS：`const X = require('...')` / `module.exports = { ... }`，不引入 ESM、不引入构建期转译。
- 注释与玩家提示均使用中文；日志统一走 `logger`（`ll.getLogger()` 或模块内 logger），避免裸 `console.log`。
- 配置文件读取统一走 `configManager.get('a.b', default)`；对用户配置保持宽松（允许注释/尾随逗号）。
- 运行期错误应 `player.tell` 给玩家可读提示，同时记录日志，不要静默吞掉。
- **表单回调必须判"取消"**：玩家 ESC / 点 × 关表单时，LSE 的回调第二参**可能是 `undefined` 而不是 `null`**。CustomForm 用 `if (!Array.isArray(data))`，SimpleForm 用 `if (typeof data !== 'number')`；不要写 `data === null`（会漏 undefined → `data[9]` 崩成 `Cannot read properties of undefined`）。`tests/test_form_guards.js` 会静态扫描所有 `sendForm(`，新增表单漏了防御直接失败。
- 修改 `src/` 下文件后至少跑 `node --check <file>`；改动加载/渲染流程请在真实 BDS 环境验证。

## 验证清单（提交前）

- [ ] `node --check index.js` 与改动文件语法通过
- [ ] `npm test` 全绿（21 个脚本 / 276 项断言；改渲染、快照、ghost、配置、打印机必跑）
- [ ] `npm run check:version` 通过（涉及版本时）
- [ ] `npm run build` 成功，产物路径与 `tooth.json` 一致
- [ ] 涉及 addon：三处 `addonVersion` 一致
- [ ] 未把生成物或用户数据带进提交
