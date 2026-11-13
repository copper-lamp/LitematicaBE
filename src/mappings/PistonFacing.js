/**
 * PistonFacing.js — 活塞族的 facing_direction 专用映射（唯一真源）
 *
 * 为什么必须单独一张表：基岩版里 `facing_direction` **同名不同义**。
 *   · 官方 addon 文档（自定义方块 / 命令状态）：
 *       0=down 1=up 2=north 3=south 4=west 5=east        ← 全项目原先统一用的这张
 *   · 活塞 / 黏性活塞 / 活塞臂 在存档与 `.mcstructure` 里实测：
 *       0=down 1=up 2=south 3=north 4=east 5=west        ← 本文件
 *     两者只有竖直两档（0/1）相同，水平四档整体相反（2↔3、4↔5）。
 *
 * 判据（结构自证，不依赖任何文档）：活塞头格必然位于本体的**推出方向**上。
 *   拿 `双模式刷石.mcstructure` 的 28 个 `*_arm_collision` 反推相邻本体，得到：
 *       fd=0 → down(16 例)   fd=1 → up(7 例)
 *       fd=3 → north(2 例)   fd=4 → east(2 例)   fd=5 → west(2 例)
 *   与官方 addon 表的 north/south、west/east 正好互换，与 wiki 活塞页的旧 aux 编码一致。
 *
 * 影响：用通用表会让活塞的水平四朝向全部反 180°，表现为实机「南北头底调换、东西头底调换」。
 *
 * 其它方块（发射器 / 投掷器 / 观察者 / 漏斗 / 紫水晶…）是否同族**尚未验证**，
 * 仍沿用 `BlockStateConverters` 里的通用表，逐个实机确认后再加进来。
 *
 * @module mappings/PistonFacing
 */

/** 活塞族 facing_direction 取值（实测语义） */
const PISTON_FACING = {
    DOWN: 0,
    UP: 1,
    SOUTH: 2,
    NORTH: 3,
    EAST: 4,
    WEST: 5,
};

/** fd -> 方向名（实测语义） */
const PISTON_FACING_NAME = ['down', 'up', 'south', 'north', 'east', 'west'];

/** fd -> 推出方向向量（x, y, z） */
const PISTON_FACING_VEC = [
    [0, -1, 0],  // 0 down
    [0, 1, 0],   // 1 up
    [0, 0, 1],   // 2 south
    [0, 0, -1],  // 3 north
    [1, 0, 0],   // 4 east
    [-1, 0, 0],  // 5 west
];

/** Java facing 字符串 -> 活塞 fd */
const JAVA_TO_PISTON_FACING = {
    down: PISTON_FACING.DOWN,
    up: PISTON_FACING.UP,
    south: PISTON_FACING.SOUTH,
    north: PISTON_FACING.NORTH,
    east: PISTON_FACING.EAST,
    west: PISTON_FACING.WEST,
};

/** 活塞 fd -> Java facing 字符串 */
const PISTON_FACING_TO_JAVA = {
    0: 'down', 1: 'up', 2: 'south', 3: 'north', 4: 'east', 5: 'west',
};

/** 方向名 -> 向量（与 PISTON_FACING_VEC 自洽，供断言用） */
const NAME_TO_VEC = {
    down: [0, -1, 0], up: [0, 1, 0],
    south: [0, 0, 1], north: [0, 0, -1],
    east: [1, 0, 0], west: [-1, 0, 0],
};

/** 名字是否属于活塞族（活塞本体 / 活塞头 / 活塞臂 / 移动中的活塞壳） */
function isPistonName(name) {
    if (!name || typeof name !== 'string') return false;
    const n = name.toLowerCase();
    return n.includes('piston');
}

/**
 * 收缩态：fd → 六个面该用哪个材质槽。
 *
 * 规则：推面 = 推出方向那一面（top_carried），背面 = 对侧（bottom），
 *       其余四面用四向侧图，木条一律指向推面。
 *
 * 侧图的选取依据（doc 1.6 的 u/v 世界方向表 + 实拍确认的 side_* 语义）：
 *   · 侧面 north：u 增大朝西，v 增大朝下
 *   · 侧面 south：u 增大朝东，v 增大朝下
 *   · 侧面 east ：u 增大朝北，v 增大朝下
 *   · 侧面 west ：u 增大朝南，v 增大朝下
 *   · up / down：比侧面整体旋转 180°（贴图上方→北、下方→南、左侧→东、右侧→西）
 *
 * 「木条朝 X」= 贴图上木条那 4px 落在靠近 X 的那一端；
 *   side_up/side_down/side_left/side_right 指木条在贴图的**上/下/左/右**侧（二维命名，与三维无关）。
 *
 * 目标态已与实机校准一致（「朝北/朝南」行做 180° 翻转 + up/down 换图；「朝东/朝西」行只翻南北侧与东西头底）。
 *
 * 实机补丁（2026-11-11）：**up 面与 down 面的方向约定不同**，不能按「同一张图」处理。
 * 南北两行的 up 面需再翻一次（up 用与 down 相反的侧图）：fd2 up=side_up、fd3 up=side_down。
 * 东西两行的 up/down 实测一致，保持不变。改 up/down 前务必分别实机确认，不要按对称性推导。
 */
const PISTON_SIDE_FACES = {
    // fd=0 down：推面 down，背面 up，四壁木条朝下
    0: { north: 'side_down', south: 'side_down', east: 'side_down', west: 'side_down', up: 'bottom', down: 'top_carried' },
    // fd=1 up：推面 up，背面 down，四壁木条朝上
    1: { north: 'side_up', south: 'side_up', east: 'side_up', west: 'side_up', up: 'top_carried', down: 'bottom' },
    // fd=2 south：推面 south，背面 north；木条朝南 → east 左侧、west 右侧；up 需翻（实机）、down 用下方
    2: { north: 'bottom', south: 'top_carried', east: 'side_left', west: 'side_right', up: 'side_up', down: 'side_down' },
    // fd=3 north：推面 north，背面 south；木条朝北 → east 右侧、west 左侧；up 需翻（实机）、down 用上方
    3: { north: 'top_carried', south: 'bottom', east: 'side_right', west: 'side_left', up: 'side_down', down: 'side_up' },
    // fd=4 east：推面 east，背面 west；木条朝东 → north 左侧、south 右侧、up/down 左侧
    4: { north: 'side_left', south: 'side_right', east: 'top_carried', west: 'bottom', up: 'side_left', down: 'side_left' },
    // fd=5 west：推面 west，背面 east；木条朝西 → north 右侧、south 左侧、up/down 右侧
    5: { north: 'side_right', south: 'side_left', east: 'bottom', west: 'top_carried', up: 'side_right', down: 'side_right' },
};

/** 四向侧图（有木条方向语义的材质槽） */
const SIDE_MATERIALS = ['side_up', 'side_down', 'side_left', 'side_right'];

module.exports = {
    PISTON_FACING,
    PISTON_FACING_NAME,
    PISTON_FACING_VEC,
    PISTON_FACING_TO_JAVA,
    JAVA_TO_PISTON_FACING,
    NAME_TO_VEC,
    PISTON_SIDE_FACES,
    SIDE_MATERIALS,
    isPistonName,
};
