#pragma once

#include <cstdint>
#include <string>
#include <string_view>

class Player;

namespace litematicabe::ghost {

// 把「包 id + 包体」发到指定玩家。
//
// 走 BDS 的原始网络层（与 HologramLib 内部 `wire::sendRaw` 同一条路）：
//   NetworkSystem::getPeerForUser(networkIdentifier)->sendPacket(包头+body, Reliable, Compressible)
// 包头是自己拼的 varint（包 id 低 10 位 + sender/subclient 各 2 位，当前都为 0），
// 因为 BDS 只接受「已含包头的原始字节」。
class PacketSender {
public:
    static PacketSender& getInstance();

    // 发包：拼包头 + 送 peer。
    bool send(::Player& player, std::uint32_t packetId, std::string_view body);

    // 拼包头（暴露出来供对拍/日志使用）。
    [[nodiscard]] static std::string withHeader(std::uint32_t packetId, std::string_view body);

    struct Stats {
        std::uint64_t sent{};
        std::uint64_t bytes{};
        std::uint64_t noNetwork{};
        std::uint64_t noPeer{};
    };

    [[nodiscard]] Stats const& stats() const { return mStats; }

private:
    PacketSender() = default;

    Stats mStats{};
};

} // namespace litematicabe::ghost
