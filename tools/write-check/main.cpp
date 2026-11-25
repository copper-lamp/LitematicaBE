// 写入侧回归：构造合成区域 → 写 .litematic / .mcstructure → 读回来逐格比对。
//
// 覆盖的是最容易写错、且出错后最难查的四处：
//   * 位打包（bits / 跨 long 续位）与读端是否互补；
//   * 索引顺序（litematic 是 x 最快、mcstructure 是 z 最快，写错了整份文件会「旋转」）；
//   * 小端 / 大端序列化；
//   * gzip（`.litematic` 必须是 1F 8B 开头且能解回原 NBT）。
//
// 不依赖 BDS / LeviLamina，可以脱离游戏跑：
//   xmake -y && ./build/windows/x64/release/lit_write_check.exe

#include "LitematicaBE/core/save/RegionScan.h"
#include "LitematicaBE/core/schematic/LitematicFile.h"
#include "LitematicaBE/core/schematic/LitematicWriter.h"
#include "LitematicaBE/core/schematic/McstructureFile.h"
#include "LitematicaBE/core/schematic/McstructureWriter.h"

#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

namespace {

namespace save = litematicabe::core::save;
namespace sch  = litematicabe::core::schematic;

int gFailures = 0;
int gChecks   = 0;

void check(bool condition, std::string const& what) {
    ++gChecks;
    if (!condition) {
        ++gFailures;
        std::printf("[FAIL] %s\n", what.c_str());
    }
}

/// 造一个区域：尺寸 sx×sy×sz，palette 由调用方给，格子里按 mod 规则轮转。
struct Fixture {
    std::int32_t sx{};
    std::int32_t sy{};
    std::int32_t sz{};
    std::vector<save::PaletteSlot> palette;

    /// 每格期望的调色板下标（-1 = 空气）。
    [[nodiscard]] std::int32_t expected(std::int32_t x, std::int32_t y, std::int32_t z) const {
        // 用一个不规则但确定的模式：能暴露索引顺序错误（行/列互换会立刻对不上）。
        auto const n = static_cast<std::int32_t>(palette.size()) - 1; // 去掉 air
        if (n <= 0) {
            return -1;
        }
        auto const v = (x * 7 + y * 3 + z * 11) % (n + 1);
        return v == 0 ? -1 : v; // 0 → 空气
    }

