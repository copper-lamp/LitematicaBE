# AGENTS.md

本文件面向在本仓库中工作的编码助手与新贡献者，说明项目结构、构建发布流程与不可违反的约定。

## 项目概览

LitematicaBE 是 Minecraft 基岩版（BDS）的投影（Litematica）插件，基于 LeviLamina + LegacyScriptEngine（`nodejs` 变体）。

- 语言/运行时：JavaScript（CommonJS），运行在 LSE 的 Node 环境
- 插件入口：[index.js](index.js)，由 [manifest.json](manifest.json) 声明（`type: lse-nodejs`）
- 分发：lip（`tooth.json` v3）+ GitHub Release 资产（**单个整合 zip** `LitematicaBE-<ver>.zip` + `SHA256SUMS.txt`；插件与 BP/RP 同包）
- 许可证：AGPL-3.0

## 目录结构

| 路径 | 作用 |
|---|---|
| `index.js` | 插件入口：命令注册、事件、各子系统装配 |
| `manifest.json` | **LSE 插件清单**（可被直接复制进 `plugins/`），不是 lip 的 v4 清单 |
| `tooth.json` | lip 包清单（v3，`format_uuid = 289f771f-...`）。**只有一个变体**：插件装进 `plugins/LitematicaBE/`，BP/RP 装进 `behavior_packs/`、`resource_packs/`；没有 `client` 变体 |
| `config.json` | 用户配置；允许 `//` 注释与尾随逗号（插件内用宽松解析） |
| `src/core/` | NBT（大端 `NBTWriter` / 小端 `LittleEndianNBTWriter`）、`.litematic` 解析与 **`.mcstructure` 读写**（`McstructureLoader` 读、`McstructureWriter` 写、`LSENbtTree` 做 LSE NBT→带类型描述树）、`SchematicSaver`（选区→文件，三路分派 litematic/mcstructure/both）、流式加载、Mega 分块存储、配置、日志、选区 |
| `src/render/` | 渲染调度：`ProjectionRenderer`（普通 ghost 渲染）、`RenderScheduler`、`LODRenderer`、`MegaProjectionRenderer`、`ProjectionManager`（投影活动状态登记） |
| `src/ghost/` | ghost 方块注册/守护/校验（`GhostBlockRegistry` / `GhostGuard` / `GhostSelfCheck` / `GhostExpectStore`）、形态推断（`PistonStateInfer` / `SurfaceExtractor`）、addon 版本一致性检查 |
| `src/easyplace/` | 轻松放置：射线、库存、放置校验 |
| `src/mappings/` | Java ↔ 基岩方块/状态映射 |
| `src/ui/`、`src/utils/`、`src/data/`、`src/world/` | 表单 UI、材质统计、存档、世界快照 |
| `src/web/` | 内置 HTTP 上传站：默认 `web.engine = "node"`，走 `NodeHttpServer`（Node 原生 http，网络回调没有 EngineScope 限制）；只有 `engine = "lse"` 才走 `ll.network` 的 `HttpServer`，属兼容保留（BDS 1.21.7x 下该路径回调会 500）。含 `WebUploadServer`（路由/分片/令牌/限流）、`upload.html`（前端单页，独立文件便于维护）、`uploadGuard`（文件名净化/路径穿越/魔数校验，纯函数可单测） |
| `src/net/` | 出站网络：`UpdateChecker`（GitHub Release 版本检查，服务端启动时查一次、只产出一行日志，开关在 `updateCheck.enabled`） |
| `resources/addon/LitematicaBE_BP`、`_RP` | **BP/RP 源文件**（已入库：当前 BP 1279 / RP 4094 个文件，数量随 BP/RP 增删变化，以 `git ls-files resources/addon` 为准） |
| `resources/data/ghost_index.json`、`addon_expected.json` | **运行时索引**（产物入库；由 `work/` 下的本地生成脚本按 BP/RP 批量写出，`build-release.mjs` 只做读取校验、**不生成**） |
| `resources/pack_icon.png` | 图标；经 `tooth.json` 的 `avatar_url` 指向仓库 raw 地址 |
| `tools/` | 构建/校验工具：`zip.mjs`（零依赖可复现 zip）、`check-version.mjs`（版本校验）、`check-tracked.mjs`（干净检出完整性，防 gitignore 漂移）、`build-release.mjs`、`sync-version.mjs`（版本统一复写）、`lib/png.js`（贴图解码，构建与测试共用）。**`.gitignore` 是白名单制（`/tools/*` + 逐条 `!`），新增被任何入口引用的文件必须加例外**，否则本地照跑、CI 干净检出 `MODULE_NOT_FOUND`（2026-11-14 事故：`lib/png.js` 与 `sync-version.mjs` 都漏了）。工作区里另有**未入库**的本地工具（`model-viewer/`、`gen_block_geo.js`、`flattening_map.json`、`variant_flattening_map.json` 等），它们被白名单排除，**不要被 npm script / CI / `src/` 引用** |
| `tests/` | **离线回归测试（已入库）**：37 个 `test_*.js` + 2 个体检器（`check_*`）+ `run_all.js`；`npm test` 串跑 39 个脚本（547 项断言），任一失败非零退出，CI 在 build 前执行 |
| `.github/workflows/` | `ci.yml`（push/PR 校验 + 测试 + 构建）、`release.yml`（**手动触发**：Actions → Release → Run workflow 并填 `tag`；push tag 不再自动发版） |
| `build/` | **生成物**，已被 gitignore，勿手改 |

