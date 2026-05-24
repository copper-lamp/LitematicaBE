# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2025-04-05

### Added
- **Easy Place Module** - Complete new feature for automatic block selection
  - `EasyPlaceManager.js` - Main manager for easy place functionality
  - `InventoryHelper.js` - Inventory search and shulker box extraction
  - `PositionConverter.js` - Coordinate transformation utilities
  - `BlockMatcher.js` - Block type and state matching logic
- Auto-select correct block when placing in projection area
- Shulker box item extraction support
- Block state matching (direction, etc.)
- Wrong placement prevention with notification
- `/litematica easyplace` command to toggle feature
- GUI menu integration for easy place toggle
- `isInProjectionRangeDebug()` method for detailed range checking diagnostics

### Changed
- Unified projection state management with `ProjectionManager`
- Improved layer switching synchronization
- Particle position now displays at block center (x+0.5, y+0.5, z+0.5)
- Auto-switch to build mode after placing projection
- Enhanced debug logging for troubleshooting

### Fixed
- "Projection does not exist" error when switching layers
- Particle not displaying at block center
- GUI delete projection error (boundary check)
- Layer render mode not syncing with build mode
- ID mismatch between currentProjectionId and projections.json
- **Easy Place not working** - Fixed dimension check failing when `projection.dimension` is undefined (legacy projections)
  - Root cause: Legacy projections saved before dimension field was added
  - Solution: Skip dimension check if `projection.dimension === undefined`

### Architecture
- Added `src/easyplace/` module directory
- Added `src/data/DataManager.js` for data persistence
- Added `src/utils/` for utility functions
- Added `src/core/ConfigManager.js` and `LogCleaner.js`

## [2.0.0] - 2024-03-15

### Added
- Complete plugin rewrite with modular architecture
- GUI menu system with SimpleForm
- Three operation modes: Place, Rotate, Build
- Wooden sword interaction system
- Server-wide projection sharing
- Range notification system
- Projection bounds display
- Layer-by-layer rendering support
- 90-degree rotation support

### Changed
- Improved file loading performance
- Better error handling and logging
- Modular code structure (core, render, ui, data)

### Fixed
- Various bug fixes and stability improvements

## [1.0.0] - 2024-XX-XX

### Added
- Initial release
- Basic schematic loading (.litematic and .json)
- Basic projection display
- Simple command system

---

## Upgrade Notes

### Upgrading from v2.0.x to v2.2.0
- New Easy Place feature is disabled by default
- Use `/litematica easyplace` or GUI menu to enable
- Existing projections will work without changes

### Upgrading from v1.x to v2.x
- The plugin has been completely rewritten
- Some commands may have changed
- Please backup your data before upgrading

---

## Known Issues

- Large schematics may take time to load
- Some NBT data may not be fully supported
- Multi-layer rotation not yet implemented

---

## Roadmap

### Planned for future releases:
- [x] Easy place functionality (v2.2.0)
- [ ] Material list functionality
- [ ] Selection tool (wooden sword selection)
- [ ] Save selection as schematic
- [ ] Verification (detect missing/extra/wrong blocks)
- [ ] Entity-based rendering (alternative to direct block placement)
- [ ] Binary compression format
- [ ] Multi-player projection support
- [ ] Configuration file system
