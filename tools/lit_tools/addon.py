"""BP/RP 校验。

校验的不是「格式合法」，而是三者是否还互相对得上：
  1. BP / RP 的 manifest 版本一致；
  2. `blocks/*.json` 的 identifier 唯一且都在 `lit:` 命名空间下；
  3. BP 里引用的贴图名都能在 RP 的 `terrain_texture.json` 里找到。

这三件事任一漂移，运行期表现都是「假方块显示成错块或紫黑格」，很难从日志反推，
所以必须在离线阶段拦住。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import paths

NAMESPACE = "lit:"


@dataclass
class AddonReport:
    bp_blocks: int = 0
    rp_textures: int = 0
    bp_version: list[int] = field(default_factory=list)
    rp_version: list[int] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _manifest_version(path: Path) -> list[int]:
    manifest = _load_json(path)
    header = manifest.get("header", {})
    version = header.get("version")
    if not isinstance(version, list):
        raise ValueError(f"{path} 的 header.version 不是数组")
    return list(version)


def _terrain_texture_path(rp: Path) -> Path:
    """terrain_texture.json 允许放资源包根或 textures/ 下，两种布局都认。"""
    for candidate in (rp / "terrain_texture.json", rp / "textures" / "terrain_texture.json"):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"{rp} 下找不到 terrain_texture.json")


def _rp_texture_names(rp: Path) -> set[str]:
    terrain = _load_json(_terrain_texture_path(rp))
    data = terrain.get("texture_data")
    if not isinstance(data, dict):
        raise ValueError(f"{_terrain_texture_path(rp)} 缺少 texture_data")
    return set(data.keys())


def check() -> AddonReport:
    report = AddonReport()
    bp, rp = paths.bp_dir(), paths.rp_dir()

    for label, base in (("BP", bp), ("RP", rp)):
        if not base.is_dir():
            report.errors.append(f"{label} 目录不存在：{base}")
    if report.errors:
        return report

    report.bp_version = _manifest_version(bp / "manifest.json")
    report.rp_version = _manifest_version(rp / "manifest.json")
    if report.bp_version != report.rp_version:
        report.errors.append(f"BP 版本 {report.bp_version} 与 RP 版本 {report.rp_version} 不一致")

    report.rp_textures = len(_rp_texture_names(rp))
    textures = _rp_texture_names(rp)

    seen: dict[str, str] = {}
    for json_path in sorted((bp / "blocks").glob("*.json")):
        report.bp_blocks += 1
        try:
            doc = _load_json(json_path)
        except json.JSONDecodeError as exc:
            report.errors.append(f"{json_path.name}：JSON 解析失败（{exc}）")
            continue

        block = doc.get("minecraft:block") or {}
        description = block.get("description") or {}
        identifier = description.get("identifier")
        if not identifier:
            report.errors.append(f"{json_path.name}：缺少 description.identifier")
            continue
        if not identifier.startswith(NAMESPACE):
            report.errors.append(f"{json_path.name}：identifier `{identifier}` 不在 {NAMESPACE} 命名空间下")
        if identifier in seen:
            report.errors.append(
                f"{json_path.name}：identifier `{identifier}` 与 {seen[identifier]} 重复"
            )
        seen[identifier] = json_path.name

        instances = (block.get("components") or {}).get("minecraft:material_instances") or {}
        for face, cfg in instances.items():
            texture = (cfg or {}).get("texture")
            if texture and texture not in textures:
                report.errors.append(
                    f"{json_path.name}：material_instances[{face}] 引用的贴图 `{texture}` 不在 terrain_texture.json"
                )

    unused = sorted(textures - _referenced_textures(bp))
    if unused:
        report.warnings.append(f"RP 里有 {len(unused)} 个贴图没有被任何方块引用（例：{unused[:3]}）")

    return report


def _referenced_textures(bp: Path) -> set[str]:
    used: set[str] = set()
    for json_path in (bp / "blocks").glob("*.json"):
        try:
            doc = _load_json(json_path)
        except json.JSONDecodeError:
            continue
        block = doc.get("minecraft:block") or {}
        instances = (block.get("components") or {}).get("minecraft:material_instances") or {}
        for cfg in instances.values():
            texture = (cfg or {}).get("texture")
            if texture:
                used.add(texture)
    return used
