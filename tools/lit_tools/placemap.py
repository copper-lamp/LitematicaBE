"""生成「真实放置」用的方块名数据。

两张表，都只解决**名字**；状态属性转换在 C++ 侧（`mapping::PlaceResolve`）。

- `resources/data/bedrock_names.json`
  Bedrock 注册表里存在的方块名候选池。来源是 LeviLamina 头文件
  `mc/world/level/block/VanillaBlockTypeIds.h`（约 1200 个 `MCAPI ::HashedString const& XxxYyy();`），
  函数名按 CamelCase → snake_case 转成注册名。**不是真值表**：个别名字（如 `GrassBlock`）
  与真实注册名（`grass`）不符，运行时由 `Block::tryGetFromRegistry` 验证，验证失败的候选自动跳过。

- `resources/data/java_bedrock.json`
  Java 方块名 → Bedrock 方块名，只收「两版叫法不同」的方块
  （`grass_block`→`grass`、`bricks`→`brick_block`、`melon`→`melon_block`…）。
  生成时用候选池校验目标名，对不上的打印警告 + 最接近的候选。

用法：`cd tools && python -m lit_tools placemap [--header <VanillaBlockTypeIds.h>]`
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from difflib import get_close_matches
from pathlib import Path

from . import paths

SCHEMA = 1

#: LeviLamina 包里 BlockTypeIds 头文件的相对路径。
HEADER_RELATIVE = Path("include/mc/world/level/block/VanillaBlockTypeIds.h")

_DECL = re.compile(r"^MCAPI\s+::HashedString\s+const&\s+(\w+)\s*\(\s*\)\s*;", re.MULTILINE)

#: 明显不是可放置方块的注册名（占位、元素块等）。
_SKIP_PREFIXES = ("Element", "ClientRequest", "Unknown", "PlaceholderBlock", "Reserved")
_SKIP_EXACT = {"Air", "VoidAir", "CaveAir"}


def snake_case(name: str) -> str:
    """`AcaciaDoubleSlab` → `acacia_double_slab`。"""
    step = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    step = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", step)
    return step.lower()


def default_header_path() -> Path | None:
    """在 xmake 包目录里找 levilamina 的 VanillaBlockTypeIds.h（取路径排序最后一份）。"""
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None
    root = Path(local) / ".xmake" / "packages" / "l" / "levilamina"
    if not root.is_dir():
        return None
    found = [
        candidate
        for candidate in root.rglob(HEADER_RELATIVE.name)
        if candidate.parent.name == "block"
    ]
    if not found:
        return None
    return sorted(found)[-1]


def parse_bedrock_names(header: Path) -> list[str]:
    text = header.read_text(encoding="utf-8", errors="replace")
    names: set[str] = set()
    for match in _DECL.finditer(text):
        symbol = match.group(1)
        if symbol in _SKIP_EXACT or symbol.startswith(_SKIP_PREFIXES):
            continue
        names.add(snake_case(symbol))
    return sorted(names)


#: Java 方块名 → Bedrock 注册名。只写两版**叫法不同**的方块；
#: 同名的（stone / oak_planks / glass / dirt …）不列，运行时会原样命中。
JAVA_TO_BEDROCK: dict[str, str] = {
    # 土与地表
    # 旧版本 Bedrock 的真实差异（B1.21 里原名也能命中，但保留映射兼容旧服务端）
    "grass_block": "grass",
    "coarse_dirt": "dirt",
    "snow": "snow_layer",
    "slime_block": "slime",
    "stone_bricks": "stonebrick",
    "chiseled_stone_bricks": "chiseled_stonebrick",
    "cracked_stone_bricks": "cracked_stonebrick",
    "mossy_stone_bricks": "mossy_stonebrick",
    "tall_grass": "tallgrass",
    "stonecutter": "stonecutter_block",
    "light": "light_block",
    "dirt_path": "grass_path",
    "rooted_dirt": "dirt_with_roots",
    "farmland": "farmland_block",
    # 石与砖
    "bricks": "brick_block",
    "nether_bricks": "nether_brick",
    "red_nether_bricks": "red_nether_brick",
    "end_stone_bricks": "end_bricks",
    "magma_block": "magma",
    # 植被与杂物
    "cobweb": "web",
    "dead_bush": "deadbush",
    "lily_pad": "water_lily",
    "sugar_cane": "reeds",
    "beetroots": "beetroot",
    "tripwire": "trip_wire",
    "kelp_plant": "kelp",
    "tall_seagrass": "seagrass",
    "glow_berries": "cave_vines",
    # 功能方块
    "note_block": "noteblock",
    "melon": "melon_block",
    "jack_o_lantern": "lit_pumpkin",
    "spawner": "mob_spawner",
    "shulker_box": "undyed_shulker_box",
    "piston_head": "piston_arm_collision",
    "moving_piston": "moving_block",
    "repeater": "unpowered_repeater",
    "comparator": "unpowered_comparator",
    "wall_torch": "torch",
    "soul_wall_torch": "soul_torch",
    "redstone_wall_torch": "redstone_torch",
    "nether_portal": "portal",
    "frogspawn": "frog_spawn",
    # 木制品：橡木的四种在 Bedrock 里没有 oak_ 前缀
    "oak_door": "wooden_door",
    "oak_trapdoor": "trapdoor",
    "oak_button": "wooden_button",
    "oak_pressure_plate": "wooden_pressure_plate",
    "oak_sign": "standing_sign",
    "oak_wall_sign": "wall_sign",
}


@dataclass
class Report:
    bedrock_names: int = 0
    explicit: int = 0
    same_name: list[str] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)


def build_java_table(bedrock_names: set[str]) -> tuple[dict[str, str], Report]:
    report = Report(bedrock_names=len(bedrock_names))
    table: dict[str, str] = {}

    for java, bedrock in JAVA_TO_BEDROCK.items():
        if java == bedrock:
            continue
        # 候选池是从 VanillaBlockTypeIds 的符号名推断的（SlimeBlock → slime_block），
        # 不等于真实注册名（slime_block 的真实注册名就是 slime）。所以「候选池里有原名」
        # 不能作为删除映射的依据 —— 运行时候选链是「原样优先」，原样能命中时映射不会被用到。
        if java in bedrock_names:
            report.same_name.append(f"{java}（候选池里有原名，映射仅在原样失败时生效）")
        if bedrock not in bedrock_names:
            close = get_close_matches(bedrock, sorted(bedrock_names), n=1, cutoff=0.72)
            hint = f"（最接近：{close[0]}）" if close else ""
            report.unresolved.append(f"{java} -> {bedrock}{hint}")
            # 仍然写进表：运行时 tryGetFromRegistry 会判真伪，这里只提示可能写错了。
        table[java] = bedrock
        report.explicit += 1
    return table, report


def write(header: Path | None = None) -> tuple[Path, Path, Report]:
    header = header or default_header_path()
    if header is None or not header.is_file():
        raise FileNotFoundError(
            "找不到 VanillaBlockTypeIds.h；用 --header 指定，或先让 xmake 拉取 levilamina 包"
        )

    names = parse_bedrock_names(header)
    if len(names) < 500:
        raise ValueError(f"候选名太少（{len(names)}），头文件解析可能失败：{header}")

    names_path = paths.data_dir() / "bedrock_names.json"
    names_path.write_text(
        json.dumps(
            {"schema": SCHEMA, "source": header.name, "count": len(names), "names": names},
            ensure_ascii=False,
            indent=0,
        )
        + "\n",
        encoding="utf-8",
    )

    table, report = build_java_table(set(names))
    java_path = paths.data_dir() / "java_bedrock.json"
    java_path.write_text(
        json.dumps(
            {
                "schema": SCHEMA,
                "hint": "Java 方块名 -> Bedrock 注册名；名字一致的不必列出",
                "count": len(table),
                "names": dict(sorted(table.items())),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return names_path, java_path, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lit_tools placemap", description="生成放置用的方块名数据")
    parser.add_argument("--header", type=Path, default=None, help="VanillaBlockTypeIds.h 路径")
    args = parser.parse_args(argv)

    try:
        names_path, java_path, report = write(args.header)
    except (FileNotFoundError, ValueError) as exc:
        print(f"[x] {exc}", file=sys.stderr)
        return 1

    for path in (names_path, java_path):
        try:
            shown = path.relative_to(paths.repo_root())
        except ValueError:
            shown = path
        print(f"[ok] 已生成 {shown}")
    print(f"     Bedrock 候选名 {report.bedrock_names}")
    print(f"     Java→Bedrock 显式映射 {report.explicit} 条")
    for item in report.same_name:
        print(f"[i] 冗余映射已剔除：{item}")
    for item in report.unresolved:
        print(f"[!] 目标名不在候选清单：{item}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