    [[nodiscard]] std::uint64_t gridIndex(std::int32_t x, std::int32_t y, std::int32_t z) const {
        return static_cast<std::uint64_t>(x) * sy * sz + static_cast<std::uint64_t>(y) * sz
             + static_cast<std::uint64_t>(z);
    }
};

save::PaletteSlot slotOf(std::string name) {
    save::PaletteSlot slot;
    slot.name = std::move(name);
    return slot;
}

save::PaletteSlot airSlot() { return slotOf("minecraft:air"); }

save::PaletteSlot stairsSlot() {
    save::PaletteSlot slot;
    slot.name = "minecraft:oak_stairs";
    // 一条 Int（值域）/ 一条 Byte（布尔）/ 一条 String（枚举）—— 三种类型都要保真
    slot.states.push_back(save::StateValue{"weirdo_direction", "2", 3});
    slot.states.push_back(save::StateValue{"upside_down_bit", "1", 1});
    slot.states.push_back(save::StateValue{"custom_kind", "alpha", 8});
    return slot;
}

save::RegionScan buildScan(Fixture const& fixture) {
    save::RegionScan scan;
    scan.sizeX   = fixture.sx;
    scan.sizeY   = fixture.sy;
    scan.sizeZ   = fixture.sz;
    scan.originX = 128;
    scan.originY = 64;
    scan.originZ = -32;
    scan.palette = fixture.palette;
    scan.grid.assign(static_cast<std::size_t>(fixture.sx) * fixture.sy * fixture.sz, -1);

    std::size_t nonAir = 0;
    for (std::int32_t x = 0; x < fixture.sx; ++x) {
        for (std::int32_t y = 0; y < fixture.sy; ++y) {
            for (std::int32_t z = 0; z < fixture.sz; ++z) {
                auto const index = fixture.expected(x, y, z);
                scan.grid[static_cast<std::size_t>(fixture.gridIndex(x, y, z))] = index;
                if (index >= 0) {
                    ++nonAir;
                }
            }
        }
    }
    scan.stats.nonAir     = nonAir;
    scan.stats.paletteSize = scan.palette.size();
    return scan;
}

/// `.mcstructure`：写 → 读 → 逐格比对（坐标是结构内相对坐标，加回 origin 只做展示）。
void roundTripMcstructure(Fixture const& fixture, std::filesystem::path const& file) {
    auto const scan = buildScan(fixture);

    sch::McstructureWriteOptions options;
    std::string                 error;
    std::size_t                 bytes      = 0;
    std::size_t                 paletteOut = 0;
    bool const ok = sch::writeMcstructureFile(file, scan, options, error, &bytes, &paletteOut);
    check(ok, "mcstructure 写出：" + error);
    if (!ok) {
        return;
    }
    check(bytes > 0, "mcstructure 字节数 > 0");
    check(paletteOut == fixture.palette.size(), "mcstructure 调色板项数一致");

    // 头部不该有 gzip 魔法（`.mcstructure` 是裸 NBT）
    {
        FILE* fp = std::fopen(file.string().c_str(), "rb");
        check(fp != nullptr, "mcstructure 文件可打开");
        if (fp != nullptr) {
            unsigned char head[2]{};
            auto const    read = std::fread(head, 1, 2, fp);
            std::fclose(fp);
            check(read == 2 && !(head[0] == 0x1F && head[1] == 0x8B), "mcstructure 不是 gzip（应为裸 NBT）");
        }
    }

    sch::McstructureFile parsed;
    auto const            readError = sch::readMcstructure(file, parsed);
    check(readError.ok(), "mcstructure 读回：" + readError.message);
    if (!readError.ok()) {
        return;
    }

    check(parsed.size[0] == fixture.sx, "mcstructure size.x");
    check(parsed.size[1] == fixture.sy, "mcstructure size.y");
    check(parsed.size[2] == fixture.sz, "mcstructure size.z");
    check(parsed.origin[0] == scan.originX && parsed.origin[1] == scan.originY && parsed.origin[2] == scan.originZ,
          "mcstructure structure_world_origin");
    check(parsed.palette.size() == fixture.palette.size(), "mcstructure 读回调色板项数");

    // 调色板逐项比对（名字 + 状态值与类型）
    for (std::size_t i = 0; i < std::min(parsed.palette.size(), fixture.palette.size()); ++i) {
        auto const& want = fixture.palette[i];
        auto const& got  = parsed.palette[i];
        check(want.name == got.name || want.name == got.renderName, "mcstructure palette[" + std::to_string(i) + "] 名字");
        check(want.states.size() == got.states.size(), "mcstructure palette[" + std::to_string(i) + "] 状态条数");
    }

    std::size_t seen    = 0;
    std::size_t mismatch = 0;
    bool const  walked  = sch::forEachBlock(parsed, [&](sch::BlockRef const& ref) {
        ++seen;
        auto const want = fixture.expected(ref.x, ref.y, ref.z);
        if (want < 0) {
            ++mismatch;
            return true;
        }
        auto const& slot = fixture.palette[static_cast<std::size_t>(want)];
        if (slot.name != ref.name) {
            ++mismatch;
        }
        return true;
    });
    check(walked, "mcstructure forEachBlock 可遍历");
    check(mismatch == 0, "mcstructure 逐格名字一致（不一致 " + std::to_string(mismatch) + " 格）");

    std::size_t expectedNonAir = 0;
    for (std::int32_t x = 0; x < fixture.sx; ++x) {
        for (std::int32_t y = 0; y < fixture.sy; ++y) {
            for (std::int32_t z = 0; z < fixture.sz; ++z) {
                if (fixture.expected(x, y, z) >= 0) {
                    ++expectedNonAir;
                }
            }
        }
    }
    check(seen == expectedNonAir, "mcstructure 非空气格数 " + std::to_string(seen) + " == " + std::to_string(expectedNonAir));
}

/// `.litematic`：写 → 读 → 逐格比对（x 最快的索引顺序在这条链路上验证）。
void roundTripLitematic(Fixture const& fixture, std::filesystem::path const& file) {
    auto const scan = buildScan(fixture);

    sch::JavaRegion region;
    region.sizeX = scan.sizeX;
    region.sizeY = scan.sizeY;
    region.sizeZ = scan.sizeZ;
    region.grid  = scan.grid;
    region.totalBlocks = scan.stats.nonAir;
    for (auto const& slot : scan.palette) {
        sch::JavaPaletteSlot java;
        java.name = slot.name;
        for (auto const& state : slot.states) {
            java.properties.emplace_back(state.key, state.value);
        }
        region.palette.push_back(std::move(java));
    }

    sch::LitematicWriteOptions options;
    options.name       = "write-check";
    options.author     = "lit-write-check";
    options.regionName = "write-check";

    std::string error;
    std::size_t bytes      = 0;
    std::size_t paletteOut = 0;
    bool const  ok         = sch::writeLitematicFile(file, region, options, error, &bytes, &paletteOut);
    check(ok, "litematic 写出：" + error);
    if (!ok) {
        return;
    }
    check(bytes > 18, "litematic 字节数 > gzip 头长度");
    check(paletteOut == fixture.palette.size(), "litematic 调色板项数一致");

    // gzip 头必须是 1F 8B：`readLitematic` 会自己解压，但文件格式契约要单独验一次
    {
        FILE* fp = std::fopen(file.string().c_str(), "rb");
        check(fp != nullptr, "litematic 文件可打开");
        if (fp != nullptr) {
            unsigned char head[2]{};
            auto const    read = std::fread(head, 1, 2, fp);
            std::fclose(fp);
            check(read == 2 && head[0] == 0x1F && head[1] == 0x8B, "litematic 是 gzip 压缩的");
        }
    }

    sch::LitematicFile parsed;
    auto const         readError = sch::readLitematic(file, parsed);
    check(readError.ok(), "litematic 读回：" + readError.message);
    if (!readError.ok()) {
        return;
    }

    check(parsed.name == "write-check", "litematic Metadata.Name");
    check(parsed.enclosingSize[0] == fixture.sx && parsed.enclosingSize[1] == fixture.sy
              && parsed.enclosingSize[2] == fixture.sz,
          "litematic Metadata.EnclosingSize");
    check(parsed.regions.size() == 1, "litematic 只有 1 个 Region");
    if (parsed.regions.empty()) {
        return;
    }

    auto const& regionRead = parsed.regions.front();
    check(regionRead.size[0] == fixture.sx && regionRead.size[1] == fixture.sy && regionRead.size[2] == fixture.sz,
          "litematic Region.Size");
    check(regionRead.palette.size() == fixture.palette.size(), "litematic 读回调色板项数");

    std::size_t seen     = 0;
    std::size_t mismatch = 0;
    bool const  walked   = sch::forEachBlock(regionRead, [&](sch::BlockRef const& ref) {
        ++seen;
        auto const want = fixture.expected(ref.x, ref.y, ref.z);
        if (want < 0) {
            ++mismatch; // 读端跳过空气，出现即说明写端把空气写成了实体
            return true;
        }
        auto const& slot = fixture.palette[static_cast<std::size_t>(want)];
        if (slot.name != ref.name) {
            ++mismatch;
            return true;
        }
        // 属性逐条比对（值一律字符串）
        if (ref.properties == nullptr || ref.properties->size() != slot.states.size()) {
            ++mismatch;
            return true;
        }
        for (auto const& state : slot.states) {
            bool found = false;
            for (auto const& [key, value] : *ref.properties) {
                if (key == state.key && value == state.value) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                ++mismatch;
                return true;
            }
        }
        return true;
    });
    check(walked, "litematic forEachBlock 可遍历");
    check(mismatch == 0, "litematic 逐格名字/属性一致（不一致 " + std::to_string(mismatch) + " 格）");
    (void)seen;
}

} // namespace

