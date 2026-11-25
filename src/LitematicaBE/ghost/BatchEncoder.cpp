#include "LitematicaBE/ghost/BatchEncoder.h"

#include "LitematicaBE/hologram/HologramFacade.h"

#include <algorithm>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace litematicabe::ghost {

namespace {

constexpr std::uint64_t packSubchunkKey(std::int32_t x, std::int32_t y, std::int32_t z) noexcept {
    constexpr std::uint64_t kMask = 0x1FFFFF; // 21 位：±1M 子区块（±16M 方块）
    auto const              sx    = static_cast<std::uint64_t>(static_cast<std::uint32_t>(x >> 4)) & kMask;
    auto const              sy    = static_cast<std::uint64_t>(static_cast<std::uint32_t>(y >> 4)) & kMask;
    auto const              sz    = static_cast<std::uint64_t>(static_cast<std::uint32_t>(z >> 4)) & kMask;
    return (sx << 42) | (sy << 21) | sz;
}

constexpr std::int32_t subchunkOrigin(std::int32_t v) noexcept {
    return v & ~15;
}

} // namespace

BatchEncoder& BatchEncoder::getInstance() {
    static BatchEncoder instance;
    return instance;
}

bool BatchEncoder::available() {
    return hologram::HologramFacade::getInstance().hasBatchEncoder();
}

std::uint32_t BatchEncoder::packetId() {
    auto const& api = hologram::HologramFacade::getInstance().batchApi();
    return api.complete() ? api.packetId() : 0u;
}

bool BatchEncoder::encodeSubchunk(
    std::int32_t                        subX,
    std::int32_t                        subY,
    std::int32_t                        subZ,
    std::vector<HoloBlockChange> const& changes,
    std::string&                        outBody
) {
    auto const& api = hologram::HologramFacade::getInstance().batchApi();
    if (!api.complete()) {
        return false;
    }
    if (changes.empty() || changes.size() > kMaxChangesPerPacket) {
        return false;
    }

    std::uint8_t* body = nullptr;
    std::size_t   len  = 0;
    auto const    rc   = api.encode(
          subX,
          subY,
          subZ,
          changes.data(),
          changes.size(),
          &body,
          &len
    );
    if (rc < 0 || body == nullptr || len == 0) {
        if (body != nullptr) {
            api.free(body);
        }
        return false;
    }

    outBody.assign(reinterpret_cast<char const*>(body), len);
    api.free(body);
    return true;
}

std::size_t BatchEncoder::encode(std::vector<HoloBlockChange> const& changes, std::vector<EncodedPacket>& outPackets) {
    if (changes.empty()) {
        return 0;
    }

    auto const id = packetId();
    if (id == 0) {
        mStats.skipped += changes.size();
        return 0;
    }

    std::unordered_map<std::uint64_t, std::vector<HoloBlockChange>> groups;
    groups.reserve(changes.size() / 64 + 1);
    for (auto const& change : changes) {
        groups[packSubchunkKey(change.x, change.y, change.z)].push_back(change);
    }

    std::size_t encoded = 0;
    for (auto const& entry : groups) {
        auto const& bucket = entry.second;

        for (std::size_t offset = 0; offset < bucket.size(); offset += kMaxChangesPerPacket) {
            auto const count = std::min(kMaxChangesPerPacket, bucket.size() - offset);
            std::vector<HoloBlockChange> slice(bucket.begin() + offset, bucket.begin() + offset + count);

            // 子区块原点从实际坐标算，避免依赖 key 的位布局。
            auto const originX = subchunkOrigin(slice.front().x);
            auto const originY = subchunkOrigin(slice.front().y);
            auto const originZ = subchunkOrigin(slice.front().z);

            EncodedPacket packet{id, {}};
            if (!encodeSubchunk(originX, originY, originZ, slice, packet.body)) {
                ++mStats.failed;
                continue;
            }
            mStats.bytes += packet.body.size();
            ++mStats.packets;
            outPackets.push_back(std::move(packet));
            ++encoded;
        }
    }

    mStats.changes += changes.size();
    return encoded;
}

} // namespace litematicabe::ghost
