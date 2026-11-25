#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace litematicabe::core::save {

// 导出格式。
//
// 默认 `Mcstructure`：基岩端能用结构方块直接导入/粘贴，也是旧项目 UI 的首选档位；
// `.litematic` 供 Litematica / 其它 Java 工具读，`.both` 一次遍历写两份。
enum class Format : int {
    Litematic   = 0,
    Mcstructure = 1,
    Both        = 2,
};

// 选区线框的绘制方式。
//
// * `Box`：一条 `createBox` 形状（省资源、好看）。该库版本实测把两点中点当成起始角，
//   整体平移「边长/2」，所以坐标在这里做了补偿（见 `selection/SelectionStore.cpp`）。
// * `Lines`：12 条 `createLine` 拼棱（`ghost/Wireframe` 用的同一条路，与投影包围盒同口径）。
//   库的盒体通道再出问题时改这个即可。
enum class BoxStyle : int {
    Box   = 0,
    Lines = 1,
};

// `config/save.json` 的生效值。字段缺失时按这里的默认值跑（与 `place.json` 同风格）。
struct Options {
    std::size_t  maxVolume{1'000'000};          // `.mcstructure`（含 both）的体积上限，读方块前截停
    std::size_t  maxVolumeLitematic{8'000'000}; // 只写 `.litematic` 时的上限（位打包更省）
    bool         includeBlockEntities{true};    // 箱子/告示牌等方块实体内容是否进文件
    bool         writeLiquidLayer{true};        // `.mcstructure` 第二层整层 -1 占位
    std::int64_t blockVersion{18168865};        // `block_palette[*].version`
    std::int64_t dataVersion{3953};             // `.litematic` 的 `MinecraftDataVersion`
    bool         overwrite{false};              // 同名文件是否覆盖（默认不覆盖，报错让玩家改名）
    bool         requireOp{false};              // 保存门槛：是否要求管理员（默认不要求）
    bool         showSelectionBox{true};        // 选点线框（全局形状，旁人也能看到）
    BoxStyle     boxStyle{BoxStyle::Box};       // 线框用盒体还是 12 条线
};

// `box` / `lines`（也接受 `line`、`框`、`线`）。
[[nodiscard]] std::optional<BoxStyle> parseBoxStyle(std::string_view raw);
[[nodiscard]] char const*             boxStyleName(BoxStyle style);

// 当前生效值（只读）。
Options const& options();

// 读 `config/save.json`；文件不存在时按默认值生成一份，缺失字段补默认。
bool loadOptions(std::string& error);
bool reloadOptions(std::string& error);

// 解析格式名（命令行/环境变量用）。解析不出来返回 `std::nullopt`（调用方负责报错）。
[[nodiscard]] std::optional<Format> parseFormat(std::string_view raw);

// 格式的规范名（`litematic` / `mcstructure` / `both`）。
[[nodiscard]] char const* formatName(Format format);

// `/lit save` / `/lit` 摘要用的一行说明。
[[nodiscard]] std::string describe();

} // namespace litematicabe::core::save
