# LitematicaBE

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-Bedrock%20Edition-brightgreen" alt="Platform">
  <img src="https://img.shields.io/badge/LeviLamina-1.9.x-orange" alt="Framework">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

<p align="center">
  <strong>Minecraft Bedrock Edition 投影工具 - Litematica for BE</strong>
</p>

<p align="center">
  一个功能强大的服务端插件，允许玩家在 Bedrock 版服务端加载和显示 Litematic 原理图投影。
</p>

***

## 功能特性

### 核心功能

- 📂 **原理图加载** - 支持加载 `.litematic` 和 `.json` 格式的 Litematic 原理图文件
- 🎯 **精准投影** - 在世界中显示全息投影，辅助建筑建造
- 🔄 **旋转功能** - 支持 90° 倍数旋转投影
- 📊 **多层显示** - 支持按层显示，方便逐层建造
- 🎮 **木剑操作** - 手持木剑进行各种快捷操作

### 操作模式

- **放置模式** - 点击放置投影
- **旋转模式** - 点击旋转投影 90°
- **建造模式** - 抬头/低头切换显示层级

### 轻松放置 (Easy Place)

- 🎯 **自动选中方块** - 在投影范围内放置方块时，自动从背包中选择正确的方块
- 📦 **潜影盒支持** - 自动检索并提取潜影盒中的方块
- 🔒 **错误操作阻止** - 阻止在错误位置放置方块，并提示"由轻松放置阻止的操作"
- 🧱 **方块状态匹配** - 支持方块方向等状态的精确匹配

### 额外功能

- 👥 **全服共享** - 放置的投影对所有玩家可见
- 📏 **范围提示** - 进入投影范围时自动提示
- ⚙️ **个性化设置** - 支持透明度、边框颜色等设置

***

## 安装要求

| 依赖                          | 版本要求   |
| --------------------------- | ------ |
| BDS                         | 1.21.x |
| LeviLamina                  | 1.9.x  |
| legacy-script-engine-nodejs | 0.17.x |

***

## 安装步骤

### 1. 安装依赖

确保你的服务端已安装以下组件：

- LeviLamina 1.9.x
- legacy-script-engine-nodejs

### 2. 安装插件

1. 下载本插件
2. 将 `LitematicaBE` 文件夹复制到 `bedrock-server/plugins/` 目录
3. 确保目录结构如下：

```
bedrock-server/
├── bedrock_server_mod.exe
└── plugins/
    ├── LeviLamina/
    │   └── ...
    ├── legacy-script-engine-nodejs/
    │   └── ...
    └── LitematicaBE/
        ├── manifest.json
        ├── index.js
        └── src/
            ├── core/
            ├── data/
            ├── easyplace/
            ├── render/
            ├── ui/
            └── utils/
```

### 3. 放置原理图文件

将 `.litematic` 或 `.json` 格式的原理图文件放入：

```
plugins/LitematicaBE/schematics/
```

***

## 使用方法

### 命令列表

| 命令                                | 说明        | 权限     |
| --------------------------------- | --------- | ------ |
| `/litematica` 或 `/lit`            | 打开主菜单     | 所有人    |
| `/litematica menu`                | 打开 GUI 菜单 | 所有人    |
| `/litematica load <文件名>`          | 加载原理图     | 所有人    |
| `/litematica place [文件名]`         | 在当前位置放置投影 | 所有人    |
| `/litematica placeat <x> <y> <z>` | 在指定坐标放置投影 | 所有人    |
| `/litematica rotate`              | 切换到旋转模式   | 所有人    |
| `/litematica build`               | 切换到建造模式   | 所有人    |
| `/litematica easyplace`           | 切换轻松放置模式  | 所有人    |
| `/litematica clear`               | 清除当前投影显示  | 所有人    |
| `/litematica list`                | 列出所有投影    | 所有人    |
| `/litematica info`                | 显示当前投影信息  | 所有人    |
| `/litematica remove <ID>`         | 删除投影      | 创建者/OP |

### 木剑操作

| 操作             | 功能       |
| -------------- | -------- |
| 手持木剑 + 点击      | 执行当前模式操作 |
| 手持木剑 + 蹲下 + 点击 | 打开主菜单    |

### 操作模式说明

#### 放置模式

加载原理图后，使用放置模式将投影放置到世界中。

#### 旋转模式

- 切换到旋转模式后
- 点击投影可将其旋转 90°

#### 建造模式

- 切换到建造模式后
- 抬头点击 = 上一层
- 低头点击 = 下一层
- 平视点击 = 切换全部/单层显示

#### 轻松放置模式

- 开启后，在投影范围内放置方块时：
  - 自动从背包中选择正确的方块类型
  - 自动从潜影盒中提取方块
  - 阻止在错误位置放置方块
- 使用 `/litematica easyplace` 或 GUI 菜单开启/关闭

***

## 原理图格式

### 支持的格式

1. **.litematic** - Java 版 Litematica 导出的格式
2. **.json** - JSON 格式的原理图

### JSON 格式示例

```json
{
    "Metadata": {
        "Name": "My Structure",
        "Author": "PlayerName"
    },
    "Region": {
        "LiteTickets": [
            {
                "Blocks": [
                    {"pos": [0, 0, 0], "id": 1, "data": 0},
                    {"pos": [1, 0, 0], "id": 2, "data": 0}
                ]
            }
        ]
    },
    "Entities": []
}
```

***

## 配置说明

### 数据存储

插件会自动在以下位置创建数据文件：

- `plugins/LitematicaBE/data/player_data.json` - 玩家数据
- `plugins/LitematicaBE/data/projections.json` - 投影数据

***

## 常见问题

### Q: 插件加载失败怎么办？

A: 检查是否正确安装了 LeviLamina 和 legacy-script-engine-nodejs

### Q: 原理图加载后不显示？

A: 请先使用 `/litematica place` 命令放置投影

### Q: 木剑操作无反应？

A: 确保手持木剑（minecraft:wooden_sword）且未在冷却中

### Q: 轻松放置不工作？

A: 确保已开启轻松放置模式，且当前有活动的投影

***

## 更新日志

### v2.2.0

- ✨ **超大型投影支持（Mega Schematic）**
  - 支持 500,000+ 方块的超大型投影
  - 分块存储系统（16x16x16 分块存储到磁盘）
  - 流式加载器（StreamingLitematicLoader），避免内存溢出
  - LRU 缓存（200 分块热数据缓存）
  - LOD 渲染系统（NEAR/MEDIUM/FAR 三级细节层次）
  - 视口裁剪（只加载玩家周围 96 格范围内的分块）
- ✨ **新增轻松放置 (Easy Place) 功能**
  - 自动选择正确方块
  - 潜影盒物品提取
  - 方块状态匹配
  - 错误操作阻止
- 🐛 修复粒子位置显示问题
- 🐛 修复层切换时状态同步问题
- 🐛 修复 GUI 删除投影错误
- 🔧 统一投影状态管理

### v2.0.0

- ✨ 全新架构重构
- 🎨 添加 GUI 菜单系统
- ⚡ 性能优化
- 🐛 Bug 修复

### v1.0.0

- 🎉 初始版本
- 基础投影功能

***

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

***

## 致谢

- [LeviLamina](https://github.com/LiteLDev/LeviLamina) - 服务端加载框架
- [Litematica](https://github.com/maruohon/litematica) - Java 版原理图工具（功能参考）

***

<p align="center">
  Made with ❤️ for Minecraft Bedrock Edition
</p>
