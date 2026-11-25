"""版本一致性校验。

真源只有一个：`src/LitematicaBE/Version.h` 的 `kVersion`。
`lip.toml` 的 `version` 与 `CHANGELOG.md` 的最新条目必须与它一致。
"""

from __future__ import annotations

import re

from . import paths

_HEADER_RE = re.compile(r'kVersion\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+[^"]*)"')
_LIP_RE = re.compile(r'^version\s*=\s*"([^"]+)"', re.MULTILINE)
_CHANGELOG_RE = re.compile(r'^##\s*\[([0-9]+\.[0-9]+\.[0-9]+[^\]]*)\]', re.MULTILINE)
_XMAKE_RE = re.compile(r'modVersion\s*=\s*"([^"]+)"')


def read_header_version() -> str:
    text = (paths.src_dir() / "Version.h").read_text(encoding="utf-8")
    match = _HEADER_RE.search(text)
    if not match:
        raise ValueError("Version.h 里找不到 kVersion")
    return match.group(1)


def read_xmake_version() -> str:
    text = (paths.repo_root() / "xmake.lua").read_text(encoding="utf-8")
    match = _XMAKE_RE.search(text)
    if not match:
        raise ValueError("xmake.lua 里找不到 modVersion（modpacker 的 extraconf）")
    return match.group(1)


def read_lip_version() -> str:
    text = paths.lip_toml().read_text(encoding="utf-8")
    match = _LIP_RE.search(text)
    if not match:
        raise ValueError("lip.toml 里找不到 version")
    return match.group(1)


def read_changelog_version() -> str:
    text = paths.changelog().read_text(encoding="utf-8")
    match = _CHANGELOG_RE.search(text)
    if not match:
        raise ValueError("CHANGELOG.md 里找不到形如 `## [x.y.z]` 的版本条目")
    return match.group(1)


def check() -> list[str]:
    """返回不一致项；空列表表示一致。"""
    errors: list[str] = []
    try:
        header = read_header_version()
    except (OSError, ValueError) as exc:
        return [f"读取 Version.h 失败：{exc}"]

    for label, reader in (
        ("xmake.lua", read_xmake_version),
        ("lip.toml", read_lip_version),
        ("CHANGELOG.md", read_changelog_version),
    ):
        try:
            other = reader()
        except (OSError, ValueError) as exc:
            errors.append(f"读取 {label} 失败：{exc}")
            continue
        if other != header:
            errors.append(f"{label} 的版本 {other} 与 Version.h 的 {header} 不一致")
    return errors
