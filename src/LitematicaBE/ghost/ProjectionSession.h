#pragma once

#include "LitematicaBE/core/report/MaterialCounter.h"
#include "LitematicaBE/ghost/BatchEncoder.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

class CommandOutput;
class Player;
class Block;

namespace litematicabe::ghost {

// 一份投影的显示会话（可同时存在多份，由 `ProjectionManager` 管理）。
//
// 每个会话独立持有：剔除后的方块表、坐标索引、当前显示层的编码缓存、每玩家镜像。
// 互相之间唯一共享的是「玩家状态」（维度/生死/位置），那部分在 Manager 里。
//
// 分层显示收回旧层的做法：读世界的**真实方块**，批量编码发回客户端
// （假方块只存在于客户端，发回真实方块就等于擦掉它）。
class ProjectionSession {
public:
    ProjectionSession(std::uint32_t id, std::string label);

    ~ProjectionSession();

    struct LayerRange {
        std::int32_t from{}; // 世界 y 下限（含）
        std::int32_t to{};   // 世界 y 上限（含）
    };

    [[nodiscard]] std::uint32_t id() const noexcept { return mId; }
    [[nodiscard]] std::string const& label() const noexcept { return mLabel; }

    // 解析文件、映射、剔除，并把结果记进会话（不发送）。
    // @return false 表示解析/映射失败（原因已写入 output）。
    bool begin(::CommandOutput& output, std::filesystem::path const& file, int baseX, int baseY, int baseZ);

    // 显示指定层区间：先把当前显示的层收回，再发新区间。
    std::size_t showLayers(::CommandOutput& output, ::Player& player, std::int32_t from, std::int32_t to);

    // 显示单层。
    std::size_t showLayer(::CommandOutput& output, ::Player& player, std::int32_t layer) {
        return showLayers(output, player, layer, layer);
    }

    // 无玩家时预先准备层：只计算并缓存编码结果，不发送。
    std::size_t prepareLayers(::CommandOutput& output, std::int32_t from, std::int32_t to);

    // 收回当前显示的全部方块（读真实方块发回）。
    std::size_t clear(::CommandOutput& output, ::Player& player);

    // 整体旋转 90°（顺时针，绕 load 原点；player 为空时只更新缓存）。
    std::size_t rotate(::CommandOutput& output, ::Player* player);

    struct PlaceOptions {
        bool        overwrite{};       // true：连目标位置已有的非空气方块也覆盖
        // 单次写入上限（0 = 跟随 config/projection.json 的 maxPlaceBlocks；
        // 非 0 = 本次调用显式覆盖配置，目前没有命令入口）。
        std::size_t maxBlocks{};
        bool        clearGhost{true};  // 放置前先收回 ghost 显示层
        bool        dryRun{};          // true：只跑解析统计，不写世界（当前没有指令入口，留给调试/将来复用）
    };

    struct PlaceResult {
        std::size_t placed{};
        std::size_t skipped{};    // 目标位置非空气（overwrite=false）
        std::size_t unresolved{}; // 状态串解析不出可放置方块
        std::size_t failed{};     // setBlock 返回 false（区块未加载等）
        std::size_t pending{};    // 超出 maxBlocks 未处理
        std::size_t exact{};
        std::size_t mapped{};
        std::size_t defaulted{};
        std::size_t stateIgnored{};                 // 带状态但注册表没采纳（朝向/开关会丢）
        std::vector<std::string> ignoredSamples;    // 干跑时最多留 6 条
        std::size_t loadedChunks{};                 // 放置前拉起的区块数
        std::size_t failedChunks{};                 // 拉不起来的区块数
        std::size_t retried{};                      // 重载区块后重写成功的格数
        std::size_t mismatched{};                   // setBlock 报成功但回读不一致（假成功）
        std::string firstUnresolved;
        std::vector<std::string> unresolvedSamples; // 干跑时最多留 8 条，便于补映射表
        std::vector<std::string> defaultedSamples;  // 干跑：状态降级（只认出名字）的样例
    };

    // 把投影里 [from, to] 层的方块**真实写入世界**（不是 ghost 显示）。
    //
    // 自下而上（y 升序、再 x、再 z）逐格 `setBlock`，方便依附方块落地。
    // 维度优先级：player 所在维度 → 主世界。
    PlaceResult place(
        ::CommandOutput&     output,
        ::Player*            player,
        std::int32_t         from,
        std::int32_t         to,
        PlaceOptions const&  options
    );

    // 把当前显示层重新推给指定玩家（进服/重生/传送/换维度/手动重发）。
    //
    // 私有会话只推给主人；别人调用一律直接返回（`visibleTo` 过滤）。
    void sendCachedTo(::Player& player);

