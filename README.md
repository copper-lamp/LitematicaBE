<div align="center">
  <img src="resources/pack_icon.png" alt="LitematicaBE icon" width="160">
  <h1>LitematicaBE</h1>
  <p><strong>在基岩版里，用 Java 版 Litematica 的方式造建筑。</strong></p>
  <p>加载与保存 <code>.litematic</code>，用半透明 ghost 方块显示投影，支持逐层建造、轻松放置与材料清单导出。</p>

  <p>
    <img src="https://img.shields.io/badge/release-v3.0.1-4c8bf5?style=flat-square" alt="LitematicaBE v3.0.1">
    <img src="https://img.shields.io/badge/Minecraft%20Bedrock-1.21.132%2B-62b47a?style=flat-square" alt="Minecraft Bedrock 1.21.132+">
    <img src="https://img.shields.io/badge/LeviLamina-26.10%2B-7b68ee?style=flat-square" alt="LeviLamina 26.10+">
    <img src="https://img.shields.io/badge/LegacyScriptEngine-nodejs%200.22.x-ffb300?style=flat-square" alt="LegacyScriptEngine nodejs 0.22.x">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license"></a>
  </p>

  <p>
    <a href="#快速开始">快速开始</a>
    ·
    <a href="https://github.com/copper-lamp/LitematicaBE/releases">下载</a>
    ·
    <a href="CHANGELOG.md">更新日志</a>
    ·
    <a href="https://github.com/copper-lamp/LitematicaBE/issues">反馈问题</a>
    ·
    <a href="#贡献">贡献</a>
    ·
    <a href="README_EN.md">English</a>
  </p>
</div>

> [!WARNING]
> 3.x 仍在重构与预览阶段：Mega 投影的视口跟随 / 分块卸载 / LOD 尚未恢复。升级前请备份存档；插件与 addon 的版本必须一致，否则 ghost 写入会被禁用。

LitematicaBE 是一个面向基岩版（BDS + LeviLamina）的投影插件：读取 Java 版 Litematica 的 `.litematic` 文件，用自定义 ghost 方块在世界中还原投影，并提供逐层建造、轻松放置、方块验证与材料清单等建筑辅助功能。保存出的 `.litematic` 可被 Java 版 Litematica 直接打开。

## 快速开始

> [!IMPORTANT]
> LitematicaBE 由「服务端插件 + BP/RP 扩展包」组成。服务端与客户端都需要安装，且两者版本必须一致。

1. 安装 lip（已安装可跳过）：

   ```shell
   npm install -g @levimc/lip
   ```

2. **服务端**：在 BDS 根目录执行：

   ```shell
   lip install github.com/copper-lamp/LitematicaBE
   ```

   插件会安装到 `plugins/LitematicaBE/`，BP/RP 分别安装到 `behavior_packs/` 与 `resource_packs/`。

3. **客户端**：在 LeviLauncher 的「内容下载 → lip」中搜索 LitematicaBE 安装，或在客户端实例根目录执行：

   ```shell
   lip install github.com/copper-lamp/LitematicaBE#client
   ```

   无法使用 lip 的玩家可以直接导入 Release 里的 `LitematicaBE-client-<版本>.mcaddon`。

4. **在世界中启用扩展包**：把 BP/RP 的 `pack_id` 与 `version` 写入 `worlds/<世界名>/world_behavior_packs.json` 和 `world_resource_packs.json`（或在世界设置界面勾选），然后重启服务器。

   ```json
   [
     { "pack_id": "<BP 的 header.uuid>", "version": [1, 1, 8] }
   ]
   ```

5. 把 `.litematic` 文件放进 `plugins/LitematicaBE/schematics/`，进游戏手持木剑蹲下点击打开主菜单。

指定版本安装（推荐锁定版本）：

```shell
lip install github.com/copper-lamp/LitematicaBE@3.0.1          # 服务端
lip install github.com/copper-lamp/LitematicaBE#client@3.0.1   # 客户端
```

升级用 `lip update github.com/copper-lamp/LitematicaBE`。`lip` 只管理服务端工作区；客户端实例由 LeviLauncher 管理，命令中的 `#client` 变体不可省略。

## 兼容性

| 组件 | 版本 |
| ---- | ---- |
| Minecraft Bedrock Server | 1.21.132+ |
| LeviLamina | 26.10+ |
| LegacyScriptEngine（nodejs 变体） | 0.22.x |
| LitematicaBE 插件 / addon | 随 Release 一同发布，插件会校验两侧版本一致 |
| 客户端平台 | Windows x64（其他平台请手动导入 `.mcaddon`） |

## 功能特性

