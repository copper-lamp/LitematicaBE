"""生成用于解析器回归的最小 ``.litematic`` 测例（不依赖 Minecraft 或 Litematica）。

为什么要自己造：

* 解析器（NBT + 位解包）最容易错在「跨 long 边界」和「小端」两处，
  这两处一旦错了，之后每个功能都会带着错位数据跑，很难从日志反推；
* 仓库里不适合放大体积的投影文件，所以测例是脚本合成的，
  同时输出 ``.expected.json``（期望的方块列表），供 C++ 侧对拍。

用法::

    python -m lit_tools fixture          # 写入 tests/fixtures/
"""

from __future__ import annotations

import gzip
import json
import struct
from pathlib import Path

from . import paths

# NBT tag ids
TAG_BYTE = 1
TAG_SHORT = 2
TAG_INT = 3
TAG_LONG = 4
TAG_FLOAT = 5
TAG_DOUBLE = 6
TAG_BYTE_ARRAY = 7
TAG_STRING = 8
TAG_LIST = 9
TAG_COMPOUND = 10
TAG_INT_ARRAY = 11
TAG_LONG_ARRAY = 12

AIR = "minecraft:air"
STONE = "minecraft:stone"
GLASS = "minecraft:glass"
STAIRS = "minecraft:oak_stairs"


def _name(text: str) -> bytes:
    raw = text.encode("utf-8")
    return struct.pack(">H", len(raw)) + raw


def _tag(name: str, tag_id: int, payload: bytes) -> bytes:
    return bytes([tag_id]) + _name(name) + payload


def nbt_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    return struct.pack(">H", len(raw)) + raw


def nbt_int(value: int) -> bytes:
    return struct.pack(">i", value)


def nbt_compound(entries: list[tuple[str, int, bytes]]) -> bytes:
    out = b"".join(_tag(name, tag_id, payload) for name, tag_id, payload in entries)
    return out + b"\x00"


def nbt_list(item_type: int, payloads: list[bytes]) -> bytes:
    return bytes([item_type]) + struct.pack(">i", len(payloads)) + b"".join(payloads)


def nbt_long_array(values: list[int]) -> bytes:
    out = struct.pack(">i", len(values))
    for value in values:
        out += struct.pack(">Q", value & 0xFFFFFFFFFFFFFFFF)
    return out


def pack_indices(indices: list[int], bits: int) -> list[int]:
    """Litematica 的位打包：连续 bit 流、LSB first、可跨 long（NBT 本身是大端） 边界。"""
    longs: list[int] = []
    acc = 0
    acc_bits = 0
    for index in indices:
        acc |= (index & ((1 << bits) - 1)) << acc_bits
        acc_bits += bits
        while acc_bits >= 64:
            longs.append(acc & ((1 << 64) - 1))
            acc >>= 64
            acc_bits -= 64
    if acc_bits > 0:
        longs.append(acc & ((1 << 64) - 1))
    return longs


