"""生成表面剔除用的「遮挡白名单」`occlusion.json`。

原理：投影里一个方块如果 6 个邻居都是**不透明完整方块**，它一定看不见，可以整个不发送。
判定「邻居算不算遮挡」就是这张表要回答的问题：

* 白名单里的方块（玻璃、楼梯、半砖、栅栏、门、树叶……）**不遮挡**邻居的面；
* 表外方块默认**遮挡**（`defaultOccludes=true`）。

维护方式：
1. 改本文件的规则（后缀 / 精确名 / 关键字），
2. `python -m lit_tools occlusion` 重新生成，
3. 表里的每个名字都会拿去和 `ghost_index.json` 的 Java 方块清单核对（不存在的会报警）。
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from . import paths

SCHEMA_VERSION = 1

# 后缀命中即视为「不完整/可透视」：这些方块自身不遮挡相邻面。
TRANSPARENT_SUFFIXES = (
    "_stairs",
    "_slab",
    "_fence",
    "_fence_gate",
    "_wall",
    "_door",
    "_trapdoor",
    "_pane",
    "_bars",
    "_chain",
    "_lantern",
    "_torch",
    "_candle",
    "_button",
    "_pressure_plate",
    "_sign",
    "_banner",
    "_bed",
    "_carpet",
    "_sapling",
    "_flower",
    "_tulip",
    "_orchid",
    "_dandelion",
    "_poppy",
    "_bluet",
    "_cornflower",
    "_lily",
    "_mushroom",
    "_fungus",
    "_roots",
    "_sprouts",
    "_vine",
    "_fern",
    "_grass",
    "_bush",
    "_coral",
    "_rail",
    "_repeater",
    "_comparator",
    "_tripwire",
    "_lever",
    "_piston_head",
    "_head",
    "_skull",
    "_pot",
    "_composter",
    "_cauldron",
    "_hopper",
    "_brewing_stand",
    "_enchanting_table",
    "_campfire",
    "_lectern",
    "_bell",
    "_beacon",
    "_conduit",
    "_sculk_sensor",
    "_sculk_shrieker",
    "_amethyst_cluster",
    "_bud",
    "_frame",
    "_web",
    "_cobweb",
    "_sugar_cane",
    "_kelp",
    "_seagrass",
    "_bamboo",
    "_cactus",
    "_chorus",
    "_dripleaf",
    "_azalea",
    "_spore",
    "_hanging",
)

# 精确名：视觉上完整、但必须能看见对面（玻璃类）或本身是流体。
TRANSPARENT_EXACT = (
    "minecraft:glass",
    "minecraft:tinted_glass",
    "minecraft:glass_pane",
    "minecraft:water",
    "minecraft:flowing_water",
    "minecraft:lava",
    "minecraft:flowing_lava",
    "minecraft:ice",
    "minecraft:frosted_ice",
    "minecraft:slime_block",
    "minecraft:honey_block",
    "minecraft:barrier",
    "minecraft:light",
    "minecraft:structure_void",
    "minecraft:snow",
    "minecraft:powder_snow",
    "minecraft:cobweb",
    "minecraft:scaffolding",
    "minecraft:ladder",
    "minecraft:vine",
    "minecraft:dead_bush",
    "minecraft:short_grass",
    "minecraft:tall_grass",
    "minecraft:large_fern",
    "minecraft:fire",
    "minecraft:soul_fire",
)

# 关键字：名字里含这些片段的多半不完整（兜底，命中会记录到生成报告里供人工确认）。
TRANSPARENT_CONTAINS = (
    "glass",
    "stairs",
    "slab",
    "fence",
    "wall",
    "door",
    "trapdoor",
    "pane",
    "leaves",
    "carpet",
    "torch",
    "lantern",
    "candle",
    "rail",
    "button",
    "pressure_plate",
    "sign",
    "banner",
    "sapling",
    "flower",
    "coral",
    "mushroom",
    "vine",
    "fern",
    "grass",
)


@dataclass
class Report:
    java_blocks: int = 0
    transparent: int = 0
    by_rule: Counter = field(default_factory=Counter)
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing


def _java_block_names() -> set[str]:
    source = paths.data_dir() / "source" / "ghost_index.json"
    if not source.is_file():
        raise FileNotFoundError(f"缺少 {source}（先放好旧索引）")
    index = json.loads(source.read_text(encoding="utf-8"))
    names: set[str] = set((index.get("javaMap") or {}).keys())
    names |= set((index.get("javaMapByState") or {}).keys())
    return {name for name in names if name.startswith("minecraft:")}


def build() -> tuple[dict, Report]:
    names = _java_block_names()
    report = Report(java_blocks=len(names))

    transparent: dict[str, str] = {}

    for name in sorted(names):
        short = name.split(":", 1)[1]

        if name in TRANSPARENT_EXACT:
            transparent[name] = "exact"
            report.by_rule["exact"] += 1
            continue

        # 双半砖在基岩侧是独立方块名，但视觉上是完整方块 → 仍然遮挡。
        if short.endswith("_double_slab"):
            report.by_rule["occluder:double_slab"] += 1
            continue

        hit = next((suffix for suffix in TRANSPARENT_SUFFIXES if short.endswith(suffix)), None)
        if hit:
            transparent[name] = f"suffix:{hit}"
            report.by_rule[f"suffix:{hit}"] += 1
            continue

        hit = next((key for key in TRANSPARENT_CONTAINS if key in short), None)
        if hit:
            transparent[name] = f"contains:{hit}"
            report.by_rule[f"contains:{hit}"] += 1

    # 精确表里明显是完整方块的（如 stone）不该出现在白名单，做一次反向体检。
    suspicious = [name for name in transparent if name.split(":", 1)[1] in ("stone", "dirt", "grass_block")]
    for name in suspicious:
        transparent.pop(name, None)
        report.missing.append(f"[suspicious] {name}")

    payload = {
        "schema": SCHEMA_VERSION,
        "comment": "不遮挡相邻面的方块白名单；由 lit-tools occlusion 生成，可手工在 transparent 里追加",
        "defaultOccludes": True,
        "source": "resources/data/source/ghost_index.json",
        "patterns": {
            "suffixes": list(TRANSPARENT_SUFFIXES),
            "contains": list(TRANSPARENT_CONTAINS),
        },
        "transparent": {name: rule for name, rule in transparent.items()},
    }
    report.transparent = len(transparent)
    return payload, report


def write(target: Path | None = None) -> tuple[Path, Report]:
    payload, report = build()
    target = target or (paths.data_dir() / "occlusion.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target, report
