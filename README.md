# LitematicaBE

<img src="https://img.shields.io/badge/version-3.0.0-blue" alt="Version">
<img src="https://img.shields.io/badge/BDS-1.21.132+-green" alt="BDS Version">
<img src="https://img.shields.io/badge/LeviLamina-0.13.5+-orange" alt="LeviLamina">

基岩版跨时代投影插件 — 支持加载 Java 版 `.litematic` 文件，在基岩版世界中以自定义 ghost 方块投影显示，并提供逐层建造等功能。

---

## 功能特性

### 核心能力

| 功能 | 说明 |
|------|------|
| 原理图加载 | 加载 Java 版 `.litematic` 文件 |
| 原理图保存 | 将基岩版世界中的建筑保存为 `.litematic`，与 Java 版 Litematica 完全互通 |
| ghost 投影 | 采用自定义 ghost 方块显示投影，贴近原版显示 |
| 逐层建造 | 按 Y 层切换显示，低头看下层 / 抬头看上层的直觉操作 |
| 轻松放置 | 手持材料对准投影即可精确放置，支持快速连续放置（投影打印机） |
| 直接放置 | OP + 创造模式一键将投影所有方块直接写入世界（NBT 直放） |
| 方块转换 |  Java↔BE 双向无损映射 |
| 投影管理 | 多投影同时存储，可随时加载/卸载/删除，支持材料清单导出 |
| Mega 模式 | 分块存储 + 流式加载 + LOD 渲染，支持 100 万+ 方块超大型投影 |

### 操作方式

| 操作 | 说明 |
|------|------|
| 手持木剑 + 蹲下 + 点击 | 打开主菜单 |
| 抬头/低头 + 木剑点击 | 逐层模式时切换显示层 |
| 平视 + 木剑点击 | 切换显示全部层 |
| `/lit` / `/litematica` | 命令系统入口 |

---

## 快速开始

```bash
# 基础命令
/litematica menu          # 打开主菜单
/litematica load <file>   # 加载原理图
/litematica place <file>  # 加载并在脚下放置投影
/litematica placeat X Y Z # 在指定坐标放置投影
/litematica easyplace     # 切换轻松放置
/litematica printer       # 切换投影打印机
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

---

## 安装

### 前置要求

- [LeviLamina](https://github.com/LiteLDev/LeviLamina) 0.13.5 或更高版本
- [legacy-script-engine-nodejs](https://github.com/LiteLDev/legacy-script-engine-nodejs) lse插件
- [LegacyMoney](https://github.com/LiteLDev/LegacyMoney) lse的前置插件
- [LegacyRemoteCall](https://github.com/LiteLDev/LegacyRemoteCall) lse的前置插件
- 安装配套扩展包以显示 ghost 方块纹理

### 安装步骤

1. 下载最新版 `LitematicaBE.zip`
2. 将 plugins 内文件解压到 BDS 的 `plugins/` 目录下
3. 将服务端拓展包（BP/RP）分别放置到 BDS 的`behaviour_packs/`和`resource_packs/`目录下
4. 在 BDS 的 `worlds/<世界名>/` 目录下找到 `world_behavior_packs.json` 和 `world_resource_packs.json` 并按数组格式写入 BP 和 RP 的 `pack_id` 及 `version`
5. 重启服务器
6. 将已打包的拓展包（addon）装载到玩家客户端
7. 将 `.litematic` 文件放入 `plugins/LitematicaBE/schematics/` 目录

---

## 使用指南

### 加载和放置投影

1. 将 `.litematic` 文件放入 `plugins/LitematicaBE/schematics/`
2. 进入游戏，手持木剑，蹲下点击打开主菜单
3. 点击「加载投影」→ 选择原理图文件
4. 在放置面板中调整坐标（默认脚下），点击提交
5. 投影将以粒子形式显示在指定位置

### 逐层建造

1. 放置投影后，打开投影菜单，点击投影操作，点击**开启逐层显示**
2. 手持木剑，**抬头**右键切换上一层，**低头**右键切换下一层
3. 平视点击可切换到显示全部层

### 轻松放置

1. 点击投影操作，点击**开启轻松放置**开启轻松放置
2. 开启后手持材料对准投影即可精确放置方块
3. 点击投影操作，点击**开启投影打印机**开启投影打印机，自动放置附近方块
4. 再次点击菜单可关闭轻松放置

### 直接放置（管理员）

1. 需要 **OP 权限 + 创造模式**
2. 在「投影管理」中选择已放置的投影 → 查看详情
3. 点击「直接放置全部方块」
4. 系统将使用 NBT 直放把所有投影方块写入世界中

### 保存原理图

1. 打开菜单，点击**保存投影**
2. 点击「开始选区」后，根据提示用木剑右键选取两个对角点
3. 选区完成后自动弹出保存界面，输入名称和描述
4. 文件将保存为 `.litematic`，与 Java 版完全兼容

### 验证

1. 放置投影后，点击投影操作，点击**验证投影**验证
2. 系统将对比世界中实际方块与投影，报告匹配/差异/缺失/错误方块

---

## 目录结构

```
LitematicaBE/
├── index.js                                 # 主入口
├── manifest.json                            # 插件清单
├── config.json                              # 配置文件
├── schematics/                              # 原理图文件目录
├── mega_schematics/                         # 运行时生成
├── exports/                                 # 材料清单导出目录
├── data/                                    # 构建产物 + 运行时状态
├── logs/                                    # 日志文件
├── node_modules/                            # 既有依赖
└── src/
    ├── core/                                # 核心模块（NBT、投影加载/保存、方块转换、配置、日志、选区、Mega 管理）
    ├── data/                                # 玩家/投影数据持久化
    ├── easyplace/                           # 轻松放置
    ├── ghost/                               # ghost 子系统（渲染、守卫、注册表、期望、探针、自检、版本校验、外壳提取）
    ├── mappings/                            # JE / BE 方块映射
    ├── render/                              # 投影渲染（会话层、Mega、LOD、统一调度器）
    ├── ui/                                  # UI 菜单与提示
    ├── utils/                               # 通用工具
    └── world/                               # 原方块快照部分
