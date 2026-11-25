# tools — 离线工具链

纯 Python 标准库，不参与运行时、不进入发布包。目的只有一个：把「版本 / 资源 / 映射」三处最容易漂移的东西在离线阶段拦住。

## 用法

```bash
cd tools
python -m lit_tools version     # Version.h / lip.toml / CHANGELOG 版本一致
python -m lit_tools addon       # BP/RP 版本、identifier 唯一性、贴图引用
python -m lit_tools mapping     # 生成 resources/data/generated/ghost_blocks.json
```

（也可以 `pip install -e .` 后直接用 `lit-tools <command>`。需要 Python ≥ 3.10，无第三方依赖。）

## 命令说明

| 命令 | 检查什么 | 失败意味着 |
|---|---|---|
| `version` | `src/LitematicaBE/Version.h` 的 `kVersion`、`xmake.lua` 的 `modVersion`、`lip.toml` 的 `version`、`CHANGELOG.md` 最新条目标题 | 发版会推出错误的版本号，`lip` 侧、打包出来的 `manifest.json` 与二进制三边不一致 |
| `addon` | BP/RP manifest 版本一致；`blocks/*.json` 的 identifier 唯一且在 `lit:` 下；`material_instances` 引用的贴图都存在于 RP 的 `terrain_texture.json` | 运行期假方块变紫黑格或串块，日志里看不出来 |
| `mapping` | 从 BP 枚举识别符与状态定义 | 映射层的输入缺失 |
| `mapgen` | 旧 `source/ghost_index.json` → 运行期 `ghost_map.json`；校验所有 ghost 名都真实存在于 BP | 运行期状态串解析失败（映射到不存在的方块） |
| `fixture` | 合成 `tests/fixtures/mini.litematic` + `.expected.json` | 解析器回归没有基准（配合 `tools/parse-check/` 使用） |
| `occlusion` | 从 Java 方块清单生成遮挡白名单 `occlusion.json`（表面剔除用），并体检误判 | 表面剔除会把玻璃/楼梯旁边的面也剔掉（投影缺块） |
| `exportmap` | 从旧项目 `BlockMappingRegistry.js` + `resources/data/java_bedrock.json` 生成 `resources/data/export_map.json`（基岩名 → Java 名、基岩状态键 → Java 状态键），供 `.litematic` 导出用 | 导出 `.litematic` 时方块改名/状态名对照缺项，Litematica 里朝向丢失（内置族规则仍可兜住一部分） |

`mapping` 的产物在 `resources/data/generated/` 下（已 gitignore）。需要固定版本时由发布流程打包，而不是提交进仓库。

`mapgen` 的产物 `resources/data/ghost_map.json` **要入库**：它是运行期真正读的映射表，构建时会被复制到插件目录 `data/`。
格式与维护流程见 [../docs/data-schema.md](../docs/data-schema.md)。

## parse-check/

`parse-check/` 是一个独立的 xmake 工程，把 `NbtTag.cpp` 与 `LitematicFile.cpp` 编成小 exe，
对 `tests/fixtures/*.litematic` 做逐方块对拍（这两个源文件不依赖 LL/BDS 头文件）：

```bash
cd tools/parse-check
xmake f -P . -y -p windows -a x64 -m release
xmake -P . -y
python check.py
```

## write-check/

`write-check/` 是**写入侧**（`.litematic` / `.mcstructure` 导出）的离线回归工程：把 `NbtTag` /
`NbtWriter` / `LitematicWriter` / `McstructureWriter` 与两个解析器编成一个小 exe，构造合成区域后
「写 → 读 → 逐格比对」。

```bash
cd tools/write-check
xmake f -P . -y -p windows -a x64 -m release
xmake -P . -y
./build/windows/x64/release/lit_write_check.exe
```

覆盖位打包跨 long、litematic（x 最快）与 mcstructure（z 最快）两套索引顺序、大端/小端、gzip 头、
`>256` 项的位宽下限修正、1×1 边界；当前 696 项检查全通过。

`smoke-run.ps1` 是配套的本地测试服冒烟脚本（启动 BDS → 逐条发控制台命令 → 抄下控制台日志）。
注意 LeviLamina 接管了控制台输入，stdin 重定向在部分组合下无效 —— 那种情况用插件的
`LITEMATICABE_SELF_TEST` 环境变量做无人值守自检（见 `docs/selection-save.md` §9）。

## xlsx-check/

`xlsx-check/` 是**材料清单导出**（`/lit material`）的离线回归工程：把
`core/report/XlsxWriter`（OOXML + zip，压缩走 miniz）、`core/report/MaterialCounter`（调色板聚合）
与 `TextEncoding` 编成一个小 exe，先用 C++ 断言聚合口径，再用 openpyxl 把生成的 xlsx 真打开、逐格校验。

```bash
cd tools/xlsx-check
xmake f -P . -y -p windows -a x64 -m release
xmake -P . -y
python check.py            # 需要 openpyxl
```

覆盖：颜色/木种变体分开、朝向与开关不拆行、越界调色板下标不崩、不可放置标记；
zip 必需 part 与 CRC、`[Content_Types].xml` 关系、加粗表头、`#,##0` / `0.00%` 数字格式、
冻结窗格、列宽、中文与 XML 特殊字符往返。详见 [xlsx-check/README.md](xlsx-check/README.md)。

## build.ps1

`tools/build.ps1` 是构建入口，做两件事：

1. **ATL 兜底**：读 vswhere 找到 VS 实例与最新 MSVC 工具集；如果该工具集没有 `atlmfc`（即没装 v143 的 ATL），就从同一实例里其它工具集借用 `atlmfc`，通过 `CL` / `LIB` / `_LINK_` 注入给本次构建进程。只影响当前进程，不改系统。
2. **调用 xmake**：默认 `f -y` + `xmake -y`，`-Reconfigure` 加 `-c` 重新配置，`-Incremental` 只跑 `xmake`。

```powershell
powershell -ExecutionPolicy Bypass -File tools/build.ps1
powershell -ExecutionPolicy Bypass -File tools/build.ps1 -Mode debug -Reconfigure
```

> 兜底只是让「只有旧工具集 ATL」的机器也能构建。正解仍然是装
> 「适用于最新 v143 生成工具的 C++ ATL (x86 和 x64)」（组件 ID `Microsoft.VisualStudio.Component.VC.ATL`），
> 装好后脚本会显示 `ATL : 当前工具集自带`，不再注入。

## legacy/

`legacy/` 是旧仓库（3.1.1，LSE Node.js）的生成脚本与构建脚本快照，**不参与任何构建**，只为算法参考：

- `legacy/node/` — `flattening_map.json`、`gen_*.js`、`build-release.mjs` 等
- `legacy/scripts/` — `work/` 下一次性使用的 Python / JS / PowerShell 脚本

新实现不假设这些脚本可运行；需要复用其中的几何/映射数据时，先把它变成 `lit_tools` 里的一个有校验的生成步骤。
