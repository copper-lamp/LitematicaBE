# Changelog

All notable changes to this project will be documented in this file.

## [3.1.1] - 2026-11-16

### Added

- **插件新增 i18n 模块（聊天栏 + 全部 UI 表单）** — 新增 `src/i18n/` 国际化模块：`I18n.js`（唯一入口，零日志）+ `lang/zh_CN.json`、`lang/en_US.json`（各 369 键，键集与占位符结构一一对应）。

  调用结构：`t(player,key,...args)` 返回按玩家语言的翻译串（UI 表单用），`tell(player,key,...args)` 翻译并发送聊天消息，`tr(key,...)` 默认语言（zh_CN），`zh(key,...)` 强制中文
  原文（测试断言/日志步骤）。查找优先级：本地语言表（按 `pl.langCode` 归一选择）→ LSE 全局 `i18n.trl` 兜底 → 本地 zh 原文（永不显示键名）。
  
  覆盖模块：`UIManager`（全部表单标题/内容/按钮/下拉/输入 + 聊天提示）、`ProjectionRenderer`、`MegaProjectionRenderer`、`GhostRenderer`、`GhostSelfCheck`、`EasyPlaceManager`、`BlockVerifier`、`MaterialCounter`、`MegaSchematicManager`、`SelectionTool`。`logger.*` 控制台日志按约定不国际化。
  
  语言切换：按每个玩家 `pl.langCode` 实时取译（`en_us/en_GB/en_AU/en_CA/en_NZ/en→en_US`、`zh_cn/zh→zh_CN`、`zh_HK→zh_TW`），玩家改语言后重开表单/触发消息即生效。
  键命名 `ns.sub.name`、占位符 `{}`/`{0}` 与 `§` 色码保留在值里、中英双文件同步、新表单判取消、§7 键一致性校验。

### Fixed

- **上传站地址展示不跟随 `web.publicUrl`** — `/litematica:web url` 的「访问地址」直接硬拼 `http://${host}:${port}/`，完全绕过了 `summary().url`，导致配置了 `web.publicUrl`（反向代理对外地址）后该命令仍显示 `http://0.0.0.0:8080/`；`status` / `start` / `token` 三处的带令牌访问地址同样硬拼 `host:port`，走反向代理时会把连不通的 `0.0.0.0:8080` 地址发给玩家。
  修复：四处地址展示统一改用 `summary().url`（=`publicUrl || http://host:port/`）：
  | 位置 | 命令 | 修改 |
  |---|---|---|
  | `index.js` `buildWebCommand` `url` case | `/litematica:web url` | `http://${s.host}:${s.port}/` → `${s.url}` |
  | `index.js` `sendWebStatus` | `/litematica:web status`（「访问」行） | `http://${s.host}:${s.port}/?token=` → `${s.url}?token=` |
  | `index.js` `buildWebCommand` `start` case | `/litematica:web start`（「带令牌地址」） | `http://${s.host}:${s.port}/?token=` → `${s.url}?token=` |
  | `index.js` `buildWebCommand` `token` case | `/litematica:web token`（「访问」行） | `http://${wc.host}:${wc.port}/?token=` → `${s.url}?token=` |
  说明：`/litematica:web status` 的「监听」行**仍显示** `host:port`（如 `0.0.0.0:8080`）——那是实际的 socket 监听地址，本就不该由 `publicUrl` 改变；只有「公共地址 / 访问地址」跟随 `web.publicUrl`。未配置 `publicUrl` 时回退逻辑不变（`http://host:port/`）。

  验证：`/litematica:config get web.publicUrl` 与 `/litematica:web url` 显示一致；`publicUrl` 生效后全部地址展示均为对外地址。纯展示逻辑，不影响监听，无需重启上传站。

- **部分日志静默** — `registerCommands()` 的命令注册汇总日志（`[LitematicaBE] 命令注册(load/serverStarted): N 条可用 [...]`）原本无条件打印，每次启动（加载期 + `onServerStarted` 兜底重试）都会刷一条，属启动噪音。

  修复：该汇总改为与 `setupCommand` 内的单条注册日志共用同一门控——`misc.verboseCommandLog` / `misc.verboseStartupLog` 任一为 `true` 才输出，默认（两者皆 `false`）静默。排查命令注册问题时把 `misc.verboseCommandLog` 改 `true`，即可恢复这条汇总与逐条注册结果；`warn`/`error`（注册失败）始终保留。

