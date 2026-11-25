--[[
    写入侧（.litematic / .mcstructure）的离线回归工程。

    这些源文件不依赖 LeviBoost/BDS 头文件：
      core/nbt/NbtTag + NbtWriter（序列化 / gzip）
      core/schematic/PaletteBits + LitematicWriter + LitematicFile（读）
      core/schematic/McstructureWriter + McstructureFile（读）
      core/save/RegionScan.h 里的 PaletteSlot / StateValue（纯数据结构）
      selection/SelectionStore.h 里的 Box（纯数据结构）

    所以可以脱离游戏跑「写 → 读 → 逐格比对」，这是位打包 / 索引顺序 /
    小端大端 / gzip 这几处最容易错的地方唯一可靠的自动验证。

    用法：
      xmake f -y -p windows -a x64 -m release
      xmake -y
      ./build/windows/x64/release/lit_write_check.exe
]]

add_rules("mode.release")
add_requires("miniz")

local repo = path.join(os.projectdir(), "..", "..")

target("lit_write_check")
    set_kind("binary")
    set_languages("c++20")
    add_cxflags("/utf-8")
    add_packages("miniz")
    add_includedirs(path.join(repo, "src"))
    add_files(
        "main.cpp",
        path.join(repo, "src/LitematicaBE/core/nbt/NbtTag.cpp"),
        path.join(repo, "src/LitematicaBE/core/nbt/NbtWriter.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/LitematicFile.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/LitematicWriter.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/McstructureFile.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/McstructureWriter.cpp"),
        path.join(repo, "src/LitematicaBE/core/util/TextEncoding.cpp")
    )