`test_nbt.js` 是本地调试脚本，不属于发布内容。

## 常用命令

```shell
npm ci                    # 安装依赖（运行时仅 xlsx）
npm test                  # 离线回归：tests/run_all.js 串跑 39 个脚本（547 项断言）
npm run check:tracked     # 干净检出完整性：被引用/被 npm script 与 workflow 点名的文件是否都已入库
npm run check:version     # 校验版本一致性（不传参以 index.js 的 PLUGIN_VERSION 为基准）
npm run version:sync      # 以 index.js 的 PLUGIN_VERSION 为唯一源，回写 package.json / manifest.json / tooth.json
node tools/check-version.mjs v3.1.0   # 按 tag 校验（当前版本 3.1.0）
npm run build             # 生成 build/ 下全部发布产物
node --check index.js     # 语法检查（CI 只对 index.js 与 src/ 下全部 .js 执行；tests/ 由 npm test 自己加载）
```

构建产物（`build/`）：

- `LitematicaBE-<ver>.zip`：**唯一**发布包，顶层为 `plugins/LitematicaBE/`（含 `node_modules`）+ `LitematicaBE-server-BP/` + `LitematicaBE-server-RP/`
- `SHA256SUMS.txt`：上面那个 zip 的校验和

没有服务端/客户端分包，也不产出 `.mcaddon`；插件与 BP/RP 同包，安装时分别落到 `plugins/`、`behavior_packs/`、`resource_packs/`。

## 发版流程

1. 插件版本只改一处：`index.js` 的 `PLUGIN_VERSION`，然后 `npm run version:sync`（`tools/sync-version.mjs`）回写 `package.json` / `manifest.json` / `tooth.json`；`PLUGIN_VERSION_TUPLE` 与 `ll.registerPlugin` 的三元组自动派生。`npm run check:version` 会强制全部四处字符串 + 第 5 处三元组 + addon 五处 + `CHANGELOG.md` 里必须有对应的 `## [<ver>]` 段落。完整流程见 `VERSIONING.md`
2. 在 `CHANGELOG.md` 添加 `## [<ver>] - <日期>` 段落（Release notes 由此抽取）
3. 本地验证：`node tools/check-version.mjs v<ver>` → `npm run build`
4. 提交 → `git push origin main` → `git tag v<ver>` → `git push origin v<ver>`。**tag 只是版本标记，不再触发任何工作流**
5. **手动发布**：GitHub → Actions → `Release` → Run workflow，填 `tag`（如 `v3.1.0`）。四个开关：
   - `publish=false`：只构建并留 artifact（`LitematicaBE-<tag>`），资产自己下载上传——最"全手动"的一档，工作流不碰 Release
   - `sync_notes=false`：不覆盖你手写的标题与说明，只覆盖同名资产（`--clobber`）
   - `verify=relaxed`：跳过 tag↔代码版本、gitignore 漂移、CHANGELOG 段落三道校验；`npm run build` 内部的清单四处版本 + addon 五处**仍会执行**（那是产物本身的一致性，跳过会打出装不上的包）
   - `prerelease`：手动标记预发布；tag 自带 `-` 后缀（`v3.2.0-beta.1`）自动按预发布处理
   发布步骤幂等：Release 已存在就 `gh release upload --clobber`（是否 `edit` 由 `sync_notes` 决定），不存在才 `create`

