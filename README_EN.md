<div align="center">
  <img src="resources/pack_icon.png" alt="LitematicaBE icon" width="160">
  <h1>LitematicaBE</h1>
  <p><strong>Java Edition Litematica workflows, on Bedrock Edition.</strong></p>
  <p>Load and save <code>.litematic</code> files, render projections with translucent ghost blocks, build layer by layer, and place blocks with easy-place and material lists.</p>

  <p>
    <img src="https://img.shields.io/badge/release-v3.0.1-4c8bf5?style=flat-square" alt="LitematicaBE v3.0.1">
    <img src="https://img.shields.io/badge/Minecraft%20Bedrock-1.21.132%2B-62b47a?style=flat-square" alt="Minecraft Bedrock 1.21.132+">
    <img src="https://img.shields.io/badge/LeviLamina-26.10%2B-7b68ee?style=flat-square" alt="LeviLamina 26.10+">
    <img src="https://img.shields.io/badge/LegacyScriptEngine-nodejs%200.22.x-ffb300?style=flat-square" alt="LegacyScriptEngine nodejs 0.22.x">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
  </p>

  <p>
    <a href="#quick-start">Quick Start</a>
    ·
    <a href="https://github.com/copper-lamp/LitematicaBE/releases">Releases</a>
    ·
    <a href="CHANGELOG.md">Changelog</a>
    ·
    <a href="https://github.com/copper-lamp/LitematicaBE/issues">Report an issue</a>
    ·
    <a href="#contributing">Contributing</a>
    ·
    <a href="README.md">简体中文</a>
  </p>
</div>

> [!WARNING]
> 3.x is still being refactored. Mega projections and the projection printer are not available yet. Back up your worlds before upgrading, and keep the plugin and addon versions identical — otherwise ghost writes are disabled.

LitematicaBE is a projection plugin for Minecraft Bedrock Edition servers (BDS + LeviLamina). It reads Java Edition `.litematic` files, rebuilds the schematic in-world with custom ghost blocks, and provides layer-by-layer building, easy place, block verification, and material lists. Saved `.litematic` files can be opened in Java Edition Litematica.

## Quick Start

> [!IMPORTANT]
> LitematicaBE ships as a server plugin plus BP/RP addon packs. Both the server and the client need them, and their versions must match.

1. Install lip if you have not already:

   ```shell
   npm install -g @levimc/lip
   ```

2. **Server**: run this from the BDS root directory:

   ```shell
   lip install github.com/copper-lamp/LitematicaBE
   ```

   The plugin is installed to `plugins/LitematicaBE/`; BP and RP go to `behavior_packs/` and `resource_packs/`.

3. **Client**: open **Content Download → lip** in LeviLauncher and install LitematicaBE, or run this from the client instance root:

   ```shell
   lip install github.com/copper-lamp/LitematicaBE#client
   ```

   Players who cannot use lip can import `LitematicaBE-client-<version>.mcaddon` from the release.

4. **Enable the packs in your world**: add the BP/RP `pack_id` and `version` to `worlds/<world>/world_behavior_packs.json` and `world_resource_packs.json` (or tick them in the world settings), then restart the server.

   ```json
   [
     { "pack_id": "<header.uuid of the BP>", "version": [0, 0, 1] }
   ]
   ```

5. Put `.litematic` files into `plugins/LitematicaBE/schematics/`, then hold a wooden sword, sneak, and right-click to open the main menu.

Pin a version when installing:

```shell
lip install github.com/copper-lamp/LitematicaBE@3.0.1          # server
lip install github.com/copper-lamp/LitematicaBE#client@3.0.1   # client
```

Update with `lip update github.com/copper-lamp/LitematicaBE`. `lip` only manages the server workspace; the client instance is managed by LeviLauncher, and the `#client` variant is required there.

## Compatibility

| Component | Version |
| --------- | ------- |
| Minecraft Bedrock Server | 1.21.132+ |
| LeviLamina | 26.10+ |
| LegacyScriptEngine (nodejs variant) | 0.22.x |
| LitematicaBE plugin / addon | Published together; the plugin verifies both sides match |
| Client platform | Windows x64 (use the `.mcaddon` manually on other platforms) |

## Features

| Feature | Description |
| ------- | ----------- |
| Schematic loading | Load Java Edition `.litematic` files |
| Schematic saving | Save Bedrock builds as `.litematic`, interoperable with Java Litematica |
| Ghost rendering | Custom ghost blocks with translucent textures, close to vanilla Litematica |
| Layer building | Switch the visible Y layer; look up for the next layer, down for the previous |
| Easy place | Aim at the projection with materials in hand for precise placement (being refactored) |
| Direct placement | OP + Creative writes the whole projection with NBT |
| Block conversion | Two-way Java ↔ Bedrock mapping with a legacy fallback table |
| Projection management | Multiple projections, load/unload/delete, material list export |
| Mega projections | Chunked storage + streaming + LOD (being refactored, currently unavailable) |
| Self check | `/litematica selfcheck` verifies the ghost write pipeline |

### Controls

| Action | Description |
| ------ | ----------- |
| Wooden sword + sneak + click | Open the main menu |
| Look up / down + sword click | Switch the layer in layer mode |
| Look straight + sword click | Show all layers |
| `/lit` / `/litematica` | Command entry points |

## Commands