| 功能 | 说明 |
| ---- | ---- |
| 原理图加载 | 加载 Java 版 `.litematic` 文件 |
| 原理图保存 | 把基岩版建筑保存为 `.litematic`，与 Java 版 Litematica 互通 |
| ghost 投影 | 自定义 ghost 方块渲染，半透明显示，贴近原版观感 |
| 逐层建造 | 按 Y 层切换显示，抬头看上层 / 低头看下层 |
| 轻松放置 | 手持材料对准投影精确放置，支持快速连续放置 |
| 投影打印机 | 开启后自动把半径内（默认 5 格）的 ghost 格填成真方块，可限速、可逐层 |
| 直接放置 | OP + 创造模式把投影方块直接写入世界（NBT 直放） |
| 方块转换 | Java ↔ 基岩版双向映射，含 legacy 回退表 |
| 投影管理 | 多投影存储、加载 / 卸载 / 删除、材料清单导出 |
| Mega 投影 | 分块存储 + 流式加载 + LOD 渲染（重构中；未启用时自动回退普通渲染） |
| 自检 | `/litematica selfcheck` 校验整条 ghost 写入链路 |

### 操作方式

| 操作 | 说明 |
| ---- | ---- |
| 手持木剑 + 蹲下 + 点击 | 打开主菜单 |
| 抬头 / 低头 + 木剑点击 | 逐层模式时切换显示层 |
| 平视 + 木剑点击 | 切换显示全部层 |
| `/lit` / `/litematica` | 命令系统入口 |

## 命令

```shell
# 基础命令
/litematica menu          # 打开主菜单
/litematica load <file>   # 加载原理图
/litematica place <file>  # 加载并在脚下放置投影
/litematica placeat X Y Z # 在指定坐标放置投影
/litematica easyplace     # 切换轻松放置
/litematica printer       # 切换投影打印机（也可用 /lit printer）
/litematica verify        # 验证方块放置正确性
/litematica materials     # 生成材料清单 Excel
/litematica save          # 保存原理图（选区模式）
/litematica build         # 切换到建造（逐层）模式
/litematica rotate        # 切换到旋转模式
/litematica list          # 列出所有投影
/litematica clear         # 清除当前投影显示
/litematica info          # 查看投影详细信息
/litematica debug <sub>   # 调试命令（mega/stats/config）
/litematica selfcheck     # 投影流程自检

# 工具命令
/litematica:logclean status|clean|config   # 日志清理
/litematica:config reload|reset|get <key>  # 配置管理
/litematica:ghost lay|undo|info|restore    # ghost 测试
```

## 使用指南

### 加载与放置投影

1. 把 `.litematic` 放进 `plugins/LitematicaBE/schematics/`。
2. 手持木剑蹲下点击打开主菜单，点击「加载投影」并选择文件。
3. 在放置面板调整坐标（默认脚下），提交后投影显示在目标位置。

### 逐层建造

1. 投影操作面板中开启**逐层显示**。
2. 木剑右键：**抬头**切到上一层，**低头**切到下一层，平视切回全部层。

### 轻松放置

1. 在投影操作面板开启**轻松放置**，手持材料对准投影即可精确放置。
2. 需要连续放置时再开启**投影打印机**（`/litematica printer` 或 `/lit printer`）；再次点击菜单可关闭。
3. 打印机只填 ghost / 空气 / 花草雪水这类可替换方块，**不会覆盖你自己放的方块**；逐层模式下只放当前层。

打印机可调参数（`config.json` 的 `easyPlace.printer`，改完即时生效）：

| 键 | 默认 | 说明 |
|---|---|---|
| `radius` | 5 | 搜索半径（格） |
| `maxPerCycle` | 12 | 每轮（200ms）最多放多少格，调大容易卡服 |
| `budgetMs` | 6 | 单轮时间预算，超出的格留到下一轮 |
| `placeDelayMs` | 0 | >0 = 每轮只放一格（想要"慢慢放"才改） |
| `overwriteReplaceable` | true | 是否顶掉花草/雪/水 |
| `debug` | false | 写 `logs/LitematicaBE/easyplace_debug.log`（最多 5 秒一条） |

### 直接放置（管理员）

1. 需要 **OP 权限 + 创造模式**。
2. 在「投影管理」中选择已放置的投影并进入详情，点击「直接放置全部方块」。

### 保存原理图

1. 打开菜单点击**保存投影**，点击「开始选区」，用木剑右键选取两个对角点。
2. 选区完成后输入名称与描述，文件会保存为 `.litematic`。

### 验证

放置投影后在投影操作面板点击**验证投影**，系统会报告匹配 / 差异 / 缺失 / 错误方块。

