# Changelog

## [4.0.0] - 2026-11-25

从 LSE Node.js 插件（3.1.1）迁移为 LeviLamina 原生模组，使用 C++ 重构。

### Added

**投影显示与加载**
- 命令：`/lit list`、`/lit reload`（热重载映射表并清空状态解析缓存）、`/lit load <file> <x> <y> <z>`（控制台可用，发给所有在线玩家；无玩家时回报「已编码 N 包，未发送」）、`/lit info <file>`、`/lit unload`、`/lit layer <from> [to]`、`/lit rotate`（顺时针 90°，以 load 原点为锚，四次回原位）、`/lit resend`、`/lit probe`、`/lit diag`。
- 解析：`.litematic`（大端 NBT、多区域、`BlockStatePalette`、连续位流跨 long、跳过空气与结构空位）与 `.mcstructure`（小端 NBT、主层+液体层的 `block_indices`、状态键去 `minecraft:`、`flowing_water → water` 归一化），按扩展名自动分派。
- 显示通道：状态串 → `Block::mNetworkId`（BDS 注册表 + 进程内缓存）；16³ 子区块分组、单包 ≤1024 条，调用 `holo_core.dll` 的 C ABI 编码；varint 包头 + `NetworkPeer::sendPacket(Reliable, Compressible)`。
- 表面剔除：`core/schematic/OcclusionTable` + `resources/data/occlusion.json`（1160 个 Java 方块中 712 个不遮挡），不完整方块入表后其相邻面不再被判为被遮挡；`ghost/SurfaceCull` 去掉六邻居全遮挡的内部方块；`ghost/DispatchQueue` 按 tick 预算发包（默认 8 包/tick）。
- 多投影：`ProjectionManager` / `ProjectionSession`（`#id` + label，支持 `/lit projects`、`/lit select <id>`、`/lit remove <id>`）；显示层镜像（每玩家已收坐标集合）+ 编码缓存实现零开销重发；重发调度用 `ServerThreadExecutor::executeAfter` 1 秒轮询，以 `isDead()` 翻转判重生、位移 >64 格判传送，心跳 5 分钟兜底。
- 数据驱动方块映射 `mapping/GhostMap`：状态树 + `{state}` 模板 + `set` 覆盖，迁入旧表 1160 个方块 / 256 条状态树，C++ 不含方块硬编码。
- HologramLib 封装 `hologram/HologramFacade`：编译期直链 + 运行期能力分级（`batch-encoder` / `per-cell-override` / `none`），缺失时降级而非崩溃。

**放置**
- `/lit place [from] [to]`：覆盖式直接放置（目标位置已有非空气方块也照样写），按 y→x→z 自下而上，`setBlockAndRetainCompatibleBlockActor` 写入 + 区块补载 + 收尾抽样回读校验。
- 使用门槛 `config/place.json`：`requireAdmin`（需要管理员 / OP，默认关）、`requireCreative`（需要创造模式，默认开），由 `core::place::checkAccess` 在执行时判定，控制台不受限，改完 `/lit reload` 热重载。
- 候选链 `mapping::PlaceResolve`（原样 → `java_bedrock.json` → 规则变形 → 候选池近似 → 默认状态）+ Java 属性别名多套尝试 + 三级精度（原样 / 改名 / 仅默认状态），按状态串缓存；`mapping::BlockStateText` 与 `BlockStateResolve` 共用。
- 上限配置化 `config/projection.json`：`maxLoadBlocks`（`/lit load` 收集上限，默认 400000）、`maxPlaceBlocks`（`/lit place` 单次写入上限，默认 200000），缺字段补默认、`0` 与负数回落默认，`/lit reload` 一起热重载并回显当前两值。

**选区与保存**
- 手势：主手木剑右键方块两次定选区（500 ms 冷却、同维度校验，完成后报范围/尺寸/体积），潜行 + 右键清空，选区按玩家记录、下线清理；线框走 HologramLib `createBox`（六参 = 两角点，取 `min` 与 `max+1`），可配置关闭；与轻松放置共用同一个 `Item::useOn` hook（`easyplace::setUseOnInterceptor` 在 `origin()` 前拦截，不重复挂钩）。
- 命令：`/lit sel`、`/lit sel clear`、`/lit save stru|lite|both <名字>`（格式必须显式给，配置里没有默认格式）、`/lit saveat [stru|lite|both] <名字> <x1> <y1> <z1> <x2> <y2> <z2>`（控制台可用，默认带回读自检，省略格式按 `stru`）、`/lit savediag`、`/lit saveinfo`。
- 写入侧：`core/nbt/NbtWriter`（大端/小端序列化 + gzip，deflate 走 miniz）、`LitematicWriter`（大端 + gzip、位打包、`Region.Position = 0`、Metadata 全套）、`McstructureWriter`（小端、两层 int32 网格、调色板 0 号 air、`structure_world_origin` = 选区最小角、方块实体写 `block_position_data`）、`PaletteBits`（读写共用位宽规则）、`core/save/RegionScan`（主动拉区块、按 `BlockType`+`mData` 缓存状态提取）；`both` 只遍历一次世界。
- 状态提取：`BlockState::toNBT` 让引擎给出带类型的值（Byte/Int/String 保真），拿不到时退回整型并计入 `stateFallback`。
- 基岩 → Java：`mapping::BedrockToJava` + `resources/data/export_map.json`（楼梯/台阶/门/活板门/按钮/拉杆/铁轨/活塞/红石等族规则，活塞与按钮的水平四向按旧项目实测口径处理），表由 `tools/lit_tools/exportmap.py` 生成。
- 配置 `config/save.json`：两份体积上限、是否含方块实体、是否写液体层、`blockVersion` / `dataVersion`、同名不覆盖（默认报错）、`requireOp`（默认不要求）、选区线框开关与样式（`box` / `lines`）。
- 回读自检：写出的文件用本项目解析器读回，逐格比 `mSerializationIdHash`，输出一致率与首条不一致样例。