    // ───────────────────────── 共享 / 私有（可见性） ─────────────────────────
    //
    // 一份投影默认对所有在线玩家可见（旧行为）。主人执行 `/lit share off` 之后，
    // 这份投影只对主人可见：显示层不再发给别人，别人屏幕上已出现的 ghost 由
    // `revokeFrom()` 读真实方块擦掉。判定集中在 `visibleTo()`，所以所有发包点只要
    // 过一遍这个函数，切开关就不需要重载投影。

    // 会话主人（`/lit load` 的玩家名）；空 = 控制台创建、无主人、恒为共享。
    void setOwner(std::string owner);
    [[nodiscard]] std::string const& owner() const noexcept { return mOwner; }

    // 主人是否选了「私有」（无主人的会话永远返回 false）。
    [[nodiscard]] bool privateMode() const;

    // 该玩家能不能看到这份投影。
    [[nodiscard]] bool visibleTo(std::string const& playerName) const;

    // 把该玩家屏幕上属于本会话的 ghost 擦掉（发当前显示层的真实方块）。
    // @return 发出的包数。
    std::size_t revokeFrom(::Player& player);

    // 刷新包围盒线框：有显示层时框住显示层，否则框住整份投影。
    void refreshWireframe();

    [[nodiscard]] std::int32_t rotation() const noexcept { return mRotation; }
    [[nodiscard]] bool         active() const noexcept { return mActive; }
    [[nodiscard]] std::string const& file() const noexcept { return mFile; }
    [[nodiscard]] std::size_t  blockCount() const noexcept { return mBlocks.size(); }

    // 材料统计（`/lit material`）：把整份投影的方块按调色板聚合成「方块名 + 材质变体」。
    //
    // 统计的是**全部方块**（`mBlocks`，未做表面剔除），不是当前显示的层 ——
    // 材料清单要能算「建完这座建筑要多少料」，跟眼前看哪一层无关。
    [[nodiscard]] core::report::MaterialReport materials() const;
    [[nodiscard]] LayerRange   bounds() const noexcept { return mBounds; }
    [[nodiscard]] LayerRange   shown() const noexcept { return mShown; }

    // 该坐标是否属于这份投影（方块变化分发用）。
    [[nodiscard]] bool contains(std::int32_t x, std::int32_t y, std::int32_t z) const;

    // 轻松放置：查这格投影要求什么方块。
    //
    // @param out 该格的目标方块（`Block` 是注册表单例，指针可直接比 hash）；
    //            nullptr 表示「这格在投影里，但解析不出可放置的方块」（映射失败）。
    // @return false = 该坐标不属于本投影。
    [[nodiscard]] bool
    targetCell(std::int32_t x, std::int32_t y, std::int32_t z, ::Block const*& out) const;

    // ───────────────────────── 已填充格（叠加态修复） ─────────────────────────
    //
    // 问题的形状：投影格被玩家放上真方块后，ghost 假方块和真方块会同时「存在」——
    // 客户端的最后一条消息决定外观，但假方块的碰撞盒是自定义方块（`lit:g_*`），
    // 与服务端真方块不一致，玩家走过去就会被服务端弹回来。
    //
    // 处理方式：把「已经被真实方块填上」的格记下来（`mFilledCells`），
    //   * 之后任何 ghost 发包都跳过这些格；
    //   * 已经发过的，补一条「该格真实方块」的包把它压回去；
    //   * 同子区块的 ghost 重新补发一遍（排除已填充格），修掉引擎发包时被顺手吞掉的邻居。
    // 玩家把方块挖掉（`requestRepaint`）时把该格从集合里摘除，ghost 恢复。

    // 该格放上了真方块 → 之后不再显示 ghost。
    void markFilled(std::int32_t x, std::int32_t y, std::int32_t z);
    [[nodiscard]] bool isFilled(std::int32_t x, std::int32_t y, std::int32_t z) const;
    [[nodiscard]] std::size_t filledCount() const noexcept { return mFilledCells.size(); }

    // 把已填充格压回真实方块（发一包真方块的 network id 给该玩家）。
    // @return 发出的包数。
    std::size_t correctFilledFor(::Player& player);

    // 重发 (x,y,z) 所在子区块的 ghost（排除已填充格），让被吞掉的邻居 ghost 自愈。
    std::size_t repaintSubchunkFor(::Player& player, std::int32_t x, std::int32_t y, std::int32_t z);

    // ghost 包发完之后必须调一次：把已填充格压回真方块 + 补发受影响的子区块。
    //
    // 两个作用：
    //   1. 预编码包会把玩家已经放好的真方块重新盖上 ghost，压回去才不会有「叠加态」；
    //   2. 引擎发方块更新时同子区块的邻居 ghost 会被客户端吞掉，这里按子区块补一遍。
    void afterGhostPush(::Player& player);

    // 该格对应的假方块 runtime id（0 = 不是投影格或解析失败）。
    [[nodiscard]] std::uint32_t ghostRuntimeIdAt(std::int32_t x, std::int32_t y, std::int32_t z) const;

