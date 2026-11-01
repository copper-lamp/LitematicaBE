# Changelog

All notable changes to this project will be documented in this file.

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
