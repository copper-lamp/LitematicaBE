"""从 BP 生成假方块映射清单。

输出 `resources/data/generated/ghost_blocks.json`：C++ 映射层的输入。
只描述「有哪些方块、各自有哪些状态」，不含 Java→BE 的转换规则（那是 mapping 模块的事，
且规则要能独立演进）。
"""

from __future__ import annotations

import json
from pathlib import Path

from . import paths

SCHEMA_VERSION = 1


def _block_states(description: dict) -> dict:
    """把 BP 的 states 定义压成统一形状：{state_name: {"min": n, "max": m}} 或 {"values": [...]}"""
    states = description.get("states") or {}
    out: dict[str, dict] = {}
    for name, spec in states.items():
        if not isinstance(spec, dict):
            continue
        if "values" in spec and isinstance(spec["values"], list):
            out[name] = {"values": list(spec["values"])}
        else:
            entry = {}
            for key in ("min", "max"):
                if key in spec:
                    entry[key] = spec[key]
            out[name] = entry
    return out


def build() -> dict:
    blocks_dir = paths.bp_dir() / "blocks"
    if not blocks_dir.is_dir():
        raise FileNotFoundError(f"找不到方块定义目录：{blocks_dir}")

    entries = []
    for json_path in sorted(blocks_dir.glob("*.json")):
        doc = json.loads(json_path.read_text(encoding="utf-8-sig"))
        block = doc.get("minecraft:block") or {}
        description = block.get("description") or {}
        identifier = description.get("identifier")
        if not identifier:
            continue
        entries.append(
            {
                "identifier": identifier,
                "file": json_path.name,
                "states": _block_states(description),
            }
        )

    return {
        "schema": SCHEMA_VERSION,
        "source": "resources/addon/LitematicaBE_BP/blocks",
        "count": len(entries),
        "blocks": entries,
    }


def write(target: Path | None = None) -> Path:
    target = target or (paths.data_dir() / "generated" / "ghost_blocks.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target