- **上传站 404 日志降级与 favicon 静默** — 兜底路由 `_notFound`（`src/web/WebUploadServer.js`）把「未匹配的路径」从 `logger.warn` 降为 `_debug`（仅写 `data/web_debug.log`，不再刷控制台 WARN）；前端 `src/web/upload.html` 增加 `<link rel="icon" href="data:,">`，浏览器打开上传页不再自动请求 `/favicon.ico`。

  两者消除公网暴露后常见的日志噪音：浏览器自动请求的 `/favicon.ico`，以及互联网扫描器对 `/phpinfo`、`/SDK/*` 等路径的常规探测。这些请求命中兜底路由后仅返回 `404 {"ok":false,"error":"not found"}`，无执行风险；降级后想看谁在探测时翻 `data/web_debug.log` 即可。纯日志/前端优化，不影响路由、鉴权与上传功能。

- **`misc.debugLog` 诊断日志开关（默认关闭）** — `WebUploadServer._debug()`（写 `data/web_debug.log` 的诊断日志：404 未匹配路径、框架错误、handler 异常、自检、启动信息等）原先**无条件**写文件；新增 `misc.debugLog` 配置项（默认 `false`）统一控制，关闭时所有诊断日志完全静默、不写文件。

  为调试而开启：把 `config.json` 的 `misc.debugLog` 设 `true` 并重载配置（`/litematica:config reload`）或重启服务端，诊断日志落到 `data/web_debug.log`。开关放 `misc` 而非 `web`，后续其它模块的 debug 日志可复用同一开关。纯日志开关，不影响任何功能路径。

  同一开关扩到的启动期日志（`misc.debugLog=true` 才打印，默认静默）：

  - `index.js`：`[LitematicaBE] zlib module loaded successfully!`、`[LitematicaBE] fs module loaded successfully!`——模块加载发生在 `configManager` 创建**之前**，无法在 require 处门控，改为 configManager 就绪后按开关补打；加载失败仍走 `warn`（始终保留）。
  - `ConfigManager`：`[ConfigManager] 配置文件加载成功: <路径>`（加载失败 `error` 始终保留）。
  - `DataManager`：`Loaded N projections`、`Loaded data for N players`。

  为让 `DataManager` 等实例构造期（早于统一 global 导出处）能读该开关，`index.js` 把 `global.configManager` 的赋值**提前**到 `configManager` 创建之后（原在 `global.*` 统一导出块，晚于 `DataManager` 构造）。`warn`/`error` 类日志不受开关影响，始终输出。

### Security

- **内置上传站防御缺口收口** — `allowIps` 白名单从「只拦上传 init」上提为全局闸门：新增统一入口 `_gate()`，**令牌 + IP 白名单 + 全局限流**一次校验，`list` / `download` / `delete` / `init` / `chunk` / `finish` / `abort` 七个受保护路由全部过闸；此前白名单只作用于 `init`，即使配置了白名单，公网任意 IP 仍可列目录、下载、删除投影（`src/web/WebUploadServer.js`）。
- **新增 `readOnly` 只读模式** — `true` 时上传 / 删除 / 中止一律返回 403，仅保留列出与下载，配合 `allowIps` 作为「只下载、不收文件」场景的一档防护；对应 `config.json` 的 `web.readOnly`。
- **新增 `maxRequestsPerMinute` 全局限流** — 每 IP 每分钟所有受保护 API 请求数上限（默认 60），覆盖此前完全不限流的下载 / 删除 / 列表，堵住刷量与带宽滥用；对应 `config.json` 的 `web.maxRequestsPerMinute`。
- **新增 `downloadMaxMB` 下载体积上限** — 单文件下载超过阈值（默认 8 MB，`0` = 不限制）拒绝 base64 直传并提示走服务器文件，避免大文件一次性读入内存造成放大；对应 `config.json` 的 `web.downloadMaxMB`。
- **`/api/health` 信息泄漏收敛** — 未带令牌只返回 `ok` / `plugin` / `running` 最小字段；带令牌才返回 `chunkKB` / `maxFileMB` / `allowExt` / `files`，不再把上传站内部参数与文件数暴露给扫描者。
- **404 兜底日志补记来源** — `未匹配的路径` 诊断日志（`data/web_debug.log`，受 `misc.debugLog` 控制）现在追加请求来源 `remoteAddr`，公网扫描器探测时可据此溯源扫描源 IP。
- **回归测试** — `tests/test_web_upload.js` 新增 6 个断言（白名单全局生效、全局限流 429、只读模式、下载上限 413、health 精简字段、404 记录来源 IP），离线回归 547 → 553 断言全绿。

