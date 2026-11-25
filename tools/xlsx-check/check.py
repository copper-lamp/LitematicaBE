"""材料清单 xlsx 的端到端校验：跑 C++ 自检 → 用 openpyxl 真打开 → 逐格断言。

为什么非要 openpyxl：xlsx 打不开时 Excel 只会说「文件已损坏」，日志里什么都看不到。
zip 结构、`[Content_Types].xml`、关系表、`cellXfs` 索引、inlineStr 转义、
百分比数字格式，任何一处写错都是这个结果，所以必须用真正的解析器过一遍。

用法：
    cd tools/xlsx-check
    xmake f -P . -y -p windows -a x64 -m release
    xmake -P . -y
    python check.py            # 需要 openpyxl
"""

from __future__ import annotations

import math
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

REQUIRED_PARTS = {
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
}


def find_exe() -> Path:
    candidates = list((HERE / "build").glob("**/lit_xlsx_check.exe"))
    if not candidates:
        raise SystemExit("找不到 lit_xlsx_check.exe，先在本目录跑 `xmake -P . -y`")
    return candidates[0]


def check(failures: list[str], condition: bool, what: str) -> None:
    if condition:
        print(f"[ok] {what}")
    else:
        failures.append(what)
        print(f"[x] {what}")


def main() -> int:
    try:
        import openpyxl
    except ImportError:
        raise SystemExit("需要 openpyxl：pip install openpyxl")

    exe = find_exe()
    sample = HERE / "build" / "material-sample.xlsx"

    result = subprocess.run(
        [str(exe), str(sample)], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    print(result.stdout.strip())
    if result.returncode != 0:
        print(result.stderr.strip())
        raise SystemExit("C++ 自检失败")

    failures: list[str] = []
    check(failures, sample.is_file(), "生成了 xlsx 文件")

    # 1) 容器结构：缺一个 part，Excel 就打不开
    with zipfile.ZipFile(sample) as archive:
        names = set(archive.namelist())
        check(failures, REQUIRED_PARTS <= names, f"zip 包含全部必需 part（{len(names)} 项）")
        check(failures, archive.testzip() is None, "zip 每个条目 CRC 可解压")
        content_types = archive.read("[Content_Types].xml").decode("utf-8")
        check(failures, "sheet2.xml" in content_types, "[Content_Types].xml 声明了 sheet2")
        check(failures, "styles.xml" in content_types, "[Content_Types].xml 声明了 styles")

    # 2) 真解析器打开
    wb = openpyxl.load_workbook(sample)
    check(failures, wb.sheetnames == ["材料清单", "投影信息"], f"工作表名 {wb.sheetnames}")

    ws = wb["材料清单"]
    check(failures, ws["A1"].value == "序号" and ws["G1"].value == "状态串样例", "表头文字")
    check(failures, bool(ws["A1"].font.bold), "表头加粗")
    check(failures, ws.freeze_panes == "A2", f"冻结首行（freeze_panes={ws.freeze_panes}）")
    check(failures, ws.auto_filter.ref is not None and ws.auto_filter.ref.startswith("A1:G4"), f"自动筛选 {ws.auto_filter.ref}")
    check(failures, math.isclose(ws.column_dimensions["B"].width or 0, 34.0, abs_tol=0.5), "列宽 B=34")

    check(failures, ws["D2"].value == 12345, f"数量按数字存（D2={ws['D2'].value!r}）")
    check(failures, abs(float(ws["E2"].value) - 0.7352) < 1e-6, f"占比按比值存（E2={ws['E2'].value!r}）")
    check(failures, ws["E2"].number_format == "0.00%", f"占比显示格式 {ws['E2'].number_format!r}")
    check(failures, ws["D2"].number_format == "#,##0", f"数量显示格式 {ws['D2'].number_format!r}")
    check(failures, ws["C3"].value == "红色", "中文变体原样写出")
    check(failures, ws["G3"].value == "minecraft:wool[color=red]", "状态串原样写出")
    check(failures, ws["B4"].value == "合计" and ws["D4"].value == 12362, "合计行")
    check(failures, bool(ws["D4"].font.bold), "合计行加粗")

    info = wb["投影信息"]
    check(failures, info["A1"].value == "项目" and info["B1"].value == "值", "信息表表头")
    check(failures, info["B2"].value == "自检样例 <&\"'>", f"XML 特殊字符往返（B2={info['B2'].value!r}）")

    if failures:
        print(f"\n{len(failures)} 项失败")
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
