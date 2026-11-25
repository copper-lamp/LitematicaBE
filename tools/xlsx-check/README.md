# xlsx-check — 材料清单导出的离线回归

`core/report/XlsxWriter`（OOXML + zip）与 `core/report/MaterialCounter`（调色板 → 材料聚合）都不依赖
LeviLamina/BDS 头文件，所以能脱离游戏编成一个小 exe 跑。

xlsx 的失败方式是「玩家双击说文件已损坏，日志里什么都没有」：zip 结构、`[Content_Types].xml`、
关系表、`cellXfs` 索引、inlineStr 转义、百分比数字格式，任何一处写错都是这个结果。
因此这里不只比对字符串，而是**用真正的解析器（openpyxl）把生成的文件打开**。

## 跑法

```bash
cd tools/xlsx-check
xmake f -P . -y -p windows -a x64 -m release
xmake -P . -y
python check.py            # 需要 openpyxl
```

期望输出：

```
[ok] 总格数 17
[ok] 材料种类 5（朝向不同不拆开）
...
[ok] zip 包含全部必需 part（9 项）
[ok] 工作表名 ['材料清单', '投影信息']
[ok] 占比显示格式 '0.00%'
全部通过
```

还可以喂一份真实投影文件，跑完整链路（文件 → 调色板状态串 → 材料聚合 → xlsx）：

```bash
./build/windows/x64/release/lit_xlsx_check.exe build/material-sample.xlsx <某个.mcstructure|.litematic>
```

它会把统计结果的前 10 项打到 stdout，并在同目录再写一份 `material-real.xlsx`。
这一步不经过映射表（不需要 BDS / `ghost_map.json`），验证的是「解析 → 拼状态串 → 聚合」三段。

## 覆盖什么

C++ 侧（`main.cpp`，不依赖 openpyxl）：

- 颜色变体分开（`wool[color=red]` / `[color=blue]` 各算一种材料），木种 / 石材 / 沙土变体同理；
- 朝向、开关、上下半砖这类状态**不**拆行（楼梯两种朝向合并成一行）；
- 排序按数量降序；越界调色板下标被跳过而不崩；
- 不可放置标记（`mPaletteBlocks` 解析失败）与对应格数。

Python 侧（`check.py`）：

- zip 里 9 个必需 part 齐全、每个条目 CRC 可解压、`[Content_Types].xml` 声明了 sheet2 与 styles；
- openpyxl 能打开，工作表名与顺序正确；
- 表头加粗、冻结首行（`freeze_panes == "A2"`）、自动筛选范围、列宽；
- 数量按数字存（`#,##0`）、占比按 0~1 比值存（`0.00%`）、中文变体与状态串原样写出、合计行加粗；
- XML 特殊字符（`<&"'>`）往返一致。

## 加断言

`main.cpp` 里的 `testWorkbook()` 决定生成的文件内容，`check.py` 里对应加断言即可。
真实投影的口径验证请在测试服用 `/lit load` + `/lit material` 跑一遍，核对聊天栏回显与 xlsx 合计。