## [3.1.0] - 2026-11-14

### Added

- **内置文件上传站** - 加入内置 http 服务器，调用 ll 网络接口，插件启动时自动拉起上传站；允许任何持有 TOKEN 密钥玩家访问服务器并上传投影 / 结构文件至插件；热上传即时生效，无需重启服务端。
- **`.mcstructure` 读写双向支持** — 加载走 `McstructureLoader`（独立小端 NBT 解析，与 `.litematic` 按扩展名分流）；保存新增 `LittleEndianNBTWriter` / `McstructureWriter` / `LSENbtTree`，选区保存表单加「导出格式」下拉（`.litematic` / `.mcstructure` / 两者），基岩版结构文件大小超出`maxVolume`（默认 100 万格）则在读取前截停。
- **同一玩家多投影并存** — ghost 会话身份升维为 `xuid::projectionId`，每份投影各有独立的会话、快照与撤销账本；新增 `setPrimaryProjection()` 只切木剑控制目标而不重铺不撤会话、`/litematica select`、菜单「选择木剑控制的投影 / 卸载某个投影」，`loadedProjections` 与逐投影层号持久化，旧存档自动迁移。MEGA 同一图纸放两份时按 `stateIdFor` 隔离注入状态。
- **`/litematica:ghost sweep` 兜底清理** — 快照与期望都丢失时按坐标扫描世界，把 `lit:g_*` 写回空气：默认以自身为中心 5×5 区块、纵向 ±32 层，支持 `sweep N`、`box x1 y1 z1 x2 y2 z2` 与 `dry` 演练；只碰 ghost、跳过活跃会话的格、区块未加载则不盲写。
- **启动时检查新版本发布** — `src/net/UpdateChecker.js`，取数顺序为官方 API `releases/latest` → 官方网页 302 `location` → 自定义 `updateCheck.mirror`；`enabled=false` 时不注册调度任务、不联网。异步回调内只写纯数据（无 EngineScope），日志由一次性 `update-check` 任务在主线程打印。
- **新增 ghost 模型（addon更新）**
  - **活塞伸出态**：按原版 `pistonArm` 尺寸重建 `lit_piston_extended` / `lit_piston_head`，普通与黏性拆成独立 identifier；新增 `PistonStateInfer`，在 `.mcstructure` 本体不带 `extended_bit` 时按前方是否为活塞头推断。
  - **半砖 / 阳光传感器**：`lit_slab` / `lit_slab_top` / `lit_daylight_detector`，103 个半砖 × bottom/top/double 三件套，按面拆材质；状态全丢（MEGA 分块重载）时回落下半砖。
  - **楼梯 / 活板门 / 门**：形态改由 identifier 承载（新增 348 个 BP 定义），倒置楼梯、开合活板门、上半门各有独立模型与贴图。
  - **草与交叉板**：`geometry.lit_cross` 覆盖全部 66 个 `cross_texture` 方块 + 乘法染色贴图，草方块按面分材质，旧基岩别名（`grass` / `tallgrass` / `doubleplant`）按状态还原。

### Changed

