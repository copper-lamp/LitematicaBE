#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace litematicabe::hologram {

// 显示通道的三种形态，按能力从弱到强排。
enum class DisplayPath {
    // 前置缺失或未加载：只能解析/命令，不能显示。
    None,
    // 只有公开 C++ 头文件里的逐格 `IViewOverride`：小投影与单格修补可用。
    PerCellOverride,
    // 拿到了批量编码器：可自组 `UpdateSubchunkBlocks` 批量发包。
    BatchEncoder,
};

[[nodiscard]] std::string_view toString(DisplayPath path) noexcept;

// 批量编码器的一组函数指针。
//
// 这些是 HologramLib 的 C ABI（`core/c_api.h`），但**不在** `HologramLib.lib` 的导入库里
// （该导入库只导出了 `holo_core_packet_id_update_subchunk_blocks` 等少数符号）。
// 因此运行期按下面的顺序解析：
//   1. `HologramLib.dll` 的导出表（若前置把编码器一并导出）；
//   2. 进程内已加载的 `holo_core.dll`；
//   3. 本插件目录下的 `holo_core.dll`；
//   4. `plugins/HologramLib/holo_core.dll`；
//   5. 系统搜索路径上的 `holo_core.dll`。
// 全都没有时 `BatchEncoder` 为空，批量通道降级为逐格。
struct BatchApi {
    using PacketIdFn = std::uint32_t (*)();
    using EncodeFn   = std::int32_t (*)(
        std::int32_t,
        std::int32_t,
        std::int32_t,
        void const*,
        std::size_t,
        std::uint8_t**,
        std::size_t*
    );
    using FreeFn = void (*)(void*);

    PacketIdFn packetId{};
    EncodeFn   encode{};
    FreeFn     free{};

    [[nodiscard]] bool complete() const noexcept {
        return packetId != nullptr && encode != nullptr && free != nullptr;
    }
};

// HologramLib 前置的接入点。
//
// 链接方式为编译期直链（见 xmake.lua），因此运行期要求 HologramLib 插件已在同一进程内加载。
// 能力探测分两级：
//   1. 编译期：构建时是否带上了头文件与导入库（`LITEMATICABE_WITH_HOLOGRAMLIB`）；
//   2. 运行期：前置 DLL 是否在位，以及能否解析到批量编码器。
class HologramFacade {
public:
    static HologramFacade& getInstance();

    // 构建时是否带上了 HologramLib 的头文件与导入库。
    [[nodiscard]] static constexpr bool compiledWithHologramLib() noexcept {
#if defined(LITEMATICABE_WITH_HOLOGRAMLIB)
        return LITEMATICABE_WITH_HOLOGRAMLIB != 0;
#else
        return false;
#endif
    }

    // 探测并缓存前置能力（进程内只需要一次）。
    DisplayPath probe();

    // 已探测到的能力；未探测时返回 None。
    [[nodiscard]] DisplayPath path() const noexcept { return mPath; }

    // 批量编码器函数表（未探测时先 probe）。
    [[nodiscard]] BatchApi const& batchApi();

    // 批量编码器是否可用。
    [[nodiscard]] bool hasBatchEncoder();

    // 编码器来自哪个模块（诊断用："HologramLib.dll" / "holo_core.dll" / "none"）。
    [[nodiscard]] std::string_view batchEncoderModule() const noexcept { return mEncoderModule; }

    // 人读的能力描述，供日志与 `/lit probe` 使用。
    [[nodiscard]] std::string_view describe() const noexcept;

private:
    HologramFacade() = default;

    void resolveBatchApi();

    bool        mProbed{};
    DisplayPath mPath{DisplayPath::None};
    BatchApi    mBatchApi{};
    std::string_view mEncoderModule{"none"};
};

} // namespace litematicabe::hologram