## 不可违反的约定

### 版本一致性

- **版本必须四处相等**：`index.js` 的 `PLUGIN_VERSION` 是唯一真源；`package.json` / `manifest.json` / `tooth.json` 的 `version` 由 `tools/sync-version.mjs`（`npm run version:sync`）复写，`check-version.mjs` 与 `build-release.mjs` 一并校验。**不要手改三份清单的 version**——漏掉 `PLUGIN_VERSION` 或手改清单都会出现「清单写 3.0.1、BDS 启动日志却打印 v3.0.0」的错位，排查线上问题时极易被误判成 manifest 被改过。升级流程见 `VERSIONING.md`。
- **还有第 5 处：`ll.registerPlugin(name, desc, [x,y,z], {})` 的版本三元组**。它必须写成 `PLUGIN_VERSION_TUPLE`（由 `PLUGIN_VERSION` 先切 `-prerelease`、再按 `.` 取三段派生：`3.0.3-test.6` → `[3,0,3]`），**绝不许写死 `[3, 0, 0]` 这种字面量**——legacy-script-engine 在注册插件时会把三元组**回写进 `plugins/LitematicaBE/manifest.json`**（C++ 文本模式写，LF→CRLF，并丢掉 `-prerelease`）。写死的后果就是每次启动清单被刷成旧版本（2026-11-11 真机事故：清单永远是 3.0.0，与 3.0.3-test.6 对不上，被误判成"清单被改过"）。`check-version.mjs` 与 `tests/test_plugin_version.js` 都会拦。注意**不能按 `.` 直切三段**：`3.0.3-test.6` 按 `.` 切是 `['3','0','3-test','6']`，会把 `test` 粘进第三段。
- **部署后 manifest 被 LSE 改写为 `x.y.z` 是预期行为**：`manifest.version` 在运行期会等于 `PLUGIN_VERSION` 的 core 三段（`3.0.3-test.6` → `3.0.3`）。排查时以 `PLUGIN_VERSION` 与启动日志 `正在加载 LitematicaBE vX` 为准，不要因为清单少了 prerelease 后缀就判定版本错乱；把清单设只读可以阻断回写，但没有必要（回写失败是静默的，不影响加载）。
- 排查部署问题：核对 `index.js` 的 `PLUGIN_VERSION`、`PLUGIN_VERSION_TUPLE`、`manifest.version`，以及 `index.js` 是否与仓库当前版本一致，可直接分辨「清单错」与「代码是旧的」。
- **修订（2026-11-11）**：`plugins/LitematicaBE/manifest.json` **会被改写**——由 `ll.registerPlugin` 的版本三元组经 LSE 回写（见上一条）。旧版本文档说"历史上没有任何代码会自动改写该文件、怀疑对象永远是拷进去的那份源"是**不成立**的：只要 `registerPlugin` 里写死了旧版本，每次启动清单就被刷成那个旧版本。`build-release.mjs` / `check-version.mjs` 仍然只校验不写；`tools/ghost_map_apply.js` 写的是 `tools/ghost_manifest.json`（addon 映射）——这两条不变。

