#include "LitematicaBE/hologram/HologramFacade.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <windows.h>

#include <filesystem>
#include <string>
#include <system_error>

namespace litematicabe::hologram {

namespace {

constexpr wchar_t kHologramLibModule[] = L"HologramLib.dll";
constexpr wchar_t kHoloCoreModule[]    = L"holo_core.dll";

constexpr char kEncodeSubchunkBlocks[]   = "holo_core_encode_update_subchunk_blocks";
constexpr char kPacketIdSubchunkBlocks[] = "holo_core_packet_id_update_subchunk_blocks";
constexpr char kHoloFree[]               = "holo_free";

// 尝试从指定模块解析三个符号；成功时填充 api 并返回模块名，否则返回 nullptr。
char const* tryResolve(HMODULE module, BatchApi& api) {
    if (module == nullptr) {
        return nullptr;
    }
    auto* packetId =
        reinterpret_cast<BatchApi::PacketIdFn>(::GetProcAddress(module, kPacketIdSubchunkBlocks));
    auto* encode = reinterpret_cast<BatchApi::EncodeFn>(::GetProcAddress(module, kEncodeSubchunkBlocks));
    auto* freeFn = reinterpret_cast<BatchApi::FreeFn>(::GetProcAddress(module, kHoloFree));
    if (packetId == nullptr || encode == nullptr || freeFn == nullptr) {
        return nullptr;
    }
    api.packetId = packetId;
    api.encode   = encode;
    api.free     = freeFn;
    return "ok";
}

HMODULE loadHoloCoreFrom(std::filesystem::path const& dir) {
    std::error_code ec;
    if (dir.empty() || !std::filesystem::exists(dir / kHoloCoreModule, ec)) {
        return nullptr;
    }
    return ::LoadLibraryW((dir / kHoloCoreModule).c_str());
}

} // namespace

std::string_view toString(DisplayPath path) noexcept {
    switch (path) {
        case DisplayPath::BatchEncoder:
            return "batch-encoder";
        case DisplayPath::PerCellOverride:
            return "per-cell-override";
        case DisplayPath::None:
        default:
            return "none";
    }
}

HologramFacade& HologramFacade::getInstance() {
    static HologramFacade instance;
    return instance;
}

void HologramFacade::resolveBatchApi() {
    mBatchApi = {};
    mEncoderModule = "none";

    // 1. 前置模块自身的导出表（若 HologramLib 把编码器一并导出）。
    if (::GetModuleHandleW(kHologramLibModule) != nullptr) {
        if (tryResolve(::GetModuleHandleW(kHologramLibModule), mBatchApi) != nullptr) {
            mEncoderModule = "HologramLib.dll";
            return;
        }
    }

    // 2. 进程内已加载的 holo_core.dll。
    if (auto module = ::GetModuleHandleW(kHoloCoreModule); module != nullptr) {
        if (tryResolve(module, mBatchApi) != nullptr) {
            mEncoderModule = "holo_core.dll";
            return;
        }
    }

    // 3~5. 按目录顺序尝试加载。
    std::filesystem::path modDir;
    if (auto nativeMod = ::ll::mod::NativeMod::current()) {
        modDir = nativeMod->getModDir();
    }

    std::error_code ec;
    auto            modsRoot = ::ll::mod::getModsRoot();

    std::filesystem::path const candidates[] = {
        modDir,
        modsRoot / "HologramLib",
        modsRoot / "LitematicaBE",
    };
    for (auto const& dir : candidates) {
        if (auto module = loadHoloCoreFrom(dir); module != nullptr) {
            if (tryResolve(module, mBatchApi) != nullptr) {
                mEncoderModule = "holo_core.dll";
                return;
            }
        }
    }

    // 6. 交给系统搜索路径。
    if (auto module = ::LoadLibraryW(kHoloCoreModule); module != nullptr) {
        if (tryResolve(module, mBatchApi) != nullptr) {
            mEncoderModule = "holo_core.dll";
            return;
        }
    }
    (void)ec;
}

DisplayPath HologramFacade::probe() {
    if (mProbed) {
        return mPath;
    }
    mProbed = true;

    if (!compiledWithHologramLib()) {
        mPath = DisplayPath::None;
        return mPath;
    }

    // 前置是独立插件：DLL 不在位时，链接进来的导出无法解析，逐格通道也不可用。
    if (::GetModuleHandleW(kHologramLibModule) == nullptr) {
        mPath = DisplayPath::None;
        return mPath;
    }

    resolveBatchApi();
    mPath = mBatchApi.complete() ? DisplayPath::BatchEncoder : DisplayPath::PerCellOverride;
    return mPath;
}

BatchApi const& HologramFacade::batchApi() {
    (void)probe();
    return mBatchApi;
}

bool HologramFacade::hasBatchEncoder() {
    return probe() == DisplayPath::BatchEncoder;
}

std::string_view HologramFacade::describe() const noexcept {
    if (!compiledWithHologramLib()) {
        return "HologramLib: not compiled in (hologramlib/ missing at build time)";
    }
    switch (mPath) {
        case DisplayPath::BatchEncoder:
            return "HologramLib: batch encoder ready";
        case DisplayPath::PerCellOverride:
            return "HologramLib: loaded, but no batch encoder (holo_core.dll) -> per-cell only";
        case DisplayPath::None:
        default:
            return "HologramLib: plugin not loaded (HologramLib.dll not in process)";
    }
}

} // namespace litematicabe::hologram
