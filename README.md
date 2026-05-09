# LitematicaBE

<p align="center">
  <img src="https://img.shields.io/badge/version-2.3.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-Bedrock%20Edition-brightgreen" alt="Platform">
  <img src="https://img.shields.io/badge/LeviLamina-1.9.x-orange" alt="Framework">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

<p align="center">
  <strong>Minecraft Bedrock Edition 建筑投影工具 — 让你的建筑效率翻倍</strong>
</p>

<p align="center">
  支持加载 Java 版 Litematica 原理图，通过粒子系统在游戏中显示全息投影，辅助逐层建造。
  <br>
  内置轻松放置功能，自动从背包选择正确方块，大幅提升建造效率。
</p>

***

## 功能特性

### 🔥 核心功能

- **原理图加载** — 支持 Java 版 `.litematic` 格式
- **粒子投影** — 在世界中显示半透明全息投影，不修改实际方块
- **逐层建造** — 按 Y 层切换显示，抬头/低头即可切换
- **旋转操作** — 支持 90° 倍数旋转投影
- **木剑快捷操作** — 手持木剑进行所有操作，无需频繁输入指令

### ⚡ 超大型投影（Mega Schematic）

- 支持 **10,000,000+ 方块**的超大型建筑投影
- 分块存储（16×16×16），内存占用恒定不随投影大小增长
- LOD 三级细节层次渲染（NEAR / MEDIUM / FAR）
- 视口自动裁剪，只加载玩家周围可见分块
- 与普通投影**完全相同的渲染效果和交互体验**

### 🎯 轻松放置（Easy Place）

- 自动从背包选择正确方块类型
- 支持潜影盒内方块自动提取
- 方块状态精确匹配（方向、朝向等）
- 错误放置自动阻止并提示

### ✨ 其他特性

- **GUI 菜单** — 游戏内可视化操作界面
- **全服共享** — 投影对所有玩家可见
- **材料清单导出** — 导出为 Excel 格式
- **范围提示** — 进入投影范围自动提示

***

## 安装要求

| 依赖                          | 版本     |
| --------------------------- | ------ |
| BDS                         | 1.21.x |
| LeviLamina                  | 1.9.x  |
| legacy-script-engine-nodejs | 0.17.x |

**客户端需安装资源包** — 包含 658+ 方块纹理粒子，否则粒子不显示。

***

## 安装步骤

1. 将 `LitematicaBE` 文件夹复制到 `bedrock-server/plugins/`
2. 将 `.litematic` 原理图文件放入 `plugins/LitematicaBE/schematics/`
3. 将资源包 `LitematicaBE.mcpack` 导入游戏客户端并启用
4. 启动服务器

```
bedrock-server/
├── plugins/
│   ├── LeviLamina/
│   ├── legacy-script-engine-nodejs/
│   └── LitematicaBE/
│       ├── manifest.json
│       ├── index.js
│       ├── src/
│       │   ├── core/
│       │   ├── data/
│       │   ├── easyplace/
│       │   ├── render/
│       │   └── ui/
│       └── schematics/
│           └── my_build.litematic
```

***

## 使用方法

### 命令列表

| 命令                                | 说明        |
| --------------------------------- | --------- |
| `/litematica` 或 `/lit`            | 打开主菜单     |
| `/litematica load <文件名>`          | 加载原理图文件   |
| `/litematica place`               | 在脚下放置投影   |
| `/litematica placeat <x> <y> <z>` | 在指定坐标放置投影 |
| `/litematica build`               | 切换到逐层建造模式 |
| `/litematica rotate`              | 切换到旋转模式   |
| `/litematica easyplace`           | 切换轻松放置模式  |
| `/litematica clear`               | 清除当前投影    |
| `/litematica list`                | 列出所有投影    |
| `/litematica info`                | 查看当前投影信息  |
| `/litematica remove <ID>`         | 删除指定投影    |
| `/litematica:config get <key>`    | 查看配置项     |

### 木剑操作

| 操作      | 模式   | 效果      |
| ------- | ---- | ------- |
| 手持木剑点击  | 放置模式 | 放置投影    |
| 手持木剑点击  | 旋转模式 | 旋转 90°  |
| 抬头 + 点击 | 建造模式 | 上一层     |
| 低头 + 点击 | 建造模式 | 下一层     |
| 平视 + 点击 | 建造模式 | 全部/单层切换 |
| 蹲下 + 点击 | 任意模式 | 打开菜单    |

***

## 版本更新

### v2.3.0

- 🔧 **Mega 模式架构重构** — 渲染统一由 ProjectionRenderer 处理，Mega 模式只负责 LOD 分块管理
- 🐛 修复 Mega 投影无粒子渲染的问题
- 🐛 修复 Mega 模式下切换层不显示的问题
- 🐛 修复 Mega 模式重复渲染导致性能问题
- 🐛 修复 StreamingLitematicLoader 数组类型解析错误（0 blocks / 空 chunks）
- 🐛 修复 parseCompoundLite 偏移量丢失问题
- ✨ 新增 ProjectionRenderer.updateBlocks() 数据源接口

### v2.2.0

- ✨ 超大型投影支持（Mega Schematic），支持 500,000+ 方块
- ✨ 流式加载器（StreamingLitematicLoader），避免内存溢出
- ✨ LOD 三级细节层次渲染
- ✨ 新增轻松放置功能（自动选方块、潜影盒提取）
- 🐛 修复粒子位置、层切换、GUI 删除等多个问题

### v2.0.0

- ✨ 全新架构重构
- 🎨 GUI 菜单系统
- ⚡ 性能优化

***

## 许可证

MIT License

***

<p align="center">
  Made with ❤️ for Minecraft Bedrock Edition
</p>