- **配置与日志可运维化** — `config.json` 的 `logCleaner` 段真正生效（`scanInterval` / `patterns` / `backupEnabled` / `maxBackupFiles` 直通，能匹配空串的正则直接丢弃）；命令注册与 LogCleaner 启动期 INFO 默认静默，由 `misc.verboseCommandLog` / `misc.verboseStartupLog` 控制，`warn` / `error` 不受影响；保存选区的逐格日志改由 `schematicSave.verboseScan` 控制。
- **坐标与数值输入统一收口** — 新增 `src/utils/coordText.js`，放置/保存表单的坐标输入框前置为前三个控件，与 label 数量彻底解耦；`/lit placeat` 支持 `~ ~5 ~-3` 相对坐标。
- **版本一致性收口** — `ll.registerPlugin` 的版本三元组改为从 `PLUGIN_VERSION` 派生（LSE 会把三元组回写进 `manifest.json`），`check-version.mjs` 一次性校验插件四处版本、三元组、CHANGELOG 段落与 addon 五处版本 + 描述文本 + uuid。
- **形态选择定论** — 在 permutation 使用 `minecraft:geometry` 在 BDS 上不生效，形态一律由 identifier 承载，permutation 保留 `minecraft:transformation` 做旋转。

### Fixed

- **保存 / 加载**：`includes('air')` 把整类 `*_stairs` 当空气丢掉；同名 `.litematic` / `.mcstructure` 永远只加载前者；`.litematic` 状态键带 `minecraft:` 前缀导致观察者朝向漏进 Java 调色板。
- **放置**：半砖永远放下半砖（`type` → `vertical_half` 归一化 + 双半砖三种命名排法）、倒置楼梯不带 `upside_down_bit` 被判定状态错误、方向族（dispenser / dropper / hopper / crafter / furnace…）水平朝向整体反 180°、`.mcstructure` 直接放置后观察者朝向丢失（改用 `rawState` 保留原始键名）。
- **渲染**：不完整方块（红石粉、火把、地毯、压力板、花草…）不再参与六面遮挡导致投影出洞；观察者 ghost 去掉重合顶面，消除 z-fighting 引起的顶面贴图抖动。
- **删除投影不动世界** — `purgeProjection()` 三层兜底（活跃会话 → 孤儿快照按投影哈希/包围盒认亲 → 期望账本兜底），并先停 MEGA 注入；清不干净就不删记录，提示"靠近投影再删"。


## [3.0.2] - 2026-11-1

### Fixed
- **投影打印机恢复** — ghost 重构后修改打印机部分逻辑，现在其功能可用。
- **mega 大型投影功能恢复** — 允许大型投影放置，并具有与普通投影同样功能。60w 方块已实测可用。
- **删除无用代码** `src/easyplace/FastEasyPlace.js`（零引用，且用 `setInterval` 违反约定）。

### Added
- `config.json` / `ConfigManager` 新增 `easyPlace.printer`：`radius`、`maxPerCycle`、`budgetMs`、`placeDelayMs`、`overwriteReplaceable`、`debug`，实时读取、热改生效。
- `tests/test_printer_placement.js`（16 断言）+ `test_ghost_renderer.js` 的 2 条 `markSatisfied` 用例；`npm test` 共 21 脚本 / 276 断言。

## [3.0.1] - 2026-10-31

### Added
- **lip 安装支持** — 新增 `tooth.json`，服务端执行 `lip install github.com/copper-lamp/LitematicaBE` 即可安装插件与 BP/RP；客户端使用 `#client` 变体安装 BP/RP
- **自动发布** — 新增 CI 校验与 tag → Release 工作流，推送 `v*` tag 自动构建并上传产物
- **产物结构** — 统一为服务端 zip（插件 + BP/RP）、客户端 zip（BP/RP）、手动安装 zip、`.mcaddon` 与 `SHA256SUMS.txt`
- **README 双语** — `README.md`（中文）与 `README_EN.md`

### Fixed
- **大型投影回退** — Mega 渲染未启用或加载失败时不再丢弃整个投影：改为走标准加载与普通 ghost 渲染，避免超大投影加载后完全不可见
- **addon 版本一致性** — 把 BP/RP manifest 的 `header.version` 统一为 `1.1.8`，与 `ghost_index.json` / `addon_expected.json` 对齐，修复安装后 `server-bp-version-mismatch` 导致 ghost 写入被禁用的问题；构建时对三处版本做一致性校验
- **构建产物** — 修复 zip 中央目录中外部属性写入溢出导致的构建失败

