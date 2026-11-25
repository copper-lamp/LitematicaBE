#pragma once

#include <string>
#include <string_view>

class Block;
class BlockType;
class Inventory;
class ItemStackBase;

namespace litematicabe::core::place {

// 一个方块类型在程序化放置（轻松放置改写 / 投影打印机）时的三类风险属性。
// 判定要读 `BlockType` 的注册表字段与类型名字符串，但结果对同一类型恒定，而 `BlockType` 是注册表单例、生命周期等于进程，所以按指针缓存一次即可。
struct RiskBits {
    bool blockEntity{}; //< 有方块实体（箱子/熔炉/告示牌/漏斗…）：写入后还要按原物品做实体后处理
    bool multiblock{};  //< 一次放置会写两格（门 / 床 / 双高植物），逐格改写会拼出残肢
    bool fluid{};       //< 流体（水 / 流动水 / 岩浆）
};

// 组合闸门：任一启用的类别命中即视为「不该程序化放置」。
struct RiskFilter {
    bool blockEntity{true};
    bool multiblock{true};
    bool fluid{true};
};

// 该类型的原始风险属性（带缓存，热路径只是一次哈希查表）。
[[nodiscard]] RiskBits const& riskBitsOf(::BlockType const& type);

// `riskBitsOf` 与过滤器的组合判定。
[[nodiscard]] bool isRiskyType(::BlockType const& type, RiskFilter filter);

// 这个物品栈是不是 `type` 这个方块类型的物品。
[[nodiscard]] bool stackIsBlockType(::ItemStackBase const& stack, ::BlockType const& type);

// 背包里这类方块的物品槽位：先看 `preferSlot`（主手），再按 0..N 顺序找。
// @return 槽位下标；-1 表示背包里没有。
[[nodiscard]] int findBlockItemSlot(::Inventory& inv, ::BlockType const& type, int preferSlot = -1);

// 背包里这类方块的总数（`skipSlot` 可排除手持槽）。
//
// 包含潜影盒里的内容：潜影盒的容量是背包的 27 倍数量级，玩家把方块塞盒子是常态，
// 只看槽位会让「轻松放置」莫名其妙地拒绝。
[[nodiscard]] int countBlockItem(::Inventory& inv, ::BlockType const& type, int skipSlot = -1);

// 从背包扣掉 `want` 个这类方块，返回**实际扣到的数量**（可能少于请求）。
//
// 顺序：先扣直接放在槽位里的，不够再从潜影盒里掏。扣潜影盒会改写盒子物品的 NBT，
// 调用方需要自己负责把背包同步给客户端。
[[nodiscard]] int takeBlockItem(::Inventory& inv, ::BlockType const& type, int want, int skipSlot = -1);

// 这个物品栈是不是潜影盒一类的「内容存在物品 NBT 里」的容器。
[[nodiscard]] bool isContainerStack(::ItemStackBase const& stack);

// 这个物品栈（潜影盒）里这类方块有多少个。非容器返回 0。
//
// 每次都实时解析 NBT，**不做任何缓存**：盒子内容随时会被开盒、漏斗、其他插件改动，
// 缓存只会读到过期数据。
[[nodiscard]] int countInContainer(::ItemStackBase const& stack, ::BlockType const& type);

// 该类型是否是流体（水 / 流动水 / 岩浆 / 流动岩浆）。
[[nodiscard]] bool isFluidType(::BlockType const& type);

// 投影打印机用：这个位置上的方块能不能被投影方块顶掉。
//
// 判定 = 空气 ∪ 流体 ∪ 内置可替换小表（草/雪层/枯木/海草/蘑菇/火…）∪ 配置追加项。
// 只收录「顶掉不心疼」的类型，玩家摆的装饰（藤蔓/睡莲/甘蔗）不在表内。
[[nodiscard]] bool isReplaceableForPrint(::Block const& block, std::string_view const* extra, unsigned extraCount);

} // namespace litematicabe::core::place