- **addon 版本五处必须相等**：`resources/data/ghost_index.json` 的 `addonVersion`、`resources/data/addon_expected.json` 的 `addonVersion`、`LitematicaBE_BP`/`_RP` 两个 `manifest.json` 的 `header.version` 与 `modules[].version`，外加这两个 manifest 的 `header.description` 里 `addon 版本 x.y.z` 文本。`npm run check:version` 会一次性校验五处 + 描述文本 + `bpUuid/rpUuid` 交叉核对。升级入口是本地脚本 `work/bump_addon_version.js`——它位于已 gitignore 的 `work/`、**不在仓库里**，换机器要自备（见 `VERSIONING.md` §2）；手改任一处都会漂移，改完必须跑 `npm run check:version` 收口。历史上漏过两次：manifest 的 `header.version` 已经升上去、`description` 文本还停在旧版本；插件侧 `index.js` 的失败提示也写死过版本号（换包后一直是旧值）。操作与校验见 `VERSIONING.md` §2。
- 运行时 `AddonVersionCheck` 不通过会禁用 ghost 写入（其余功能照常）。
- 修改 addon 版本时五处 + 描述文本必须一起改，不要只改 BP 或只改索引；直接跑 `node work/bump_addon_version.js <x.y.z>`（该脚本未入库），它会顺带做十项一致性校验，任一不一致即非零退出。

### BP/RP 与发布包

- BP/RP 的唯一源是 `resources/addon/LitematicaBE_BP`、`_RP`；`build-release.mjs` 现拷成发布包内的 `LitematicaBE-server-BP/`、`LitematicaBE-server-RP/`，装到 BDS 时再落到 `behavior_packs/`、`resource_packs/`。
- **不产出 `.mcaddon`、也不入库**（历史上打过，已取消）：`resources/addon/` 下只应有 BP/RP 两个子目录，出现 `*.mcaddon` 视为误提交。
- BDS 目录名是 **`behavior_packs` / `resource_packs`**（美式拼写），`src/ghost/AddonVersionCheck.js` 按此扫描；文档里不要写成 `behaviour_packs`。

### lip 与 zip 布局

- `tooth.json` 的 `assets[].placements[].src` 必须与 `build-release.mjs` 产出的 zip 顶层路径逐字匹配——当前是 `plugins/LitematicaBE/`、`LitematicaBE-server-BP/`、`LitematicaBE-server-RP/`（src → dest 分别是 `plugins/LitematicaBE/`、`behavior_packs/LitematicaBE_BP/`、`resource_packs/LitematicaBE_RP/`）。改任一侧都要同步另一侧；`build` 与 `check` 都不会替你比对 tooth.json。
- **只有一个变体**（`label` 为空）：插件 + BP/RP 全装；`preserve_files` 保护用户的 `config.json`、`schematics/`、`mega_schematics/`、`exports/`、`logs/`。没有 `label: client` 变体，新增变体前先改 `build-release.mjs` 的产物布局。
- 资源 URL 使用 `https://{{tooth}}/releases/download/v{{version}}/<asset>` 模板，不要硬编码 tag。

### Mega 与大型投影

