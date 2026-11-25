#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace litematicabe::ghost {

// 一条假方块改动。字段与 HologramLib 的 `holo_block_change`（`core/c_api.h`）逐字节一致；
// 布局变了会在编译期被 static_assert 拦住，而不是运行期发出错包。
struct HoloBlockChange {
    std::int32_t  x{};
    std::int32_t  y{};
    std::int32_t  z{};
    std::uint32_t runtimeId{};
    std::uint32_t flags{};
    std::uint64_t syncEntity{};
    std::uint32_t syncMessage{};
};

static_assert(sizeof(HoloBlockChange) == 40, "layout must match holo_block_change");
static_assert(offsetof(HoloBlockChange, runtimeId) == 12, "runtime_id offset must match");
static_assert(offsetof(HoloBlockChange, flags) == 16, "flags offset must match");
static_assert(offsetof(HoloBlockChange, syncEntity) == 24, "sync_entity offset must match");

// 一条已编码的包体（不含包头）。包头由 PacketSender 拼。
struct EncodedPacket {
    std::uint32_t packetId{};
    std::string   body;
};

// 把「一堆方块改动」编码成若干 `UpdateSubchunkBlocks` 包体。
//
// 编码本身交给 HologramLib 的 C ABI（`holo_core_encode_update_subchunk_blocks`，符号在`HologramLib.dll` 的导出表里，链接期已就绪），本类只负责：
//   1. 按 16³ 子区块分组（协议要求一包只覆盖一个子区块）；
//   2. 单包不超过 1024 条改动（库侧与协议侧的硬约束）；
//   3. 分配/释放库返回的 body。
//
// 公开头文件的 `IViewOverride` 只有逐格接口，库内的 `BlockBatchManager` 未导出，
// 所以批量必须走这条 C ABI 路线。
class BatchEncoder {
public:
    // 库侧 `update_flags`：邻居重算 + 服务端权威（假方块不能用 NoGraphic）。
    static constexpr std::uint32_t kUpdateFlags = 0x01 | 0x02;
    // 单包改动上限。
    static constexpr std::size_t kMaxChangesPerPacket = 1024;

    static BatchEncoder& getInstance();

    // 库的批量编码器是否可用（构建时编入 + 运行期 DLL 导出存在）。
    [[nodiscard]] bool available();

    // 按子区块分组并编码；可直接把 outPackets 交给 PacketSender。
    // @return 成功编码的包数；0 表示不可用或没有有效改动。
    std::size_t encode(std::vector<HoloBlockChange> const& changes, std::vector<EncodedPacket>& outPackets);

    // 单子区块编码（不做分组，调试/对拍用）。
    // @param subX/subY/subZ 子区块原点的方块坐标（即 x & ~15）。
    bool encodeSubchunk(
        std::int32_t                        subX,
        std::int32_t                        subY,
        std::int32_t                        subZ,
        std::vector<HoloBlockChange> const& changes,
        std::string&                        outBody
    );

    [[nodiscard]] std::uint32_t packetId();

    struct Stats {
        std::uint64_t changes{};
        std::uint64_t packets{};
        std::uint64_t bytes{};
        std::uint64_t failed{};
        std::uint64_t skipped{};
    };

    [[nodiscard]] Stats stats() const { return mStats; }

private:
    BatchEncoder() = default;

    Stats mStats{};
};

} // namespace litematicabe::ghost