## [3.0.0] - 2026-10-31

### Fixed
- **命令注册修复**
  - 修复 `/lit` 无法执行的问题（原缺少重载声明）；
  - 修复 `/litematica` 主命令因双 RawText 参数被 BDS 拒收的问题；
  - 修复 `/litematica:logclean`、`/litematica:config` 因缺少重载可能注册失败的问题。
- **`debug` 子命令修复**
  - 原 `args` 整串被当数组使用，`args[0]` 只取到第一个字符，所有 debug 子命令都失效；现已正确拆分
- **维度 ID 修复**
  - 修复 `player.dim` 恒为 `undefined` 的问题（LSE 中维度信息在 `pos.dimid`），跨维度选区校验、投影放置维度现在准确
- **包围盒修复** — 修复了 minecraft:basic_particle 在基岩版不存在的问题，改为聊天栏显示投影名称、尺寸、高度与占地四角坐标

### Added
- **ghost 方块系统** — 新增完整的 ghost 方块体系（500 余种方块定义），投影方块以半透明幽灵方块形式呈现，与真实建筑视觉分离
- **服务端重启自动恢复** — 服务器重启后自动清理上次异常退出留下的快照，并按期望集合补齐 ghost
- **会话保活机制** — 玩家离线不再立即撤销投影，30 分钟内回归可直接恢复；超时自动撤销，避免无限占用内存与世界
- **ghost 方块系统** — 新增一套完整的 ghost 方块体系（500 余种方块定义），投影方块以半透明幽灵方块形式呈现，与真实建筑视觉分离
- **新增命令功能** — 新增一套完整的 ghost 方块体系（500 余种方块定义），投影方块以半透明幽灵方块形式呈现，与真实建筑视觉分离
  - 注册`/litematica:ghost`：独立命令，含 `lay`（铺墙）、`undo`（撤销）、`info`（会话诊断）、`restore`（补齐期望）四个子动作
  - 注册`/litematica selfcheck`：一键自检整条写世界链路（读原状 → 快照 → 写幽灵 → 读回 → 撤销），逐项显示 PASS/FAIL 并说明失败原因

### Changed
- **渲染逻辑重构** — 渲染逻辑由 LSE 生成贴图粒子全面转向自定义 ghost 方块，调用 ghost 子系统，并移除了旧版粒子相关功能
- **统一 tick 调度器** — 全插件从多个独立 `onTick` / `setInterval` 收敛为单一调度器，带时间预算、优先级与启停管理。巨型投影优化，日志清理、FastPlace、actionBar 等任务统一排队执行
- **生命周期重构** — 为新渲染逻辑完善了生命周期，包括保活、重写、校验等
- **方块映射表升级** — 方块识别从"旧式容器 ID + 状态"升级为完整扁平化方块名，兼容新旧两套 ID（含 legacy 回退表），投影方块定位更精准
- **资源包升级** — 现在需要在服务端与客户端分别安装随插件提供的 addon 扩展包以完整体验 LitematicaBE 。插件将会对 addon 进行版本一致性校验
- **生命周期重构** — 为新渲染逻辑完善了生命周期，包括保活、重写、校验等
- **功能迁移测试** — 重构后部分旧版功能不再支持，正在适配并测试中
  - 实测通过：litematica 文件导入、原理图加载放置与卸载、分层显示投影等功能已确认可用
  - 暂不支持：mega 功能、投影打印机等拓展功能暂不可用，后续将继续完善

## [2.5.1] - 2026-06-07

### Fixed
- **Redstone block placement** — Fixed 6 missing Java→BE state conversions:
  - `redstone_wire`: `power` → `redstone_signal`
  - `observer`: `powered` → `powered_bit`
  - `piston/sticky_piston`: `extended` → `extended_bit`
  - `dispenser/dropper`: `triggered` → `triggered_bit`
  - `hopper`: `enabled` → `toggle_bit` (inverted)
  - `redstone_torch`: `lit=false` → BE block rename to `unlit_redstone_torch`