```shell
# Core
/litematica menu          # open the main menu
/litematica load <file>   # load a schematic
/litematica place <file>  # load and place under your feet
/litematica placeat X Y Z # place at the given coordinates
/litematica easyplace     # toggle easy place
/litematica printer       # toggle the projection printer
/litematica verify        # verify placed blocks
/litematica materials     # export the material list as Excel
/litematica save          # save a schematic (selection mode)
/litematica build         # switch to build (layer) mode
/litematica rotate        # switch to rotate mode
/litematica list          # list projections
/litematica clear         # clear the current projection
/litematica info          # show projection details
/litematica debug <sub>   # debug commands (mega/stats/config)
/litematica selfcheck     # self check

# Tools
/litematica:logclean status|clean|config   # log cleaner
/litematica:config reload|reset|get <key>  # configuration
/litematica:ghost lay|undo|info|restore    # ghost diagnostics
```

## Usage

### Load and place

1. Put `.litematic` files into `plugins/LitematicaBE/schematics/`.
2. Sneak + wooden sword click, choose **Load projection**, and pick a file.
3. Adjust the position in the placement panel (default: under your feet) and submit.

### Layer building

1. Open the projection actions panel and enable **layer display**.
2. Sword right-click: look **up** for the next layer, **down** for the previous, straight ahead for all layers.

### Easy place

1. Enable **easy place** in the projection actions panel, then aim at the projection with matching materials.
2. Enable the **projection printer** for continuous placement; click the menu again to disable.

### Direct placement (administrators)

1. Requires **OP** and **Creative** mode.
2. Open the projection details and choose **Place all blocks**.

### Saving

1. Click **Save projection**, start a selection, and mark two opposite corners with the sword.
2. Enter a name and description; the file is saved as `.litematic`.

### Verification

Choose **Verify projection** to compare the world against the projection and report matches, differences, missing, and wrong blocks.

## Manual installation

Download `LitematicaBE-<version>.zip` from the release:

1. Extract `plugins/LitematicaBE/` into the BDS `plugins/` directory.
2. Copy `LitematicaBE-server-BP/` and `LitematicaBE-server-RP/` into `behavior_packs/` and `resource_packs/`.
3. Enable the packs as described in Quick Start step 4 and restart the server.
4. Give `.mcaddon` to players to import on their clients.
5. Put `.litematic` files into `plugins/LitematicaBE/schematics/`.

## Repository layout

```text
LitematicaBE/
├── index.js                        # entry point
├── manifest.json                   # LSE plugin manifest
├── tooth.json                      # lip package (server + client variants)
├── config.json                     # default configuration
├── resources/
│   ├── pack_icon.png               # project icon
│   ├── addon/                      # BP / RP / mcaddon sources
│   └── data/                       # ghost index and expected addon version
├── src/                            # core, renderer, ghost, mappings, UI
├── tools/                          # version check and release packaging
└── .github/workflows/              # CI and tag releases
```

Runtime directories (not committed): `schematics/`, `mega_schematics/`, `exports/`, `data/`, `logs/`.

## Build from source

Node.js 20+ is required. Artifacts are written to `build/`:

```shell
npm ci
node tools/check-version.mjs
npm run build
```

| Artifact | Purpose |
| ----- | ------- |
| `LitematicaBE-server-<version>.zip` | lip server variant (plugin + BP/RP) |
| `LitematicaBE-client-<version>.zip` | lip client variant (BP/RP) |
| `LitematicaBE-<version>.zip` | manual installation |
| `LitematicaBE-client-<version>.mcaddon` | manual import |
| `SHA256SUMS.txt` | checksums |

## Release process

1. Sync the version in `package.json`, `manifest.json`, and `tooth.json`, and add a `## [<version>]` section to `CHANGELOG.md`.
2. Tag and push:

   ```shell
   git tag v3.0.1
   git push origin v3.0.1
   ```

3. `.github/workflows/release.yml` validates version consistency, builds every artifact, and creates the GitHub Release. Tags containing `-preview`, `-beta`, or `-rc` are published as prereleases.

## FAQ

**Q: Why are some 3.x features unavailable?**
A: The third-generation rewrite is in progress. Mega projections and the projection printer are not restored yet.

**Q: The projection shows air or wrong textures.**
A: Usually a block mapping issue. Report it with the block name and a screenshot.

**Q: Ghost writes are disabled / version mismatch.**
A: The plugin, server BP/RP, and client addon must come from the same build. Run `/litematica selfcheck` and make sure the packs are enabled in the world.

**Q: Large projections are slow or fail to load.**
A: Mega mode kicks in above 30,000 blocks and is still being refactored; consider splitting very large projections.

**Q: Easy place does not work.**
A: Check that the schematic loaded, the block mappings are complete, and easy place is enabled.

**Q: Direct placement says permission denied.**
A: It requires both **OP** and **Creative** mode.

**Q: Can saved schematics be opened in Java Edition?**
A: Yes, the format is compatible with Java Litematica.

**Q: Anything else after installing with lip?**
A: Enable BP/RP in the world settings and restart; client players also need to enable the packs after importing the addon.

## Contributing

Issues and pull requests are welcome.
QQ group: 861900673
GitHub: <https://github.com/copper-lamp/LitematicaBE>

## Acknowledgements

- [Litematica](https://github.com/maruohon/litematica) — the Java Edition schematic mod this project stays compatible with
- [LeviLamina](https://github.com/LiteLDev/LeviLamina) — Bedrock mod loader
- [LegacyScriptEngine](https://github.com/LiteLDev/LegacyScriptEngine) — LSE script engine
- [lip](https://github.com/LiteLDev/lip) — LeviLamina package manager

## License

MIT License
