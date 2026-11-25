"""exportmap — 生成 `resources/data/export_map.json`（基岩 → Java 反查表）。

导出 `.litematic` 需要把 BDS 里的方块（基岩口径）翻回 Java 口径：
名字要变成 Java 的注册名，状态名要变成 Java 的属性名（`facing_direction` → `facing`、
`pillar_axis` → `axis`、`weirdo_direction` → `facing` …）。

数据来源（**不手写**）：

* 旧项目 `src/mappings/BlockMappingRegistry.js`：约 880 条
  `"minecraft:<java>":{b:"<bedrock>", …, s:{<javaKey>:"<bedrockKey>"}}` 对照；
* `resources/data/java_bedrock.json`：Java 名与基岩注册名不同的那些（名字一致的不必列出）。

输出结构::

    {
      "schema": 1,
      "count": <条目数>,
      "blocks": {
        "<bedrock 裸名>": {
          "java": "minecraft:<java>",
          "states": {"<bedrockKey>": "<javaKey>", ...},
          "aliases": ["minecraft:<另一个 java 名>", ...]
        }
      }
    }

C++ 侧 `mapping::BedrockToJava` 只读 `blocks`；状态值域的翻译（0..5 → north/south/…）
在代码里，不在这张表里 —— 表只负责「键叫什么」。
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import paths

SCHEMA = 1

#: 旧项目位置：允许用环境变量覆盖（CI 上没有旧仓库时跳过状态对照）。
LEGACY_ENV = "LITEMATICABE_LEGACY"
DEFAULT_LEGACY = Path("D:/GitHub/LitematicaBE")

NAME_RE = re.compile(r'"minecraft:([a-z0-9_]+)"\s*:\s*\{\s*b\s*:\s*"([a-z0-9_:]+)"')
STATE_RE = re.compile(r'"minecraft:([a-z0-9_]+)"\s*:\s*\{[^{}]*?s\s*:\s*\{([^{}]*)\}')
KEYVAL_RE = re.compile(r'([a-z0-9_]+)\s*:\s*"([a-z0-9_:]+)"')


@dataclass
class Report:
    names: int = 0
    state_maps: int = 0
    aliases: int = 0
    from_java_bedrock: int = 0
    legacy: Path | None = None
    warnings: list[str] = field(default_factory=list)


def _legacy_path() -> Path | None:
    candidate = Path(os.environ.get(LEGACY_ENV, DEFAULT_LEGACY))
    registry = candidate / "src" / "mappings" / "BlockMappingRegistry.js"
    return registry if registry.is_file() else None


def _read_text(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="latin-1", errors="replace")


def _bare(name: str) -> str:
    return name.split(":", 1)[1] if ":" in name else name


def build() -> tuple[dict, Report]:
    report = Report()
    blocks: dict[str, dict] = {}

    registry = _legacy_path()
    report.legacy = registry
    if registry is None:
        report.warnings.append(
            f"未找到旧项目映射表（{os.environ.get(LEGACY_ENV, DEFAULT_LEGACY)}）；"
            "本次只用 java_bedrock.json + 内置规则"
        )
    else:
        text = _read_text(registry)
        for java_name, bedrock_name in NAME_RE.findall(text):
            bedrock = _bare(bedrock_name)
            entry = blocks.setdefault(bedrock, {"java": f"minecraft:{java_name}", "states": {}})
            if entry["java"] != f"minecraft:{java_name}":
                entry.setdefault("aliases", []).append(f"minecraft:{java_name}")
                report.aliases += 1
        report.names = len(blocks)

        for java_name, body in STATE_RE.findall(text):
            pairs = KEYVAL_RE.findall(body)
            if not pairs:
                continue
            target = None
            for bedrock, entry in blocks.items():
                if _bare(entry["java"]) == java_name:
                    target = entry
                    break
            if target is None:
                continue
            for java_key, bedrock_key in pairs:
                target["states"].setdefault(_bare(bedrock_key), java_key)
            report.state_maps += 1

    # java_bedrock.json：补「名字不同但旧表没覆盖」的条目
    java_bedrock = paths.data_dir() / "java_bedrock.json"
    if java_bedrock.is_file():
        data = json.loads(java_bedrock.read_text(encoding="utf-8"))
        for java_name, bedrock_name in (data.get("names") or {}).items():
            bedrock = _bare(bedrock_name)
            entry = blocks.setdefault(bedrock, {"java": f"minecraft:{_bare(java_name)}", "states": {}})
            if entry["java"] == f"minecraft:{_bare(java_name)}":
                report.from_java_bedrock += 1
            else:
                aliases = entry.setdefault("aliases", [])
                alias = f"minecraft:{_bare(java_name)}"
                if alias not in aliases:
                    aliases.append(alias)
                    report.aliases += 1

    # 空 states / 空 aliases 不落盘，文件更小也更好读
    for entry in blocks.values():
        if not entry.get("states"):
            entry.pop("states", None)
        if not entry.get("aliases"):
            entry.pop("aliases", None)

    payload = {
        "schema": SCHEMA,
        "source": str(registry) if registry else "builtin",
        "count": len(blocks),
        "blocks": dict(sorted(blocks.items())),
    }
    return payload, report


def write() -> tuple[Path, Report]:
    payload, report = build()
    target = paths.data_dir() / "export_map.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target, report