- **EasyPlaceManager** — Added missing BlockStateConverters/BlockMappingRegistry pipeline to fast place flow
- **Boolean NBT type** — `BidirectionalBlockConverter.buildBlockNbt` now uses `setByte` for boolean states
- **Mega direct placement** — Refactored to stream chunks one-by-one (read→place→free memory), avoiding OOM
- **Trapdoor/carpet mapping** — Fixed `open_bit`, `upside_down_bit`, carpet `color` state extraction
- **Mega projection deletion** — `DataManager.removeProjection` now auto-deletes mega chunk files

### Added
- **PlacementLogger** — Detailed failure logging for fast/easy place operations
  - Logs: Java name, BE name, original states, converted states, setblock command, failure reason
  - Log file: `plugins/LitematicaBE/logs/placement_failures_YYYY-MM-DD.log`
  - `/litematica failures` command to view in-game failure statistics (Top 20 by failure count)

### Changed
- **FastEasyPlace** — `placeBlockCreative`/`placeBlockSurvival` return `{success, error, cmd}` for detailed logging
- **BlockVerifier** — Changed to synchronous execution with no block count limit
- **setblock boolean states** — Added `extended_bit` to the binary-to-boolean conversion set

## [2.5.0] - 2026-06-06

### Added
- **Bidirectional block mapping system** — Complete Java ↔ Bedrock bidirectional conversion
  - `BlockMappingRegistry`: ~880 block name mappings with category/version/state metadata
  - `BlockStateConverters`: Covers direction, rails, stairs, doors, trapdoors, beds, redstone, buttons, levers, etc.
  - Round-trip test and coverage verification
- **FastEasyPlace (Printer)** — Auto-place projection blocks within 5-block radius
- **Raycaster** — Crosshair block targeting for projection
- **BlockVerifier** — Detect wrong/missing/mismatched blocks
- **MaterialCounter** — Material list statistics with Excel export

## [2.4.0] - 2026-05-17

### Added
- **Schematic save** — Save Bedrock world blocks as Java-compatible `.litematic` files
  - `SelectionTool`: Wooden sword right-click to select two corners
  - `SchematicSaver`: Scan selection, build palette, encode BlockStates
  - `NBTWriter`: Custom NBT serializer, fully compatible with Java Litematica format
  - Full block name mapping (Bedrock→Java) and state auto-conversion
- Fixed `LitematicLoader` Size parsing for `TAG_Int_Array` format

## [2.3.2] - 2026-05-16

### Fixed
- Mega projection: no block data (player parameter passthrough)
- Mega layer-by-layer rendering (use `updateBlocks` instead of `startRender`)
- Mega easy place (added `megaManager` support)
- Layer rendering starts at layer 0
- Block placement direction anomaly (`filterDirectionStates`)
- Liquid blocks filtered (water, lava)

## [2.3.1] - 2026-05-16

### Changed
- `BinaryChunkStorage` v2.0 — Rewritten with palette + bit-packing + GZip (80-90% compression)
- Chunk size changed from 16³ to 32³
- Async loading with `setImmediate` yield, no game blocking
- Render strategy: "render once, update on respawn"

## [2.3.0] - 2026-04-26

### Changed
- Mega mode architecture refactor — rendering unified under `ProjectionRenderer`
- Added `ProjectionRenderer.updateBlocks()` data source interface
- Fixed `StreamingLitematicLoader` array type parsing

## [2.2.0] - 2025-04-05

### Added
- Easy Place Module (`EasyPlaceManager`, `InventoryHelper`, `PositionConverter`, `BlockMatcher`)
- Auto-select correct block in projection area
- Shulker box item extraction
- `/litematica easyplace` command

## [2.0.0] - 2024-03-15

### Added
- Complete rewrite with modular architecture
- GUI menu system (SimpleForm)
- Three operation modes: Place, Rotate, Build
- Wooden sword interaction system
- Server-wide projection sharing

## [1.0.0] - 2024-XX-XX

### Added
- Initial release
- Basic schematic loading (.litematic and .json)
- Basic projection display
