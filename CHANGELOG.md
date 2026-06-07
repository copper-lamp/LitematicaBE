# Changelog

All notable changes to this project will be documented in this file.

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
