"""仓库路径约定。所有工具都从这里取路径，避免脚本各自拼相对路径。"""

from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    """仓库根目录（tools/lit_tools/paths.py 上三级）。"""
    return Path(__file__).resolve().parents[2]


def src_dir() -> Path:
    return repo_root() / "src" / "LitematicaBE"


def resources_dir() -> Path:
    return repo_root() / "resources"


def addon_dir() -> Path:
    return resources_dir() / "addon"


def bp_dir() -> Path:
    return addon_dir() / "LitematicaBE_BP"


def rp_dir() -> Path:
    return addon_dir() / "LitematicaBE_RP"


def data_dir() -> Path:
    return resources_dir() / "data"


def lip_toml() -> Path:
    return repo_root() / "lip.toml"


def changelog() -> Path:
    return repo_root() / "CHANGELOG.md"