```

---

## 更新日志

### v3.0.0 (2026-10-31)（preview）

- 重大重构：渲染逻辑由 LSE 生成贴图粒子全面转向自定义 ghost 方块，更加贴近原版Litematica
 - 新增 ghost 子系统：共 8 个全新文件，约 12 万字节，作为新构架渲染核心，包含期望逻辑、外壳提取、ghost 方块定义与查表、调试工具等
 - 资源包更新：新版本使用服务端插件 + 双端 addon 包形式实现，并校验版本一致性
 - 映射表升级：从"旧式容器 ID + 状态"升级为完整扁平化方块名并增加 `legacyBedrockId` 回退表
 - 统一 tick 调度器：全局保留一个 `onTick`，所有周期任务收敛到调度器，带预算管理、优先级、启停、统计
 - 添加快照功能：保障投影写入安全性，防止对存档造成破坏
 - 生命周期重构：为新渲染逻辑完善了生命周期，包括保活、重写、校验等
 - 命令功能调整：新注册 /litematica selfcheck 及 /litematica:ghost （`lay`/`undo`/`info`/`restore`）并修复了部分旧版bug
 - 修复维度 ID 问题：现在投影可以跨纬度正确显示
 - 其它若干代码优化与 Bug 修复

### v2.5.0 (2026-05-24)

- 直接放置功能迁移至投影信息面板，改用 NBT 直放
- 投影名字逻辑修复：无名字时自动回退到文件名
- 大型投影加载优化：NBT 解析安全限制 + 文件读取健壮性
- 第二轮映射 Bug 修复：门类解禁 / 羊毛陶瓦颜色 / 拉杆朝向 / 按钮 / 铁链 / 旗帜

### v2.4.4 (2026-05-24)

- 方块映射表系统重构：BlockMappingRegistry (869条) + BlockStateConverters + BidirectionalBlockConverter
- 旧模块清理 + 渲染层集成 + 42项测试全通过

### v2.4.3 (2026-05-24)

- 830+ 方块映射表数据结构设计（分类/版本/位掩码）
- 30+ 脚本修复

### v2.4.2 (2026-05-23)

- Java 版投影 0×0×0 修复、BigInt→Date 崩溃修复
- BigInt 精度丢失 + gzip 后备逻辑 + File API 编解码修复

### v2.4.1 (2026-05-23)

- OP+创造模式直接放置全部方块
- 投影放置面板 GUI（信息展示 + 坐标输入）
- Mega 投影索引逻辑修复

### v2.4.0 (2026-05-17)

- 原理图保存功能（选区 → .litematic）
- 木剑选区工具、NBT 序列化器、完整方块名称/状态映射
- 与 Java 版 Litematica 完全互通

### v2.3.x (2026-04~05)

- Mega 模式架构重构（统一渲染管线）
- 流式加载器 + 分块存储 + LOD 渲染
- Mega 投影渲染/层切换/重复渲染修复

### v2.2.0 (2026-04-26)

- Mega 模式：支持 100 万+ 方块超大型投影
- 流式加载 + 分块存储 + 内存不足自动转存磁盘

### v2.1.0 (2026-04-04)

- 轻松放置模式 + 方块验证 + 材料清单

### v2.0.0 (2026-03-28)

- 全新 LeviLamina 架构、粒子投影系统、木剑快捷操作、逐层建造模式

---

## 常见问题

**Q: 为什么 3.X.X 版本部分功能无法使用？**
A: 第三代 LitematicaBE 正在完善重构中，部分旧版功能暂未经测试/开放，如有问题请提交 Issue 或移步群聊反映

**Q: 为什么投影显示为空气/错误材质？**
A: 该bug是映射表的原因，Java与基岩差距极大，所有方块都是通过映射实现。遇到此类bug请提交Issues

**Q: 大型投影加载卡顿或失败？**
A: Mega 模式会自动启用（>30,000 方块）。如果文件特别大（>50万方块），首次加载可能需要较长时间。加载过程中可继续游戏

**Q: 轻松放置为什么无法使用？**
A: 可能是投影文件错误或读取失败，或是缺少方块映射，或者玩家操作问题

**Q: 直接放置提示权限不足？**
A: 此功能需要同时满足 **OP 权限** 和 **创造模式**

**Q: 保存的原理图能在 Java 版打开吗？**
A: 可以。保存格式兼容 Java 版 Litematica

---

## 贡献

欢迎提交 Issue 和 Pull Request！  
QQ 群：861900673  
GitHub：[https://github.com/copper-lamp/LitematicaBE](https://github.com/copper-lamp/LitematicaBE)

---

## 致谢

- [Litematica](https://github.com/maruohon/litematica) — Java 版原理图模组，本项目的数据格式兼容目标
- [LeviLamina](https://github.com/LiteLDev/LeviLamina) — 基岩版模组加载器

## 许可证

MIT License