    // 补发某一格（方块被挖掉后补回 ghost）。
    //
    // 只在「该格确实是空气」时才真的发 ghost：150 ms 的延迟窗口里这一格可能已经被填回
    // （投影打印机补回 / 另一次放置），那时再发 ghost 就是「客户端假方块 + 服务端真方块」，
    // 玩家走过去会被服务端弹回来。顺带记下「这一格刚被挖」的时间，供打印机做破坏冷却。
    void requestRepaint(std::int32_t x, std::int32_t y, std::int32_t z);

    // 该格是否在 `cooldownMs` 内被挖掉过（投影打印机据此让玩家先拆干净，不秒补）。
    [[nodiscard]] bool
    brokenRecently(std::int32_t x, std::int32_t y, std::int32_t z, std::int64_t cooldownMs) const;

    struct Stats {
        std::uint64_t shows{};
        std::uint64_t clears{};
        std::uint64_t clearedBlocks{};
        std::uint64_t sentPackets{};
        std::uint64_t repaints{};
        std::uint64_t resyncs{};
    };

    [[nodiscard]] Stats stats() const { return mStats; }

    struct MirrorInfo {
        std::size_t viewers{};
        std::size_t blocksPerViewer{};
        std::size_t cachedPackets{};
    };

    [[nodiscard]] MirrorInfo mirror() const;

private:
    struct Entry {
        std::int32_t  x{};    // 当前世界坐标（随旋转变化）
        std::int32_t  y{};
        std::int32_t  z{};
        std::uint32_t runtimeId{};
        std::int32_t  odx{};  // 相对 load 原点的原始 X（旋转前）
        std::int32_t  odz{};  // 相对 load 原点的原始 Z
        std::uint32_t paletteId{}; // mPalette 下标：真实放置用的原始状态串
    };

    // 把状态串收进调色板，返回下标（同一串只存一份）。
    std::uint32_t internPalette(std::string const& stateText);

    static std::uint64_t packKey(std::int32_t x, std::int32_t y, std::int32_t z) noexcept;
    static void
    unpackKey(std::uint64_t key, std::int32_t& x, std::int32_t& y, std::int32_t& z) noexcept;

    // 子区块格号形式的重发（`afterGhostPush` 用，避免坐标来回换算）。
    std::size_t repaintSubchunkKeyFor(::Player& player, std::uint64_t subKey);

    void repaintOne(std::int32_t x, std::int32_t y, std::int32_t z, std::uint32_t runtimeId);

    std::uint32_t               mId{};
    std::string                 mLabel;
    // `/lit load` 的玩家名（空 = 控制台创建）。可见性按它查 `ghost/share` 的开关。
    std::string                 mOwner;
    bool                        mActive{};
    std::string                 mFile;
    std::vector<Entry>          mBlocks;
    std::unordered_map<std::uint64_t, std::uint32_t> mIndex;
    std::vector<std::size_t>    mShownIndices;
    std::vector<EncodedPacket>  mShownPackets;
    std::unordered_map<std::string, std::unordered_set<std::uint64_t>> mViewers;

    // 已经被真实方块填上的格（`mBlocks` 下标）。旋转/卸载时清空。
    std::unordered_set<std::uint32_t> mFilledCells;

    // 「这一格刚被挖掉」的时间戳（`mBlocks` 下标 → steady_clock 毫秒）。
    // 打印机用它做破坏冷却，避免和玩家的手动拆除抢同一格。
    std::unordered_map<std::uint32_t, std::int64_t> mBrokenAt;

    // 包含已填充格的子区块（`packKey(x>>4, y>>4, z>>4)`），补偿时按子区块补 ghost。
    std::unordered_set<std::uint64_t> mFilledSubchunks;

    // 子区块（16³）→ `mBlocks` 下标，按子区块补发 ghost 用（O(该子区块格数)）。
    std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> mSubchunkCells;

    // 原始状态串调色板（`.mcstructure` 是 Bedrock 口径，`.litematic` 是 Java 口径）。
    std::vector<std::string>                       mPalette;
    std::unordered_map<std::string, std::uint32_t> mPaletteIds;

    // `mPalette` 的预解析结果（下标与 `mPalette` 一一对应）。
    // 轻松放置按格查目标方块时只做一次数组下标，运行期不再碰字符串与解析器。
    std::vector<::Block const*> mPaletteBlocks;
    bool                        mIsBedrockSource{};

    std::int32_t                mBaseX{};
    std::int32_t                mBaseZ{};
    std::int32_t                mFootprintW{};
    std::int32_t                mFootprintD{};
    std::int32_t                mRotation{};
    // 当前旋转下的世界 XZ 包围盒（含端点），线框按 [min, max + 1] 使用。
    std::int32_t                mMinX{};
    std::int32_t                mMaxX{};
    std::int32_t                mMinZ{};
    std::int32_t                mMaxZ{};
    LayerRange                  mBounds{};
    LayerRange                  mShown{};
    Stats                       mStats{};
};

} // namespace litematicabe::ghost