- 大型投影（> `megaSchematic.threshold`）不再进内存，走 `.mcmega` 分块存储（`BinaryChunkStorage`，`CHUNK_SIZE = 32` **硬编码，磁盘格式冻结，不要改**）。阈值有两处来源：`ConfigManager` 的代码默认是 **30000**，随包发布的 `config.json` 写的是 **100000**——实际生效值以后者为准，改默认值时两处必须一起改。
- 渲染链路：`ProjectionRenderer.startRender` 遇到 `isMega && blocks.length === 0` 时建**空队列会话**（`GhostRenderer.enqueue(..., { deferBlocks: true })`，快照/期望/撤销照常），方块由 `MegaProjectionRenderer` 每 tick 用 `GhostRenderer.appendBlocks` 增量注入。
- 注入是**全量**的，不做 LOD 抽样：每 tick 只读 1 个分块（同步 `readFileSync + gunzipSync`，必须限量），铺设速度由 `render.ghostWritesPerTick` 决定。
- `MegaProjectionRenderer` 构造早于 `global.configManager` 赋值，所以构造期读配置会拿到默认值。**配置一律用 `isEnabled()` 实时读**，`index.js` 在 `global.configManager` 赋值后会补调一次 `loadConfig()`；不要再用「注册时求值」的 `enabled: !!megaRenderer.enabled` 写法（那会把开关永久锁死）。
- `appendBlocks` 与 `updateBlocks` 语义不同：前者只往队列尾部追加、不动游标与已写格；后者整体替换队列（换批次会重铺、账本错乱）。Mega 只用前者。
- Mega 加载抛错时回退普通加载，不要把加载失败直接变成整个投影失败。
- **`appendBlocks` 追加后必须复位 `state`**：会话已判过 `done` 又进来新分块时，要把它改回 `building`，否则 tick 只挑 `building` 会话，后追加的格子永远写不进世界（表现为"少几格"，不报错）。
- **逐层显示**：`mega.setLayerMode(stateId, layer)` 只保留 `cy = floor(layer/32)` 那一行分块，`injectChunk` 再按 `y === layer` 精确过滤。切层入口统一收口在 `ProjectionRenderer.applyLayer`（普通投影走 `gr.setLayer`，MEGA 走 `setMegaLayer`），木剑 / 命令 / 表单三条路都走它。切层会先撤掉旧层的 ghost（整会话顺次还原），6 万方块量级会有一次明显卡顿，属已知待优化项。
- **强退残留**：MEGA 的注入状态（`renderStates`）是纯内存的，服务器重启后没有任何东西能接管世界里的 ghost。所以 `GhostRenderer.enqueue(..., {deferBlocks})` 会给快照打 `meta.mega`，启动时 `index.js` **先删这些格的期望记录**再 `restoreOrphaned({ restoreMega: true })` **无条件还原**——不能沿用普通投影的「held 保留 + restoreAll 补齐」，否则 ghost 永久留在世界，玩家既看不到"已加载"也没有会话可撤销。手动兜底是 `/litematica ghost clean`（`ProjectionRenderer.reclaimOrphans`），它不依赖内存会话，会跳过活跃会话。**如果连快照和期望都没了**（强关服后又把投影记录删掉就是这种情况），`ghost clean` 什么也找不到——这时用 `/litematica ghost sweep`（`/lit ghost sweep` 同义；默认**以自身所在区块为中心的 5×5 区块**、纵向 ±32 层；`sweep 3` 改 3×3，`sweep 12` 走旧的格半径，`box x1 y1 z1 x2 y2 z2` 精确框，末尾 `dry` 只统计）：它按坐标读世界、把 `lit:g_*` 写回空气——只碰 ghost、**活跃会话的格跳过（`kept`）**、读不到方块就跳过、写前先删期望与 forget。
- **`isMega` 必须是布尔，且判定只走一个地方**：`src/data/projectionFlags.js` 的 `isMegaProjection()` / `normalizeProjection()`。历史写法 `const isMega = schematic.isMega && schematic.schematicId` 会短路返回字符串，落盘成 `"isMega":"mega_xxx"`；再遇到 `!== true` 的严格判定，MEGA 投影就在重启后被判「未就绪」、切层报「注入状态缺失」。`DataManager` 的读接口已全部归一化，新增代码不要再手写 `projection.isMega && ...`。另：`startRender` 起不来时**不许删 `playerData.currentProjectionId`**——那等于把玩家的投影弄丢，只清渲染态即可。

### 多投影（同一玩家并存多份）

