# LitematicaBE

<img src="https://img.shields.io/badge/version-2.4.0-blue" alt="Version">
<img src="https://img.shields.io/badge/BDS-1.21.1-green" alt="BDS Version">
<img src="https://img.shields.io/badge/LeviLamina-0.13.5+-orange" alt="LeviLamina">

基岩版 Litematica 投影插件，支持加载 Java 版 `.litematic` 文件并在基岩版世界中显示为粒子投影。

## ✨ 功能特性

### 🔥 核心功能

- **原理图加载** — 支持 Java 版 `.litematic` 格式
- **原理图保存** — 将基岩版世界中的建筑保存为 `.litematic` 文件，与 Java 版互通
- **粒子投影** — 在世界中显示半透明全息投影，不修改实际方块
- **逐层建造** — 按 Y 层切换显示，抬头/低头即可切换
- **旋转操作** — 支持 90° 倍数旋转投影
- **木剑快捷操作** — 手持木剑进行所有操作，无需频繁输入指令

### 🎮 操作方式

| 操作       | 说明                 |
| -------- | ------------------ |
| 手持木剑点击投影 | 打开操作菜单             |
| 抬头/低头    | 切换显示层级（当开启逐层模式时）   |
| 主菜单      | 加载/卸载原理图、调整设置、切换模式 |

### 📊 显示模式

- **完整模式** — 显示投影全部内容
- **逐层模式** — 只显示当前 Y 层，方便逐层建造
- **Ghost 模式** — 半透明显示，可穿透查看

### 🚀 性能优化

- **Mega 模式** — 针对超大型原理图优化，使用分块存储和流式加载
- **LOD 渲染** — 远距离降低渲染密度，提升性能
- **智能裁剪** — 只渲染玩家视野内的方块

## 📦 安装

### 前置要求

- [LeviLamina](https://github.com/LiteLDev/LeviLamina) 0.13.5 或更高版本
- [legacy-script-engine-nodejs](https://github.com/LiteLDev/legacy-script-engine-nodejs) 插件

### 安装步骤

1. 下载最新版本的 `LitematicaBE.zip`
2. 解压到 BDS 的 `plugins/` 目录下
3. 重启服务器
4. 将 `.litematic` 文件放入 `plugins/LitematicaBE/schematics/` 目录

## 📝 使用指南

### 加载原理图

1. 进入游戏，手持木剑
2. 输入 `/litematica` 或点击地面打开主菜单
3. 选择"加载原理图"
4. 选择要加载的文件
5. 投影将显示在当前位置

### 保存原理图

1. 手持木剑，输入 `/litematica save` 或从菜单选择"保存原理图"
2. 点击"开始选区"
3. 用木剑右键点击选择第一个坐标点（pos1）
4. 用木剑右键点击选择第二个坐标点（pos2）
5. 输入原理图名称和描述，点击保存
6. 文件将保存到 `plugins/LitematicaBE/schematics/` 目录

   <br />

## 🔧 配置文件

`config.json`：

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
    "chunkSize": 16,
    "maxMemoryChunks": 100
  }
}
```

## 📂 目录结构

```
plugins/LitematicaBE/
├── manifest.json          # 插件清单
├── index.js               # 主入口
├── config.json            # 配置文件
├── schematics/            # 原理图文件目录
├── exports/               # 导出文件目录
└── src/                   # 源代码
    ├── core/              # 核心模块
    ├── data/              # 数据模块
    ├── easyplace/         # 轻松放置模块
    ├── render/            # 渲染模块
    ├── ui/                # UI模块
    └── utils/             # 工具模块
```

## 🔄 更新日志

### v2.4.0

- ✨ **原理图保存功能** — 将基岩版世界中的建筑保存为 Java 版 Litematica 兼容的 `.litematic` 文件
  - 选区工具：使用木剑右键选取两个坐标点
  - 完整的方块名称映射（基岩版 → Java 版）
  - 方块状态自动转换
- ✨ **NBT 序列化器** — 自定义 NBTWriter，完全兼容 Java 版 Litematica 格式
- 🔧 修复 LitematicLoader 对 TAG\_Int\_Array 格式 Size/Position 的解析问题

### v2.3.0

- 🔧 **Mega 模式架构重构** — 渲染统一由 ProjectionRenderer 处理，Mega 模式只负责 LOD 分块管理
- 🐛 修复 Mega 投影无粒子渲染的问题
- 🐛 修复 Mega 模式下切换层不显示的问题
- 🐛 修复 Mega 模式重复渲染导致性能问题
- 🐛 修复 StreamingLitematicLoader 数组类型解析错误（0 blocks / 空 chunks）
- 🐛 修复 parseCompoundLite 偏移量丢失问题
- ✨ 新增 ProjectionRenderer.updateBlocks() 数据源接口

### v2.2.0

- ✨ **Mega 模式** — 支持超大型原理图（100万+方块）
- ✨ **流式加载** — 异步加载，不阻塞游戏
- ✨ **分块存储** — 内存不足时自动转存磁盘

### v2.1.0

- ✨ **轻松放置模式** — 快速放置方块匹配投影
- ✨ **方块验证** — 检查放置是否正确
- ✨ **材料清单** — 统计所需材料

### v2.0.0

- ✨ 全新架构，支持 LeviLamina
- ✨ 粒子投影系统
- ✨ 木剑快捷操作
- ✨ 逐层建造模式

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [Litematica](https://github.com/maruohon/litematica) — Java 版原理图模组
- [LeviLamina](https://github.com/LiteLDev/LeviLamina) — 基岩版模组加载器

