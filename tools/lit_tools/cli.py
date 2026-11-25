"""命令行入口：`python -m lit_tools <command>`。"""

from __future__ import annotations

import argparse
import sys

from . import addon, exportmap, fixture, mapping, mapgen, occlusion, paths, placemap, version


def _cmd_version(_: argparse.Namespace) -> int:
    header = version.read_header_version()
    print(f"Version.h      : {header}")
    print(f"xmake.lua      : {version.read_xmake_version()}")
    print(f"lip.toml       : {version.read_lip_version()}")
    print(f"CHANGELOG.md   : {version.read_changelog_version()}")
    errors = version.check()
    if errors:
        for err in errors:
            print(f"[x] {err}", file=sys.stderr)
        return 1
    print("[ok] 版本一致")
    return 0


def _cmd_addon(_: argparse.Namespace) -> int:
    report = addon.check()
    print(f"BP 方块定义 : {report.bp_blocks}")
    print(f"RP 贴图     : {report.rp_textures}")
    print(f"BP 版本     : {'.'.join(map(str, report.bp_version))}")
    print(f"RP 版本     : {'.'.join(map(str, report.rp_version))}")
    for warning in report.warnings:
        print(f"[!] {warning}")
    for err in report.errors[:50]:
        print(f"[x] {err}", file=sys.stderr)
    if len(report.errors) > 50:
        print(f"[x] ... 其余 {len(report.errors) - 50} 条省略", file=sys.stderr)
    if not report.ok:
        return 1
    print("[ok] BP/RP 一致")
    return 0


def _cmd_mapping(args: argparse.Namespace) -> int:
    target = mapping.write()
    try:
        shown = target.relative_to(paths.repo_root())
    except ValueError:
        shown = target
    print(f"[ok] 已生成 {shown}")
    return 0


def _cmd_mapgen(_: argparse.Namespace) -> int:
    try:
        target, report = mapgen.write()
    except (FileNotFoundError, ValueError) as exc:
        print(f"[x] {exc}", file=sys.stderr)
        return 1
    try:
        shown = target.relative_to(paths.repo_root())
    except ValueError:
        shown = target
    print(f"[ok] 已生成 {shown}")
    print(f"     方块条目 {report.blocks}（含状态树 {report.with_states}）")
    print(f"     叶子 {report.leaves}，覆盖深度 {sorted(report.depth_histogram)}")
    return 0


def _cmd_fixture(_: argparse.Namespace) -> int:
    litematic_path, expected_path, expected = fixture.write()
    for path in (litematic_path, expected_path):
        try:
            shown = path.relative_to(paths.repo_root())
        except ValueError:
            shown = path
        print(f"[ok] {shown}")
    print(f"     尺寸 {expected['size']}，非空气方块 {len(expected['blocks'])}，bits {expected['bits']}")
    return 0


def _cmd_occlusion(_: argparse.Namespace) -> int:
    target, report = occlusion.write()
    try:
        shown = target.relative_to(paths.repo_root())
    except ValueError:
        shown = target
    print(f"[ok] 已生成 {shown}")
    print(f"     Java 方块 {report.java_blocks} → 白名单 {report.transparent} 个")
    top = report.by_rule.most_common(6)
    print("     规则命中：" + "、".join(f"{rule}={count}" for rule, count in top))
    for item in report.missing[:10]:
        print(f"[!] {item}", file=sys.stderr)
    return 0


def _cmd_placemap(args: argparse.Namespace) -> int:
    return placemap.main(['--header', str(args.header)] if args.header else [])


def _cmd_exportmap(_: argparse.Namespace) -> int:
    target, report = exportmap.write()
    try:
        shown = target.relative_to(paths.repo_root())
    except ValueError:
        shown = target
    print(f"[ok] 已生成 {shown}")
    print(f"     基岩名条目 {report.names}｜状态对照 {report.state_maps}｜别名 {report.aliases}")
    print(f"     java_bedrock 补充 {report.from_java_bedrock}｜来源 {report.legacy or 'builtin'}")
    for warning in report.warnings:
        print(f"[!] {warning}", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lit_tools", description="LitematicaBE 离线工具链")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("version", help="校验 Version.h / lip.toml / CHANGELOG 版本一致").set_defaults(
        func=_cmd_version
    )
    sub.add_parser("addon", help="校验 BP/RP 的版本、identifier 与贴图引用").set_defaults(
        func=_cmd_addon
    )
    sub.add_parser("mapping", help="从 BP 生成 resources/data/generated/ghost_blocks.json").set_defaults(
        func=_cmd_mapping
    )
    sub.add_parser("mapgen", help="把 source/ghost_index.json 转成运行期 ghost_map.json 并校验").set_defaults(
        func=_cmd_mapgen
    )
    sub.add_parser("fixture", help="生成 tests/fixtures 下的最小 .litematic 解析测例").set_defaults(
        func=_cmd_fixture
    )
    p_place = sub.add_parser("placemap", help="生成放置用的方块名数据（bedrock_names / java_bedrock）")
    p_place.add_argument("--header", default=None, help="VanillaBlockTypeIds.h 路径")
    p_place.set_defaults(func=_cmd_placemap)
    sub.add_parser("occlusion", help="生成表面剔除用的遮挡白名单 resources/data/occlusion.json").set_defaults(
        func=_cmd_occlusion
    )
    sub.add_parser(
        "exportmap", help="生成导出 .litematic 用的基岩→Java 反查表 resources/data/export_map.json"
    ).set_defaults(func=_cmd_exportmap)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