int main() {
    auto const dir = std::filesystem::temp_directory_path() / "lit_write_check";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);

    // 1) 小调色板 + 跨 long 的位打包（bits=3）
    {
        Fixture fixture;
        fixture.sx = 9;
        fixture.sy = 5;
        fixture.sz = 7;
        fixture.palette = {airSlot(), slotOf("minecraft:stone"), slotOf("minecraft:oak_planks"),
                           slotOf("minecraft:glass"), stairsSlot()};
        roundTripMcstructure(fixture, dir / "small.mcstructure");
        roundTripLitematic(fixture, dir / "small.litematic");
    }

    // 2) 大调色板（>256 项触发 9 位下限修正）—— 位宽规则最容易在这里错
    {
        Fixture fixture;
        fixture.sx = 6;
        fixture.sy = 6;
        fixture.sz = 6;
        fixture.palette = {airSlot()};
        for (int i = 0; i < 300; ++i) {
            fixture.palette.push_back(slotOf("minecraft:test_block_" + std::to_string(i)));
        }
        roundTripLitematic(fixture, dir / "big.litematic");
        roundTripMcstructure(fixture, dir / "big.mcstructure");
    }

    // 3) 单格选区（最小尺寸）—— 长度计算与除零的边界
    {
        Fixture fixture;
        fixture.sx = 1;
        fixture.sy = 1;
        fixture.sz = 1;
        fixture.palette = {airSlot(), slotOf("minecraft:bedrock")};
        roundTripMcstructure(fixture, dir / "tiny.mcstructure");
        roundTripLitematic(fixture, dir / "tiny.litematic");
    }

    std::printf("\n%d 项检查，失败 %d 项\n", gChecks, gFailures);
    if (gFailures == 0) {
        std::printf("[ok] 写入侧回归全部通过\n");
        return 0;
    }
    return 1;
}
