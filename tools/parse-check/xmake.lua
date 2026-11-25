--[[
    .litematic 解析器的离线回归工程。

    这两个源文件不依赖 LeviLamina/BDS 头文件，所以可以脱离游戏编译，
    用来验证「NBT 小端解析 / gzip 解压 / 位解包 / 属性字符串化」这些最容易写错的地方。

    用法：
      xmake f -y -p windows -a x64 -m release
      xmake -y
      python check.py
]]

add_rules("mode.release")
add_requires("miniz")

local repo = path.join(os.projectdir(), "..", "..")

target("lit_parse_check")
    set_kind("binary")
    set_languages("c++20")
    add_cxflags("/utf-8")
    add_packages("miniz")
    add_includedirs(path.join(repo, "src"))
    add_files(
        "main.cpp",
        path.join(repo, "src/LitematicaBE/core/nbt/NbtTag.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/LitematicFile.cpp")
    )
