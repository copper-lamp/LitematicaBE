# LitematicaBE

<img src="https://img.shields.io/badge/version-2.5.0-blue" alt="Version">
<img src="https://img.shields.io/badge/BDS-1.21.1-green" alt="BDS Version">
<img src="https://img.shields.io/badge/LeviLamina-0.13.5+-orange" alt="LeviLamina">

基岩版 Litematica 投影插件 — 支持加载 Java 版 `.litematic` 文件，在基岩版世界中以粒子投影显示，并提供轻松放置、逐层建造、粘贴投影等全套建造辅助功能。

---

## 功能特性

### 核心能力

| 功能 | 说明 |
|------|------|
| 原理图加载 | 加载 Java 版 `.litematic` 文件 |
| 原理图保存 | 将基岩版世界中的建筑保存为 `.litematic`，与 Java 版 Litematica 完全互通 |
| 粒子投影 | 采用粒子显示投影，不修改世界实际方块 |
| 逐层建造 | 按 Y 层切换显示，低头看下层 / 抬头看上层的直觉操作 |
| 轻松放置 | 手持材料对准投影即可精确放置，支持快速连续放置（投影打印机） |
| 直接放置 | OP + 创造模式一键将投影所有方块直接写入世界（NBT 直放） |
| 方块转换 | 869 条 Java↔BE 双向无损映射 |
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

# 工具命令
/litematica:logclean status|clean|config   # 日志清理
/litematica:config reload|reset|get <key>  # 配置管理
```

---

## 安装

### 前置要求

- [LeviLamina](https://github.com/LiteLDev/LeviLamina) 0.13.5 或更高版本
- [legacy-script-engine-nodejs](https://github.com/LiteLDev/legacy-script-engine-nodejs) 插件
- 安装配套资源包以显示粒子纹理

### 安装步骤

1. 下载最新版 `LitematicaBE.zip`
2. 解压到 BDS 的 `plugins/` 目录下
3. 将资源包安装到服务端并设为全局资源包
4. 重启服务器
5. 将 `.litematic` 文件放入 `plugins/LitematicaBE/schematics/` 目录

---

## 使用指南

### 加载和放置投影

1. 将 `.litematic` 文件放入 `plugins/LitematicaBE/schematics/`
2. 进入游戏，手持木剑，蹲下点击打开主菜单
3. 点击「加载投影」→ 选择原理图文件
4. 在放置面板中调整坐标（默认脚下），点击提交
5. 投影将以半透明粒子形式显示在指定位置

### 逐层建造

1. 放置投影后，使用 `/litematica build` 切换到建造模式
2. 手持木剑，**抬头**切换上一层，**低头**切换下一层
3. 平视点击可切换到显示全部层

### 轻松放置

1. 使用 `/litematica easyplace` 开启轻松放置
2. 开启后手持对应材料对准投影即可精确放置方块
3. 可使用 `/litematica printer` 开启投影打印机，连续自动放置视线方向方块
4. 再次使用命令可关闭

### 直接放置（管理员）

1. 需要 **OP 权限 + 创造模式**
2. 在「投影管理」中选择已放置的投影 → 查看详情
3. 点击「直接放置全部方块」
4. 系统将使用 NBT 直放把所有投影方块写入世界中

### 保存原理图

1. 使用 `/litematica save` 或从菜单选择「保存原理图」
2. 点击「开始选区」后，用木剑右键选取两个对角点
3. 选区完成后自动弹出保存界面，输入名称和描述
4. 文件将保存为 `.litematic`，与 Java 版完全兼容

### 验证

1. 放置投影后使用 `/litematica verify` 验证
2. 系统将对比世界中实际方块与投影，报告匹配/差异/缺失/错误方块

---

## 配置文件

`plugins/LitematicaBE/config.json`：

```json
{
  "render": {
    "particleDensity": 1.0,
    "renderDistance": 64,
    "ghostModeOpacity": 0.5
  },
  "easyPlace": {
    "enabled": true,
    "checkInventory": true
  },
  "mega": {
    "chunkSize": 32,
    "maxMemoryChunks": 200
  },
  "megaSchematic": {
    "threshold": 30000
  }
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `render.renderDistance` | 64 | 投影粒子渲染距离（格） |
| `render.particleDensity` | 1.0 | 粒子密度系数 |
| `megaSchematic.threshold` | 30000 | Mega 模式自动触发方块数阈值 |
| `mega.chunkSize` | 32 | 分块大小（32×32×32） |
| `mega.maxMemoryChunks` | 200 | LRU 内存缓存分块上限 |

---

## 目录结构

```
plugins/LitematicaBE/
├── manifest.json              # 插件清单
├── index.js                   # 主入口
├── config.json                # 配置文件
├── schematics/                # 原理图文件目录
├── exports/                   # 材料清单导出目录
├── mega_schematics/           # Mega 分块存储
└── src/
    ├── core/                  # 核心模块（加载器/存储/保存/选区/NBT）
    ├── data/                  # 数据管理
    ├── easyplace/             # 轻松放置（放置/匹配/验证/背包/射线）
    ├── mappings/              # 方块映射表（注册表/状态转换/双向引擎）
    ├── render/                # 渲染模块（投影/Mega/LOD）
    ├── ui/                    # UI 表单管理
    └── utils/                 # 工具（材料统计）
```

---

## 更新日志

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

**Q: 为什么投影显示为乱码/空气/错误材质？**
A: 请确保服务端已安装配套资源包并设为全局资源包。客户端需要接收并应用该资源包。

**Q: 大型投影加载卡顿或失败？**
A: Mega 模式会自动启用（>30,000 方块）。如果文件特别大（>50万方块），首次加载可能需要较长时间。加载过程中可继续游戏。

**Q: 轻松放置为什么无法使用？**
A: 请先放置一个投影，然后使用 `/litematica easyplace` 开启。确保背包中有对应材料。

**Q: 直接放置提示权限不足？**
A: 此功能需要同时满足 **OP 权限** 和 **创造模式**。

**Q: 保存的原理图能在 Java 版打开吗？**
A: 可以。保存格式完全兼容 Java 版 Litematica。

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