**材料清单导出**
- `/lit material`（别名 `mat` / `materials`）：把**当前选中**投影的方块按材料聚合，导出 `<模组目录>/exports/材料清单_<投影名>.xlsx`（同名覆盖）。
- 工作簿两张表：`材料清单`（序号 / 方块名 / 变体 / 数量 / 占比 / 可放置 / 状态串样例，首行冻结 + 自动筛选 + 末行合计）与 `投影信息`（投影名、文件、会话、方块总数、材料种类、状态数、层范围、当前显示层、旋转、导出时间、插件版本、统计口径）。
- 口径：统计整份投影（`mBlocks`），与当前显示层无关，空气在解析阶段已跳过；按「名字 + 材质变体」合并（`color` / `wood_type` / `stone_type` / `sand_type` / `dirt_type` 分开，朝向与开关不拆行）；`可放置` 取自会话加载时的 `mPaletteBlocks`，`投影信息` 同时给出不可放置格数。
- 新增 `core/report/XlsxWriter`（极简 OOXML：inlineStr + styles + 列宽 + 冻结窗格 + 自动筛选 + docProps，zip 用 miniz 在**内存**打包后按宽字符路径落盘）与 `core/report/MaterialCounter`（纯数据聚合，可脱离游戏回归）。

**投影打印机**
- `/lit printer`：以玩家为球心、半径 = `config/printer.json` 的 `range`（默认 5 格）按节拍把当前选中会话显示层的投影方块写进世界，写成功才扣料（生存 1 格 / 创造默认豁免），一轮一次背包同步，放完即 `markFilled` 让 ghost 层让位；不挂 hook，可与轻松放置同时开启。
- `respectPlayerBreaks` / `playerBreakCooldownMs`（默认开、3 s）：玩家刚挖掉的格在冷却期内不补回，避免「挖掉 → 秒补回 → 反复触发 ghost 补发」，也避免拆不掉打印区。
- `core/place/PlaceGuard`：轻松放置与打印机共用的程序化放置闸门（方块实体 / 多格 / 流体判定、方块↔物品匹配、可替换方块表），按 `BlockType` 指针缓存。

**可见性共享与木剑面板**
- `/lit share [on|off]`：每名玩家自选投影是否对他人可见，**默认全体共享**；判定集中在发包点（`ProjectionSession::visibleTo`），切成私有当场收回旁人屏幕上的 ghost 并丢掉他们排队未发的包（`DispatchQueue::dropPlayer`），切回共享立刻补发全体，无需重新 `load`；偏好按玩家名存 `config/share.json` 的 `private` 名单；控制台建的会话恒共享；私有会话不画包围盒线框。
- 木剑控制面板（`ui/`）：木剑**只作为投影控制器**，手持木剑**左键**（潜行与否都算）唤出多级表单，**右键功能完全不变**（选点 / 潜行右键清空），命令全部保留。
- 两条触发链路同时启用，靠 400 ms 冷却去重：`$handle(AnimatePacket)` 与 `easyplace` 的 `Player::useItem` 观察点（「右键空气」兜底）；动作推迟 50 ms 到下一拍执行。
- 面板 12 页：主菜单 / 投影管理 / 投影操作 / 新的投影 / 辅助功能 / 选区保存 / 保存设置 / 坐标选区 / 外观显示 / 分层显示 / 显示特定层 / 关于。
- 自证与回显：`triggerStats()` 把「收到的 Swing 包数」与「真正触发面板数」暴露到诊断页，首次真正触发写日志 `wooden sword gesture fired (via animate|useitem)`；`ui/ActionSink` 收集 `CommandOutput`，把「上次结果」排版进页顶，动作函数本身未改。
- 配套接口：`ProjectionManager::forEachSession(fn)`、`easyplace::setUseItemObserver()` / `hasUseItemObserver()`；「重新加载」只重发该会话当前显示层给本人（`ProjectionSession::sendCachedTo`）；左键切层已移除，层控制改走面板按钮。

