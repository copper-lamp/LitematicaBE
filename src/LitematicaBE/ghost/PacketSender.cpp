#include "LitematicaBE/ghost/PacketSender.h"

#include "ll/api/service/Bedrock.h"

#include "mc/network/NetworkPeer.h"
#include "mc/network/NetworkSystem.h"
#include "mc/world/actor/player/Player.h"

#include <string>

namespace litematicabe::ghost {

namespace {

// 包头 = varint((packetId & 0x3FF) | (sender << 10) | (subclient << 12))。
// 本插件只发服务端包，sender/subclient 恒为 0。
constexpr std::uint32_t headerValue(std::uint32_t packetId) noexcept {
    return (packetId & 0x3FFu);
}

} // namespace

PacketSender& PacketSender::getInstance() {
    static PacketSender instance;
    return instance;
}

std::string PacketSender::withHeader(std::uint32_t packetId, std::string_view body) {
    std::uint32_t value = headerValue(packetId);

    std::string out;
    out.reserve(body.size() + 5);
    while (value & ~0x7Fu) {
        out.push_back(static_cast<char>((value & 0x7Fu) | 0x80u));
        value >>= 7;
    }
    out.push_back(static_cast<char>(value));
    out.append(body);
    return out;
}

bool PacketSender::send(::Player& player, std::uint32_t packetId, std::string_view body) {
    if (packetId == 0 || body.empty()) {
        return false;
    }

    auto networkSystem = ::ll::service::getNetworkSystem();
    if (!networkSystem) {
        ++mStats.noNetwork;
        return false;
    }

    auto* peer = networkSystem->getPeerForUser(player.getNetworkIdentifier());
    if (peer == nullptr) {
        ++mStats.noPeer;
        return false;
    }

    auto payload = withHeader(packetId, body);
    peer->sendPacket(payload, ::NetworkPeer::Reliability::Reliable, ::Compressibility::Compressible);

    ++mStats.sent;
    mStats.bytes += payload.size();
    return true;
}

} // namespace litematicabe::ghost