- **会话身份是 `xuid::projectionId`**：`GhostRenderer.sessions` 的 key 由 `sessionKeyOf(xuid, projectionId)` 生成，一个玩家可以同时有多条会话（每条一份快照/期望/撤销账本）。不要再用 `sessions.set(xuid, ...)` 写新会话，也不要用 `sessions.size` 估玩家数。
- **兼容读法**：`SessionMap` 会把玩家级 key（`sessions.get('P1')` / `has` / `delete`）解析到该玩家的**主控会话**（`primarySession: xuid -> sessionKey`，没有记录时退化为"该玩家第一条会话"）。遍历（`values/keys/forEach`）拿到的仍是全部会话，tick 预算按会话均分。
- **"木剑控制"只有一份**：`ProjectionRenderer.activeProjections: xuid -> task` 是主控（木剑切层/旋转/建造/轻松放置/打印机都从它取目标），全部已加载投影在 `playerProjections: xuid -> (projectionId -> task)`；`layerRenderMode` / `currentRenderLayer` 是主控投影的视图镜像。切主控用 `setPrimaryProjection()`——只换指针，不重铺、不撤会话。
- **按投影定位的 API**：`GhostRenderer.getSessionOf / hasProjection / clear({projectionId}) / setLayer(player, projection, layer) / appendBlocks(xuid, blocks, projectionId)`；`enqueue` 的 `opts.keepOthers` 缺省为 false（旧语义：换投影先撤该玩家其它会话），`ProjectionRenderer` 一律传 `true`。新增入口若要"多投影并存"，必须显式传 `keepOthers: true`。
- **持久化**：`loadedProjections` 记全部已加载、`currentProjectionId` 记木剑控制的那一个、`projectionLayers` / `projectionLayerModes` 按投影记层。`_remember()` 是**合并**语义（以存档为底、内存覆盖），因为"逐个恢复"中途任务表还不是全集；卸载必须走 `clearProjection()`，它会先把该 id 从存档里删掉再 `_remember`。恢复流程用 `startRender(..., { primary: false, persist: false })`，最后统一 `setPrimaryProjection(..., { persist: true })` 落一次盘。
- **MEGA 多实例**：注入状态的键统一用 `MegaProjectionRenderer.stateIdFor(player, projection)`（同一玩家同一图纸放两份时第二份带 `#hash` 后缀），不要手拼 `${xuid}_${schematicId}`；`appendBlocks` 必须带 `projectionId`，否则会灌进主控会话。
- **`reclaimOrphans(player, { resetState: false })`**：`startRender` 开投影前清孤儿快照时必须传这个，否则会把该玩家其它投影的任务表一起删掉。

### 更新检查（联网）

- **定位：只在服务端启动、插件被激活时查一次，只打一行日志。** 不要加周期复查、失败重试退避、OP/玩家提示、命令入口 —— 这些是被明确简化掉的东西；`tests/test_update_checker.js` 有反向断言，源码里再出现 `intervalHours` / `delaySeconds` / `nextRetryAt` / `mc.listen('onJoin')` / `handleVersionCommand` 就直接失败。
- **触发点只有一个**：`onServerStarted` 里的 `startUpdateCheck()`（`updateCheckFired` 防重）。`config.json` 的 `updateCheck.enabled=false` 时完全不联网 —— 连 `RenderScheduler` 的 `update-check` 任务都不注册，全程零开销。
- **铁律：Node 的 http(s) 异步回调里只许碰纯 Node 对象。** LSE 只有 `::script::EngineScope` 存在的上下文（命令回调、`onTick`）能访问 `logger` / `mc` / `player` / `File` / `ll`；网络响应回调不在其中，碰一下就是 `call engine APIs without a ::script::EngineScope`，而抛出点在事件循环里，容易升级成 uncaughtException 把服务端带走（同一个坑毁过 `ll.network` 的 `HttpServer`，见 `src/web/NodeHttpServer.js`）。
- 因此 `src/net/UpdateChecker.js` **全程零日志**：请求/解析只写 `this.result`（纯数据）；打印由 `index.js` 的 `drainUpdateCheck()`（一次性 tick 任务，打完 `renderScheduler.remove('update-check')`）调 `takeResult()` 完成。**不要在异步回调里加 `logger.info`。**
- 日志文案由 `UpdateChecker.formatLogLine()` 生成（纯函数、可单测），逐字要求：
  - 有新版：`[LitematicaBE]发现新版本vX.Y.Z，前往<repo 主页>以了解更多`
  - 已最新：`[LitematicaBE]当前已是最新版本`
  - 失败：`[LitematicaBE]版本检查失败：<原因>`（不重试、不刷屏）
- 取数顺序固定，第一个成功即用：官方 API `releases/latest` → 官方网页 `releases/latest` 的 302 `location` → `updateCheck.mirror`（若配置，支持 `{repo}` 占位）。**两条官方路径都必须带 `redirectsLeft: 0`** —— 跟随跳转会拿到一整页 HTML，`JSON.parse` 必失败（真机踩过，兜底形同虚设）。
- 版本比较用 `compareVersions`（semver 语义：`v` 前缀、缺段补齐、`-prerelease` 低于同号正式版）。远端只认正式版：`extractTag` 跳过 `draft` 与 `prerelease`。
- 配置只有四个键：`enabled` / `repo` / `mirror` / `timeoutMs`。`checkUrl` 是上一版的旧键，只保留读取兼容，不再写进默认配置。