def build_fixture() -> tuple[bytes, dict, dict]:
    """3×2×3 的立方体：多数石头，一层玻璃，两根楼梯，若干空气。"""
    size = (3, 2, 3)
    palette = [
        {"Name": AIR},
        {"Name": STONE},
        {"Name": GLASS},
        {"Name": STAIRS, "Properties": {"facing": "east", "half": "bottom", "shape": "straight"}},
    ]

    blocks: list[tuple[int, int, int, str, dict]] = []
    indices: list[int] = []

    for y in range(size[1]):
        for z in range(size[2]):
            for x in range(size[0]):
                if y == 1:
                    if (x + z) % 2 == 0:
                        pi, name, props = 2, GLASS, {}
                    else:
                        pi, name, props = 1, STONE, {}
                elif x == 1 and z == 1:
                    pi, name, props = 3, STAIRS, {"facing": "east", "half": "bottom", "shape": "straight"}
                elif x == 2 and z == 0:
                    pi, name, props = 3, STAIRS, {"facing": "east", "half": "bottom", "shape": "straight"}
                elif x == 0 and z == 0:
                    pi, name, props = 0, AIR, {}
                else:
                    pi, name, props = 1, STONE, {}
                indices.append(pi)
                if pi != 0:
                    blocks.append((x, y, z, name, props))

    bits = 2
    while (1 << bits) < len(palette):
        bits += 1

    longs = pack_indices(indices, bits)

    palette_payloads = []
    for entry in palette:
        fields: list[tuple[str, int, bytes]] = [("Name", TAG_STRING, nbt_string(entry["Name"]))]
        if "Properties" in entry:
            props = [
                (key, TAG_STRING, nbt_string(value)) for key, value in sorted(entry["Properties"].items())
            ]
            fields.append(("Properties", TAG_COMPOUND, nbt_compound(props)))
        palette_payloads.append(nbt_compound(fields))

    region = nbt_compound(
        [
            (
                "Position",
                TAG_COMPOUND,
                nbt_compound(
                    [("x", TAG_INT, nbt_int(0)), ("y", TAG_INT, nbt_int(64)), ("z", TAG_INT, nbt_int(0))]
                ),
            ),
            (
                "Size",
                TAG_COMPOUND,
                nbt_compound(
                    [
                        ("x", TAG_INT, nbt_int(size[0])),
                        ("y", TAG_INT, nbt_int(size[1])),
                        ("z", TAG_INT, nbt_int(size[2])),
                    ]
                ),
            ),
            ("BlockStatePalette", TAG_LIST, nbt_list(TAG_COMPOUND, palette_payloads)),
            ("BlockStates", TAG_LONG_ARRAY, nbt_long_array(longs)),
            ("TileEntities", TAG_LIST, nbt_list(0, [])),
            ("Entities", TAG_LIST, nbt_list(0, [])),
        ]
    )

    metadata = nbt_compound(
        [
            ("Name", TAG_STRING, nbt_string("LitematicaBE fixture")),
            ("Author", TAG_STRING, nbt_string("lit-tools")),
            ("Description", TAG_STRING, nbt_string("parser regression fixture")),
            (
                "EnclosingSize",
                TAG_COMPOUND,
                nbt_compound(
                    [
                        ("x", TAG_INT, nbt_int(size[0])),
                        ("y", TAG_INT, nbt_int(size[1])),
                        ("z", TAG_INT, nbt_int(size[2])),
                    ]
                ),
            ),
            ("RegionCount", TAG_INT, nbt_int(1)),
            ("TotalBlocks", TAG_INT, nbt_int(len(blocks))),
            ("TotalVolume", TAG_INT, nbt_int(size[0] * size[1] * size[2])),
        ]
    )

    root_payload = nbt_compound(
        [
            ("Version", TAG_INT, nbt_int(6)),
            ("MinecraftDataVersion", TAG_INT, nbt_int(3955)),
            ("Metadata", TAG_COMPOUND, metadata),
            ("Regions", TAG_COMPOUND, nbt_compound([("main", TAG_COMPOUND, region)])),
        ]
    )
    raw = bytes([TAG_COMPOUND]) + _name("") + root_payload

    expected = {
        "size": list(size),
        "palette": [entry["Name"] for entry in palette],
        "bits": bits,
        "longs": len(longs),
        "blocks": [
            {"x": x, "y": y, "z": z, "name": name, "properties": props} for x, y, z, name, props in blocks
        ],
    }
    return gzip.compress(raw, mtime=0), expected, {
        "region": "main",
        "position": [0, 64, 0],
        "size": list(size),
    }


def write(target_dir: Path | None = None) -> tuple[Path, Path, dict]:
    target_dir = target_dir or (paths.repo_root() / "tests" / "fixtures")
    target_dir.mkdir(parents=True, exist_ok=True)

    payload, expected, region = build_fixture()
    litematic_path = target_dir / "mini.litematic"
    expected_path = target_dir / "mini.expected.json"

    litematic_path.write_bytes(payload)
    expected_path.write_text(
        json.dumps({**region, **expected}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return litematic_path, expected_path, expected
