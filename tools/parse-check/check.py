"""把 lit_parse_check 的输出与 tests/fixtures/*.expected.json 对比。

约定：测例由 `python -m lit_tools fixture` 生成，expected 里的坐标是区域局部坐标，
C++ 输出的是加过 Region.Position 的绝对坐标，这里做一次平移再比较。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FIXTURES = REPO / "tests" / "fixtures"


def find_exe() -> Path:
    candidates = list((HERE / "build").glob("**/lit_parse_check.exe"))
    if not candidates:
        raise SystemExit("找不到 lit_parse_check.exe，先在本目录跑 `xmake -P . -y`")
    return candidates[0]


def parse_output(text: str) -> list[tuple[int, int, int, str, tuple]]:
    blocks = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("BLOCK "):
            continue
        fields = line.split(" ")
        x, y, z, name = int(fields[1]), int(fields[2]), int(fields[3]), fields[4]
        props = {}
        if len(fields) > 5 and fields[5]:
            for pair in fields[5].split(";"):
                if "=" in pair:
                    key, value = pair.split("=", 1)
                    props[key] = value
        blocks.append((x, y, z, name, tuple(sorted(props.items()))))
    return sorted(blocks)


def load_expected(path: Path) -> list[tuple[int, int, int, str, tuple]]:
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    px, py, pz = data["position"]
    return sorted(
        (
            block["x"] + px,
            block["y"] + py,
            block["z"] + pz,
            block["name"],
            tuple(sorted(block["properties"].items())),
        )
        for block in data["blocks"]
    )


def main() -> int:
    exe = find_exe()
    cases = sorted(FIXTURES.glob("*.litematic"))
    if not cases:
        raise SystemExit("tests/fixtures 下没有 .litematic，先跑 `python -m lit_tools fixture`")

    failures = 0
    for case in cases:
        expected_path = case.with_name(case.name.replace(".litematic", ".expected.json"))
        if not expected_path.is_file():
            print(f"[skip] {case.name}（没有 expected）")
            continue

        result = subprocess.run(
            [str(exe), str(case)], capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if result.returncode != 0:
            print(f"[x] {case.name} 运行失败：{result.stdout.strip()} {result.stderr.strip()}")
            failures += 1
            continue

        got = parse_output(result.stdout)
        want = load_expected(expected_path)
        if got == want:
            print(f"[ok] {case.name}：{len(got)} 个方块一致")
            continue

        failures += 1
        print(f"[x] {case.name}：期望 {len(want)} 个方块，实际 {len(got)} 个")
        for index, (a, b) in enumerate(zip(want, got)):
            if a != b:
                print(f"    第 {index} 项不同：期望 {a} / 实际 {b}")
                break
        if len(want) != len(got):
            print(f"    多出：{got[len(want):][:3]}")
            print(f"    缺少：{want[len(got):][:3]}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
