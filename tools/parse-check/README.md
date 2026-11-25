# parse-check — `.litematic` 解析回归

`NbtTag.cpp` 与 `LitematicFile.cpp` 不依赖 LeviLamina/BDS 头文件，因此可以脱离游戏编译成一个小 exe，
把「小端 NBT、gzip、位解包跨 long、属性字符串化、遍历顺序」这些最容易写错的地方钉死在 CI 之前。

## 跑法

```bash
# 1. 生成测例（tests/fixtures/mini.litematic + mini.expected.json）
cd tools && python -m lit_tools fixture

# 2. 编译并对比（-P . 是必须的：仓库根也有 xmake.lua）
cd tools/parse-check
xmake f -P . -y -p windows -a x64 -m release
xmake -P . -y
python check.py
```

期望输出：

```
[ok] mini.litematic：17 个方块一致
```

## 加测例

改 `tools/lit_tools/fixture.py` 的 `build_fixture()`（尺寸、调色板、方块摆放），重新 `python -m lit_tools fixture` 即可。
测例刻意保持很小（当前 350 字节）以便进仓库；它覆盖的是「跨 long / 多调色板项 / 带属性方块 / 空气跳过」，
真实大投影请在测试服用 `/lit info <file>` 验证。