## 手动安装

不使用 lip 时，可下载 Release 中的 `LitematicaBE-<版本>.zip`：

1. 把 `plugins/LitematicaBE/` 解压到 BDS 的 `plugins/` 目录。
2. 把 `LitematicaBE-server-BP/`、`LitematicaBE-server-RP/` 分别放到 BDS 的 `behavior_packs/` 与 `resource_packs/`。
3. 按「快速开始」第 4 步在世界中启用扩展包，然后重启服务器。
4. 把 `.mcaddon` 交给玩家导入客户端。
5. 把 `.litematic` 放进 `plugins/LitematicaBE/schematics/`。

## 目录结构

```text
LitematicaBE/
├── index.js                        # 主入口
├── manifest.json                   # LSE 插件清单
├── tooth.json                      # lip 包描述（服务端 + 客户端变体）
├── config.json                     # 默认配置
├── resources/
│   ├── pack_icon.png               # 项目图标
│   ├── addon/                      # BP / RP / mcaddon 源
│   └── data/                       # ghost 索引与 addon 期望版本
├── src/                            # 核心、渲染、ghost、映射、UI 等模块
├── tools/                          # 版本校验与发布打包脚本
└── .github/workflows/              # CI 与 tag 发布
```

运行时目录（不随仓库提交）：`schematics/`、`mega_schematics/`、`exports/`、`data/`、`logs/`。

## 从源码构建

需要 Node.js 20+。构建产物输出到 `build/`：

```shell
npm ci
node tools/check-version.mjs
npm run build
```

产物包括：

| 文件 | 用途 |
| ---- | ---- |
| `LitematicaBE-server-<版本>.zip` | lip 服务端变体（插件 + BP/RP） |
| `LitematicaBE-client-<版本>.zip` | lip 客户端变体（BP/RP） |
| `LitematicaBE-<版本>.zip` | 手动安装包 |
| `LitematicaBE-client-<版本>.mcaddon` | 手动导入兜底 |
| `SHA256SUMS.txt` | 校验和 |

## 发布流程

1. 同步版本号：`package.json`、`manifest.json`、`tooth.json`，并在 `CHANGELOG.md` 写入 `## [<版本>]` 段落。
2. 打 tag 并推送：

   ```shell
   git tag v3.0.1
   git push origin v3.0.1
   ```

3. `.github/workflows/release.yml` 会自动校验版本一致性、构建全部产物并创建 GitHub Release；tag 含 `-preview` / `-beta` / `-rc` 时自动标记为 prerelease。

## 常见问题

**Q：为什么部分 3.x 功能无法使用？**
A：第三代 LitematicaBE 在逐块恢复旧功能。ghost 投影、逐层建造、轻松放置、**投影打印机**已可用；Mega 投影的分块视口跟随 / 卸载 / LOD、以及 `verify` 对 ghost 的判定仍在补齐。

**Q：投影显示为空气或错误材质？**
A：多为方块映射问题。Java 与基岩版方块差异较大，遇到请提交 Issue 并附上方块名与截图。

**Q：ghost 写入被禁用 / 提示版本不一致？**
A：插件、服务端 BP/RP、客户端 addon 必须同批。重新执行 `/litematica selfcheck` 查看具体项，并确认世界已启用对应扩展包。

**Q：大型投影加载卡顿或失败？**
A：Mega 模式仍在重构，当前版本对超过 30,000 方块的投影会自动回退普通渲染；超大投影仍建议先拆分或用逐层显示。

**Q：轻松放置无法使用？**
A：检查投影文件是否读取成功、方块映射是否完整，以及是否正确开启轻松放置。

**Q：直接放置提示权限不足？**
A：需要同时满足 **OP 权限** 与 **创造模式**。

**Q：保存的原理图能在 Java 版打开吗？**
A：可以，保存格式兼容 Java 版 Litematica。

**Q：lip 安装后还需要做什么？**
A：服务端仍需在世界设置中启用 BP/RP 并重启；客户端导入 addon 后同样需要在世界设置中启用。

## 贡献

欢迎提交 Issue 与 Pull Request。  
QQ 群：861900673  
GitHub：<https://github.com/copper-lamp/LitematicaBE>

## 致谢

- [Litematica](https://github.com/maruohon/litematica) — Java 版原理图模组，本项目数据结构兼容目标
- [LeviLamina](https://github.com/LiteLDev/LeviLamina) — 基岩版模组加载器
- [LegacyScriptEngine](https://github.com/LiteLDev/LegacyScriptEngine) — LSE 脚本引擎
- [lip](https://github.com/LiteLDev/lip) — LeviLamina 包管理器

## 许可证

MIT License
