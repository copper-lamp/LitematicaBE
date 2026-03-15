# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- [ ] Material list functionality
- [ ] Selection tool (wooden sword selection)
- [ ] Save selection as schematic
- [ ] Verification (detect missing/extra/wrong blocks)
- [ ] Auto block selection
- [ ] Easy place functionality
- [ ] Entity-based rendering (alternative to direct block placement)
- [ ] Binary compression format
- [ ] Multi-player projection support
- [ ] Configuration file system
