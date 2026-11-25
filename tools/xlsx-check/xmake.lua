--[[
    xlsx 导出侧的离线回归工程。

    这些源文件不依赖 LeviLamina/BDS 头文件：
      core/report/XlsxWriter（OOXML + zip，压缩走 miniz）
      core/report/MaterialCounter（调色板 → 材料聚合，纯数据）
      core/util/TextEncoding（路径 ↔ UTF-8）

    所以可以脱离游戏跑「生成文件 → 用 openpyxl 打开 → 逐格断言」，
    把「zip 结构 / 内容类型 / 样式索引 / 中文转义 / 百分比格式」这些
    Excel 一打不开就全盘皆输的地方钉死在 CI 之前。

    用法：
      cd tools/xlsx-check
      xmake f -P . -y -p windows -a x64 -m release
      xmake -P . -y
      python check.py
]]

add_rules("mode.release")
add_requires("miniz")

local repo = path.join(os.projectdir(), "..", "..")

target("lit_xlsx_check")
    set_kind("binary")
    set_languages("c++20")
    add_cxflags("/utf-8")
    add_packages("miniz")
    add_includedirs(path.join(repo, "src"))
    add_files(
        "main.cpp",
        path.join(repo, "src/LitematicaBE/core/report/XlsxWriter.cpp"),
        path.join(repo, "src/LitematicaBE/core/report/MaterialCounter.cpp"),
        path.join(repo, "src/LitematicaBE/core/util/TextEncoding.cpp"),
        -- 真实投影文件的解析（.mcstructure / .litematic）：用真实数据跑一遍
        -- 「文件 → 调色板状态串 → 材料聚合」，这两条链都不碰 BDS。
        path.join(repo, "src/LitematicaBE/core/nbt/NbtTag.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/LitematicFile.cpp"),
        path.join(repo, "src/LitematicaBE/core/schematic/McstructureFile.cpp")
    )
