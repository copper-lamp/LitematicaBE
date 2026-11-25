"""把旧的 ``ghost_index.json`` 转成运行期映射表 ``ghost_map.json``，并做一致性校验。

为什么要转：

* 旧表是 3.x（LSE JS）时代的产物，``javaMap`` 与 ``javaMapByState`` 两套入口、``_default`` 回退；
* 新实现要能「一个方块一个条目」地维护，同时允许两件旧表没有的能力：
  - ``{state}`` 模板：``"ghost": "lit:g_piston_side_f{facing_direction}"``，少写一堆重复条目；
  - ``set``：给 ghost 追加/覆盖状态键（例如将来某个 ghost 用 ``lit:dir`` 表达朝向）。
* 转换是一次性的，运行期只读 ``ghost_map.json``；因此这里不做任何「运行时猜测」，
  所有不合法的 ghost 名都必须在生成阶段被拦下。

输出结构（schema 1）::

    {
      "schema": 1,
      "default": "lit:g_generic",
      "blocks": {
        "minecraft:stone": {"ghost": "lit:g_stone"},
        "minecraft:piston": {
          "states": {
            "extended_bit": {
              "0": {"states": {"facing_direction": {"0": {"ghost": "..."}, "_default": {"ghost": "..."}}}},
              "1": {"ghost": "..."}
            }
          },
          "default": "lit:g_piston_side_f1"
        }
      }
    }
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from . import paths

SCHEMA_VERSION = 1
DEFAULT_GHOST = "lit:g_generic"


@dataclass
class Report:
    blocks: int = 0
    with_states: int = 0
    leaves: int = 0
    max_depth: int = 0
    missing_ghosts: list[tuple[str, str]] = field(default_factory=list)
    depth_histogram: Counter = field(default_factory=Counter)

    @property
    def ok(self) -> bool:
        return not self.missing_ghosts


def _ghost_ids() -> set[str]:
    """从 BP 读出全部 ghost 方块 identifier（运行期只能引用这些名字）。"""
    ids: set[str] = set()
    for json_path in sorted((paths.bp_dir() / "blocks").glob("*.json")):
        doc = json.loads(json_path.read_text(encoding="utf-8-sig"))
        identifier = (doc.get("minecraft:block") or {}).get("description", {}).get("identifier")
        if identifier:
            ids.add(identifier)
    return ids


def _normalise_tree(node, report: Report, depth: int = 0):
    """把「状态值 → ghost 名 / 子树」的树规范化成 schema 1 的形状。"""
    report.max_depth = max(report.max_depth, depth)
    if isinstance(node, str):
        report.leaves += 1
        return {"ghost": node}
    if not isinstance(node, dict):
        return None

    out: dict = {}
    for key, value in node.items():
        # `_default`（旧表）与 `default`（新表）都是同层兜底，统一成 `_default`。
        if key in ("_default", "default"):
            normalised = _normalise_tree(value, report, depth + 1)
            if normalised is not None:
                out["_default"] = normalised
            continue
        normalised = _normalise_tree(value, report, depth + 1)
        if normalised is not None:
            out[str(key)] = normalised
    return out


def build() -> tuple[dict, Report]:
    source = paths.data_dir() / "source" / "ghost_index.json"
    if not source.is_file():
        raise FileNotFoundError(f"缺少转换输入：{source}")

    index = json.loads(source.read_text(encoding="utf-8"))
    report = Report()

    blocks: dict[str, dict] = {}

    # 1. 方块级映射（无状态）→ {"ghost": ...}
    for java_name, ghost in (index.get("javaMap") or {}).items():
        blocks[java_name] = {"ghost": ghost}

    # 2. 状态树映射 → {"states": {...}, "default": javaMap[java] 或树内 _default}
    for java_name, tree in (index.get("javaMapByState") or {}).items():
        entry = blocks.setdefault(java_name, {})
        normalised = _normalise_tree(tree, report)
        if normalised:
            entry["states"] = normalised
            report.with_states += 1
            report.depth_histogram[report.max_depth] += 1
        if "ghost" not in entry:
            fallback = (index.get("javaMap") or {}).get(java_name)
            if fallback:
                entry["default"] = fallback

    report.blocks = len(blocks)

    # 3. 校验：所有 ghost 名必须是 BP 里真实存在的 identifier
    ghosts = _ghost_ids()

    def walk(node, java_name: str) -> None:
        if not isinstance(node, dict):
            return
        ghost = node.get("ghost")
        if isinstance(ghost, str):
            # 模板占位（{state}）无法静态展开，只校验静态名字
            if "{" not in ghost and ghost not in ghosts:
                report.missing_ghosts.append((java_name, ghost))
        for value in node.values():
            walk(value, java_name)

    for java_name, entry in blocks.items():
        walk(entry, java_name)
        default = entry.get("default")
        if isinstance(default, str) and "{" not in default and default not in ghosts:
            report.missing_ghosts.append((java_name, default))

    payload = {
        "schema": SCHEMA_VERSION,
        "source": "resources/data/source/ghost_index.json",
        "default": index.get("genericId") or DEFAULT_GHOST,
        "blocks": blocks,
    }
    return payload, report


def write(target: Path | None = None) -> tuple[Path, Report]:
    payload, report = build()
    if not report.ok:
        sample = report.missing_ghosts[:10]
        raise ValueError(f"{len(report.missing_ghosts)} 个 ghost 名不在 BP 里，例：{sample}")

    target = target or (paths.data_dir() / "ghost_map.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return target, report