**上传页与工具链**
- 内置 HTTP 上传页（`127.0.0.1:8686`，token 鉴权，拖拽上传到 `schematics/`，只落盘不自动加载）。
- `tools/build.ps1`（探测 MSVC 工具集，缺 v143 ATL 时借用同实例其它工具集的 `atlmfc`）、`tools/deploy.ps1`（备份 → 部署插件与 BP/RP → 校验 HologramLib 与 `holo_core.dll` → 检查世界包引用）、`tools/verify-stage-a.ps1`（自动启服 + `/lit probe` + 收日志 + 停服）。
- 离线回归：`tools/parse-check/`（合成最小 `.litematic` 逐方块对拍）、`tools/write-check/`（合成区域 → 写两种格式 → 读回逐格比对，696 项检查全通过）、`tools/xlsx-check/`（C++ 断言聚合口径 + openpyxl 逐格校验生成文件）、`tools/lit_tools/`（`mapgen.py` / `fixture.py` / `exportmap.py`）；环境变量 `LITEMATICABE_SELF_TEST` 无人值守自检写 `data/selftest.log`。
- 版本真源 `src/LitematicaBE/Version.h`（`kVersion` / `kTargetBaseline`），打包器 `modName` / `modVersion` / `modPlatform` 走 extraconf 显式给出并与四处真源一起由 `lit-tools version` 校验。
- 资源包 `resources/addon/`：沿用已验证的 `lit:g_*` 假方块定义（1277 个）及贴图/模型/粒子。

### Changed

- 构建体系：xmake 目标由模板的 `my-mod` 改为 `LitematicaBE`，只保留 server 变体；`lip.toml` 从双变体收敛为单 `server` 变体。
- 目标基线固定为 BDS 1.21.132.x / LeviLamina 1.9.9 / HologramLib 21.132.1。
- 依赖 HologramLib 的方式从 lrca 运行期 `ll.import` 改为编译期头文件 + 导入库直链；`manifest.json` 声明依赖，避免加载顺序导致符号解析失败。
- `/lit replace` 改名为 `/lit place`，旧的「只填空位」`/lit place` 删除，直接放置语义固定为覆盖式。
- `[wireframe] lines built: (x1,y1,z1)-(x2,y2,z2)` 从 INFO 降为 DEBUG（设 `LITEMATICABE_WIREFRAME_LOG=1` 恢复 INFO），README 补上 `/lit box` 与 `LITEMATICABE_NO_WIREFRAME` / `LITEMATICABE_WIREFRAME_LOG` 的说明。
- 路径输出统一走 UTF-8。

### Fixed

- **面板一点按钮服务端就崩（0xC0000005，`_List_node_emplace_op2`）**：表单回调来自网络线程，`summon()` 走主线程，两边同时在 `MenuState::mStates` 插入写坏了 MSVC `unordered_map` 的 list 节点指针。现在表单回调（含四个 CustomForm）一律投递回 `ServerThreadExecutor` 再执行；`AnimatePacket` hook 完全不碰玩家对象，只把 `runtimeId` 带到主线程再解析实体；`MenuState` 的插入/删除加 `std::mutex` 兜底；删掉只写不读的死字段 `showing`。
- **木剑面板进不了二级菜单、此后主菜单也唤不出**：`SimpleForm` 点按钮客户端会立即关闭表单再回响应，`sendUpdate` 在这套交互里不成立。现在回调第一件事 `showing = false`，并一律 `sendTo`。
- **木剑面板第一版的 `Actor::swing` hook 会让服务端启动后崩溃（0xC0000005）**：`&::Actor::$swing` 能解析到符号但签名与 LL 头文件不符，`origin()` 按错误调用约定读参数（崩在 `detour+0x23`）。改用 `easyplace` 已跑稳的 `Player::useItem` hook 加只读观察点，手势改为「手持木剑右键空气」。
- **打印出的方块被挖掉后出现「客户端 ghost + 服务端真方块」叠加态**：挖掉触发的 ghost 补发有 150 ms 延迟，打印机的 100 ms 节拍会在窗口内把该格重新填成真方块。现在补发前先看该格是否已重新填充（`isFilled`）并按玩家自己的维度确认该格仍是空气，不满足就不发；`requestRepaint` 同时记下破坏时间戳。
- **`.litematic` 按大端 NBT 解析**：Litematica 是 Java 工具、NBT 为大端，此前按小端读导致「缺少 Regions」；解析器现支持两种字节序（`.mcstructure` 的小端入口已预留）。
- **中文投影名「未找到该文件」**：`std::filesystem::path{std::string}` 按 CP_ACP 解释入参会抛 `std::system_error`；改为按 UTF-8 / 936 / 1252 多代码页解释 + Latin-1 双跳还原，并加目录扫描兜底（忽略大小写、可省略扩展名）。新增 `core/util/TextEncoding`（`toUtf8` / `fromUtf8` / `fromAcp` / `sanitizeUtf8`，失败返回空 path 不抛异常），`/lit` 回调统一 `guard()` 把异常转成聊天栏错误 `§c内部错误§r：<原因>`。
- 上传页对 `.NET HttpClient` 的 `filename=x`（不带引号）解析失败，现在带引号与不带引号两种 multipart 都能识别。
- 含中文路径时 `path.string()` 会抛异常，日志、映射表/遮挡表/NBT 错误信息、上传列表统一改 UTF-8 输出。