### 依赖与提交

- 运行时依赖只有 `xlsx`（`src/utils/MaterialCounter.js`）。新增依赖需慎重，必须同步 `package.json` / `package-lock.json`，并确认能进入发布 zip（`build-release.mjs` 的 `PLUGIN_FILES` 与 `node_modules` 拷贝）。
- 不提交：`/data/`（BDS 侧运行期数据）、`node_modules/`、`build/`、`dist/`、`schematics/`、`mega_schematics/`、`exports/`、`debug_*`，以及已 gitignore 的 `/docs/`、`/work/`、`/addon/` 和 `tools/` 白名单之外的文件。注意 `resources/data/` 不属于这条——它是入库的运行时索引。
- 提交信息使用 conventional commit 前缀（`feat`、`fix`、`chore`、`docs` 等）+ 中文说明，例如 `fix(render): mega 未启用时大型投影回退普通渲染`。

## 代码风格

- CommonJS：`const X = require('...')` / `module.exports = { ... }`，不引入 ESM、不引入构建期转译。
- 注释与玩家提示均使用中文；日志统一走 `logger`（`ll.getLogger()` 或模块内 logger），避免裸 `console.log`。
- 配置文件读取统一走 `configManager.get('a.b', default)`；对用户配置保持宽松（允许注释/尾随逗号）。
- 运行期错误应 `player.tell` 给玩家可读提示，同时记录日志，不要静默吞掉。
- **表单回调必须判"取消"**：玩家 ESC / 点 × 关表单时，LSE 的回调第二参**可能是 `undefined` 而不是 `null`**。CustomForm 用 `if (!Array.isArray(data))`，SimpleForm 用 `if (typeof data !== 'number')`；不要写 `data === null`（会漏 undefined → `data[9]` 崩成 `Cannot read properties of undefined`）。`tests/test_form_guards.js` 会静态扫描所有 `sendForm(`，新增表单漏了防御直接失败。
- 修改 `src/` 下文件后至少跑 `node --check <file>`；改动加载/渲染流程请在真实 BDS 环境验证。
- **坐标与数值输入统一走 `src/utils/coordText.js`**：`toIntOr(v, fallback)`（只有空串/非数字才回退，**`0` 与负数是合法坐标**）、`parseXYZText(text, base)`（`"100 64 200"` / 逗号分隔 / `~ ~5 ~-3` 相对坐标）、`clampCoord`。不要在表单或命令里手写 `parseInt(v) || 默认值`。
- **CustomForm 的坐标/名称输入必须排在所有 `addLabel` 之前**：回调 `data` 与控件顺序一一对应，但 label 是否占位在不同 LSE 实现下不可靠；按"label 个数"取下标会取到 `null` → 静默回退默认值（历史 bug：放置面板设置的坐标不生效）。取数写 `data[0..n]`，label 一律跟在后面。

## 验证清单（提交前）

- [ ] `node --check index.js` 与改动文件语法通过
- [ ] `npm test` 全绿（39 个脚本 / 547 项断言；改渲染、快照、ghost、配置、打印机、上传站、更新检查、保存导出必跑）
- [ ] `npm run check:tracked` 通过（新增/移动/改名 `tools/` 下的文件、或改了 `package.json` scripts 与 workflows 时必跑；它只认 git 索引，能挡住"本地能跑、CI 缺文件"）
- [ ] `npm run check:version` 通过（涉及版本时）
- [ ] `npm run build` 成功：产物只有 `LitematicaBE-<ver>.zip` 与 `SHA256SUMS.txt`，zip 顶层路径与 `tooth.json` 的 `placements[].src` 逐字一致
- [ ] 涉及 addon：`npm run check:version` 通过（五处版本 + 两个 manifest 的 `addon 版本` 描述文本 + uuid 交叉核对）
- [ ] 未把生成物或用户数据带进提交
