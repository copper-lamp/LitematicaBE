// 解析器回归入口：读一个 .litematic，按固定格式打印区域与方块，供 check.py 对比。
//
// 输出格式（避免引入 JSON 库）：
//   META name=<..> author=<..> size=x,y,z regions=<n>
//   REGION <name> pos=x,y,z size=x,y,z palette=<n>
//   BLOCK x y z <name> k=v;k=v;
//   ERROR <message>

#include "LitematicaBE/core/schematic/LitematicFile.h"

#include <cstdio>
#include <string>

int main(int argc, char** argv) {
    if (argc < 2) {
        std::puts("usage: lit_parse_check <file.litematic>");
        return 2;
    }

    litematicabe::core::schematic::LitematicFile file;
    auto const error = litematicabe::core::schematic::readLitematic(argv[1], file);
    if (!error.ok()) {
        std::printf("ERROR %s\n", error.message.c_str());
        return 1;
    }

    std::printf(
        "META name=%s author=%s size=%d,%d,%d regions=%zu\n",
        file.name.c_str(),
        file.author.c_str(),
        file.enclosingSize[0],
        file.enclosingSize[1],
        file.enclosingSize[2],
        file.regions.size()
    );

    for (auto const& region : file.regions) {
        std::printf(
            "REGION %s pos=%d,%d,%d size=%d,%d,%d palette=%zu\n",
            region.name.c_str(),
            region.position[0],
            region.position[1],
            region.position[2],
            region.size[0],
            region.size[1],
            region.size[2],
            region.palette.size()
        );

        bool const ok = litematicabe::core::schematic::forEachBlock(region, [](auto const& block) {
            std::string props;
            for (auto const& [key, value] : *block.properties) {
                props += key;
                props += '=';
                props += value;
                props += ';';
            }
            std::printf(
                "BLOCK %d %d %d %.*s %s\n",
                block.x,
                block.y,
                block.z,
                static_cast<int>(block.name.size()),
                block.name.data(),
                props.c_str()
            );
            return true;
        });
        if (!ok) {
            std::puts("ERROR decode failed (BlockStates too short or palette empty)");
            return 1;
        }
    }
    return 0;
}
