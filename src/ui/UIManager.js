// UIManager - UI管理器
// 处理GUI表单、屏幕提示、ActionBar消息等

const fs = require('fs');
const path = require('path');
const { bidirectionalConverter } = require('../mappings/BidirectionalBlockConverter');
// 坐标解析唯一实现（表单输入 / 命令文本 / `~` 相对坐标）
const { toIntOr, clampCoord } = require('../utils/coordText');
// 国际化：t 按玩家语言取翻译，tell 翻译后发聊天栏（UI 文本也走 t）
const { tell, t } = require('../i18n/I18n');

/**
 * 玩家所在维度 ID。LSE 的 Player 没有 dim 属性，维度信息在 FloatPos 上
 * （pos.dim 是文字名，pos.dimid 是 0/1/2 的数字 ID）。
 */
function dimidOf(player) {
    const d = player && player.pos && player.pos.dimid;
    return typeof d === 'number' ? d : 0;
}

/**
 * 保存投影的导出格式选项（顺序即表单下拉下标）
 * 逻辑是「先定格式，再走对应链路」：不是先扫一遍再决定怎么翻译。
 */
const SAVE_FORMAT_OPTIONS = [
    { format: 'litematic', labelKey: 'ui.save.format.litematic' },
    { format: 'mcstructure', labelKey: 'ui.save.format.mcstructure' },
    { format: 'both', labelKey: 'ui.save.format.both' }
];

/** 字节数 → 人类可读 */
function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

class UIManager {
    constructor() {
        this.actionBarMessages = new Map();
        this.lastVerifyResults = new Map();
        this.schematicsDir = './plugins/LitematicaBE/schematics/';
        // 不再自行监听 onTick：actionBar 刷新由统一调度器的 'actionbar'
        // 任务驱动（index.js 注册，每 2 tick = 100ms），全插件仅保留一个 onTick。
        this._actionBarLoopStarted = false;
        this.ensureSchematicsDir();
    }

    // 确保原理图目录存在
    ensureSchematicsDir() {
        if (!fs.existsSync(this.schematicsDir)) {
            fs.mkdirSync(this.schematicsDir, { recursive: true });
            logger.info(`[UIManager] 创建原理图目录: ${this.schematicsDir}`);
        }
    }

    // 列出所有原理图文件
    listSchematics() {
        const schematics = [];
        
        try {
            if (!fs.existsSync(this.schematicsDir)) {
                return schematics;
            }

            const files = fs.readdirSync(this.schematicsDir);
            
            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (ext === '.litematic' || ext === '.mcstructure') {
                    const name = path.basename(file, ext);
                    schematics.push({
                        name: name,
                        file: file,
                        type: ext === '.mcstructure' ? 'mcstructure' : 'litematic'
                    });
                }
            }
        } catch (e) {
            logger.error(`[UIManager] 读取原理图目录失败: ${e.message}`);
        }
        
        return schematics;
    }

    /**
     * 独立使用（不经过统一调度器）时的降级入口。
     * 正常装配下 index.js 已把 updateActionBars 注册成调度器任务，这里不该被调用。
     */
    startActionBarLoop() {
        if (this._actionBarLoopStarted) return;
        const sched = (typeof global !== 'undefined') ? global.renderScheduler : null;
        if (sched && sched.has && sched.has('actionbar')) return;   // 已由调度器接管
        this._actionBarLoopStarted = true;
        mc.listen('onTick', () => {
            this.updateActionBars();
        });
    }

    updateActionBars() {
        for (const [xuid, message] of this.actionBarMessages) {
            const player = mc.getPlayer(xuid);
            if (player) {
                player.setTitle(message, 3);
            }
        }
    }

    setActionBar(player, message) {
        this.actionBarMessages.set(player.xuid, message);
    }

    clearActionBar(player) {
        this.actionBarMessages.delete(player.xuid);
    }

    showMainMenu(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('Litematica BE');
        fm.setContent(t(player, 'ui.menu.content'));

        fm.addButton(t(player, 'ui.menu.load'));
        fm.addButton(t(player, 'ui.menu.save'));
        fm.addButton(t(player, 'ui.menu.manage'));
        fm.addButton(t(player, 'ui.menu.ops'));
        fm.addButton(t(player, 'ui.menu.about'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') return;

            switch (data) {
                case 0:
                    this.showLoadProjection(player);
                    break;
                case 1:
                    this.showSaveSchematicMenu(player);
                    break;
                case 2:
                    this.showProjectionManage(player);
                    break;
                case 3:
                    this.showProjectionOperations(player);
                    break;
                case 4:
                    this.showAbout(player);
                    break;
            }
        });
    }

    showAbout(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.about.title'));
        fm.setContent(t(player, 'ui.about.content'));
        fm.addButton(t(player, 'ui.menu.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') return;   // 取消表单：LSE 可能回 null 也可能回 undefined
            this.showMainMenu(player);
        });
    }

    // ==================== 保存原理图菜单 ====================

    showSaveSchematicMenu(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.save.title'));
        fm.setContent(t(player, 'ui.save.menu.content'));

        fm.addButton(t(player, 'ui.save.menu.start'));
        fm.addButton(t(player, 'ui.menu.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showMainMenu(player);
                return;
            }

            switch (data) {
                case 0:
                    this.startSchematicSelection(player);
                    break;
                case 1:
                default:
                    this.showMainMenu(player);
                    break;
            }
        });
    }

    startSchematicSelection(player) {
        const selectionTool = global.selectionTool;
        if (!selectionTool) {
            tell(player, 'ui.save.errTool');
            return;
        }

        selectionTool.startSelection(player);
        //player.tell('§a选区模式已启动');
        //player.tell('§7使用木剑右键点击方块选择坐标');
    }

    /**
     * 选择默认导出格式下标（config.schematicSave.defaultFormat）
     */
    defaultSaveFormatIndex() {
        let raw = 'litematic';
        const cm = global.configManager;
        if (cm && typeof cm.get === 'function') {
            try {
                raw = String(cm.get('schematicSave.defaultFormat', 'litematic') || 'litematic').toLowerCase();
            } catch (e) { /* 用默认值 */ }
        }
        const i = SAVE_FORMAT_OPTIONS.findIndex((o) => o.format === raw);
        return i >= 0 ? i : 0;
    }

    /**
     * 解析下拉框回传值 → 格式下标
     * 正常是数字索引；某些 LSE 版本可能回传字符串/选项文本，这里一并兼容，
     * 避免"选了 mcstructure 却静默按默认格式导出"。
     */
    resolveSaveFormatIndex(raw, player) {
        const n = SAVE_FORMAT_OPTIONS.length;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            const i = Math.trunc(raw);
            return i >= 0 && i < n ? i : this.defaultSaveFormatIndex();
        }
        if (typeof raw === 'string') {
            const s = raw.trim();
            if (/^\d+$/.test(s)) {
                const i = Number(s);
                if (i >= 0 && i < n) return i;
            }
            const byLabel = SAVE_FORMAT_OPTIONS.findIndex((o) => t(player, o.labelKey) === s);
            if (byLabel >= 0) return byLabel;
            const byFormat = SAVE_FORMAT_OPTIONS.findIndex((o) => o.format === s.toLowerCase());
            if (byFormat >= 0) return byFormat;
        }
        return this.defaultSaveFormatIndex();
    }

    /**
     * 选区体积信息（**纯算术，不读方块**）
     * 优先用 SchematicSaver 的实时配置计算；没有 saver 时本地兜底。
     */
    saveVolumeInfo(region) {
        const saver = global.schematicSaver;
        if (saver && typeof saver.checkMcstructureVolume === 'function') {
            try { return saver.checkMcstructureVolume(region); } catch (e) { /* 落本地兜底 */ }
        }
        const dims = {
            x: Math.abs(region.maxX - region.minX) + 1,
            y: Math.abs(region.maxY - region.minY) + 1,
            z: Math.abs(region.maxZ - region.minZ) + 1
        };
        const volume = dims.x * dims.y * dims.z;
        return { ok: volume <= 1000000, volume, maxVolume: 1000000, dimensions: dims, estimatedBytes: volume * 8 };
    }

    /**
     * 显示保存原理图UI表单（选区完成后调用）
     * 流程：**先选格式** → 体积校验（超限直接截停，不读方块）→ 扫描 → 输出
     */
    showSaveSchematicForm(player, region) {
        const fm = mc.newCustomForm();
        fm.setTitle(t(player, 'ui.save.formTitle'));

        const info = this.saveVolumeInfo(region);
        const dimsText = `${info.dimensions.x}×${info.dimensions.y}×${info.dimensions.z}`;

        // 控件顺序 = 回调 data 下标：格式(0) → 名称(1) → 描述(2)；label 一律后置
        fm.addDropdown(t(player, 'ui.save.format.label'), SAVE_FORMAT_OPTIONS.map((o) => t(player, o.labelKey)), this.defaultSaveFormatIndex());
        fm.addInput(t(player, 'ui.save.name.label'), t(player, 'ui.save.name.placeholder'), '');
        fm.addInput(t(player, 'ui.save.desc.label'), t(player, 'ui.save.desc.placeholder'), '');

        fm.addLabel(t(player, 'ui.save.rangeLabel',
            region.minX, region.minY, region.minZ, region.maxX, region.maxY, region.maxZ,
            dimsText, info.volume, player.name));
        fm.addLabel(t(player, 'ui.save.sizeOk', formatBytes(info.estimatedBytes), info.maxVolume) +
            (info.ok ? '' : t(player, 'ui.save.sizeOver')));

        player.sendForm(fm, (player, data) => {
            if (!Array.isArray(data)) {
                tell(player, 'ui.save.cancelled');
                const selectionTool = global.selectionTool;
                if (selectionTool) selectionTool.cleanup(player.xuid);
                return;
            }

            const formatIdx = this.resolveSaveFormatIndex(data[0], player);
            const format = (SAVE_FORMAT_OPTIONS[formatIdx] || SAVE_FORMAT_OPTIONS[0]).format;
            const fileName = data[1] ? String(data[1]).trim() : '';
            const description = data[2] ? String(data[2]).trim() : '';

            if (!fileName) {
                tell(player, 'ui.save.errName');
                this.showSaveSchematicForm(player, region);
                return;
            }

            // 验证文件名
            if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(fileName)) {
                tell(player, 'ui.save.errNameChars');
                this.showSaveSchematicForm(player, region);
                return;
            }

            // 体积截停：发生在任何 mc.getBlock 之前（实时读配置，防停留在表单期间改过上限）
            if (format !== 'litematic') {
                const fresh = this.saveVolumeInfo(region);
                if (!fresh.ok) {
                    tell(player, 'ui.save.overVolume',
                        fresh.dimensions.x, fresh.dimensions.y, fresh.dimensions.z, fresh.volume,
                        fresh.maxVolume, formatBytes(fresh.estimatedBytes));
                    tell(player, 'ui.save.overVolumeHint');
                    this.showSaveSchematicForm(player, region);
                    return;
                }
            }

            this.doSaveSchematic(player, region, fileName, description, format);
        });
    }

    /**
     * 执行保存原理图
     * @param {string} format litematic | mcstructure | both
     */
    async doSaveSchematic(player, region, fileName, description, format = 'litematic') {
        const schematicSaver = global.schematicSaver;
        const selectionTool = global.selectionTool;

        if (!schematicSaver) {
            tell(player, 'ui.save.errNoSaver');
            return;
        }

        const fmtLabel = format === 'both' ? t(player, 'ui.save.fmtBoth') : (format === 'mcstructure' ? '.mcstructure' : '.litematic');
        tell(player, 'ui.save.scanning', fmtLabel);

        try {
            const result = await schematicSaver.save(
                region,
                dimidOf(player),
                fileName,
                player.name,
                description,
                format
            );

            tell(player, 'ui.save.done');
            for (const r of (result.results || [])) {
                const extra = r.bytes ? t(player, 'ui.save.resultExtra', formatBytes(r.bytes)) : '';
                tell(player, 'ui.save.resultFile', r.fileName, extra);
            }
            for (const f of (result.failures || [])) {
                tell(player, 'ui.save.resultFail', f.format, f.error);
            }
            tell(player, 'ui.save.blockCount', result.blockCount);
            tell(player, 'ui.save.dims', result.dimensions.x, result.dimensions.y, result.dimensions.z);
            if (format !== 'litematic') {
                tell(player, 'ui.save.mcstructureHint');
            }

            // 清理选区状态
            if (selectionTool) selectionTool.cleanup(player.xuid);

        } catch (e) {
            tell(player, 'ui.save.failed', e.message);
            logger.error(`[UIManager] saveSchematic error: ${e.message}`);
            logger.error(`[UIManager] Stack: ${e.stack}`);
        }
    }

    showSchematicBrowser(player, onSelect = null) {
        // 直接读取 schematics 目录
        const schematics = this.listSchematics();
        if (schematics.length === 0) {
            tell(player, 'ui.browser.empty');
            tell(player, 'ui.browser.emptyHint');
            this.showMainMenu(player);
            return;
        }

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.browser.title'));
        fm.setContent(t(player, 'ui.browser.content', schematics.length));

        for (const schem of schematics) {
            fm.addButton(`${schem.name}\n${t(player, 'ui.browser.format', schem.type.toUpperCase())}`);
        }

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showMainMenu(player);
                return;
            }

            const selected = schematics[data];
            this.loadAndPlaceSchematic(player, selected);
        });
    }

    // 显示投影放置面板
    showPlacementPanel(player, schematic, loadedSchematic) {
        const pos = player.pos;
        const defaultX = Math.floor(pos.x);
        const defaultY = Math.floor(pos.y) - 1;
        const defaultZ = Math.floor(pos.z);

        const fm = mc.newCustomForm();
        fm.setTitle(t(player, 'ui.place.title'));

        // ⚠ 坐标输入必须是表单的**前三个控件**。
        //   CustomForm 回调的 data 按控件顺序排列，但 label 是否占位在不同 LSE 版本/实现下
        //   并不稳定：一旦 label 不占位，按"label 个数"取下标就会取到 null → 全部回退成
        //   玩家位置（历史 bug：设置坐标无效）。input 前置后 data[0..2] 恒为 X/Y/Z，
        //   与 label 数量彻底解耦。
        fm.addInput('X', `${defaultX}`, `${defaultX}`);
        fm.addInput('Y', `${defaultY}`, `${defaultY}`);
        fm.addInput('Z', `${defaultZ}`, `${defaultZ}`);

        // ── 以下全是展示信息（label 不参与取数） ──
        const totalBlocks = loadedSchematic.totalBlocks || (loadedSchematic.blocks?.length || 0);
        const dims = loadedSchematic.dimensions || { x: '?', y: '?', z: '?' };
        const isMega = !!(loadedSchematic.isMega && loadedSchematic.schematicId);
        const version = loadedSchematic.version || t(player, 'ui.place.unknown');
        const timeCreated = loadedSchematic.timeCreated
            ? new Date(Number(loadedSchematic.timeCreated)).toLocaleString()
            : t(player, 'ui.place.unknown');
        const timeModified = loadedSchematic.timeModified
            ? new Date(Number(loadedSchematic.timeModified)).toLocaleString()
            : t(player, 'ui.place.unknown');

        fm.addLabel(t(player, 'ui.place.name', loadedSchematic.name));
        fm.addLabel(t(player, 'ui.place.author', loadedSchematic.author || t(player, 'ui.place.unknown')));
        fm.addLabel(t(player, 'ui.place.dims', dims.x, dims.y, dims.z));
        fm.addLabel(t(player, 'ui.place.blocks', totalBlocks.toLocaleString()));
        fm.addLabel(t(player, 'ui.place.created', timeCreated));
        fm.addLabel(t(player, 'ui.place.modified', timeModified));
        fm.addLabel(t(player, 'ui.place.version', version));
        if (isMega) {
            fm.addLabel(t(player, 'ui.place.mega'));
        }
        fm.addLabel(t(player, 'ui.place.origin', defaultX, defaultY, defaultZ));
        fm.addLabel(t(player, 'ui.place.axisHint'));
        fm.addLabel(t(player, 'ui.place.submit'));

        player.sendForm(fm, (player, data) => {
            if (!Array.isArray(data)) {
                this.showSchematicBrowser(player);
                return;
            }

            // 前三个控件就是坐标输入；空串/非法值才回退默认值（0 与负数都是合法坐标）
            const placePos = {
                x: clampCoord(toIntOr(data[0], defaultX)),
                y: clampCoord(toIntOr(data[1], defaultY)),
                z: clampCoord(toIntOr(data[2], defaultZ)),
            };

            if (placePos.x !== defaultX || placePos.y !== defaultY || placePos.z !== defaultZ) {
                logger.info(`[UIManager] 按输入坐标放置 "${loadedSchematic.name}": `
                    + `(${placePos.x}, ${placePos.y}, ${placePos.z})（玩家在 ${defaultX}, ${defaultY}, ${defaultZ}）`);
            }

            this.executePlaceSchematic(player, schematic, loadedSchematic, placePos);
        });
    }

    // 执行实际的投影放置
    executePlaceSchematic(player, schematic, loadedSchematic, placePos) {
        const dataManager = global.dataManager;
        const renderer = global.renderer;
        const megaRenderer = global.megaRenderer;
        const projManager = global.projManager;
        const megaManager = global.megaManager;
        const fs = require('fs');
        const path = require('path');

        try {
            const isMega = !!(loadedSchematic.isMega && loadedSchematic.schematicId);

            // 复制原始文件到 Mega 目录，方便材料清单等功能使用（.litematic / .mcstructure 均可）
            if (isMega && loadedSchematic.filePath) {
                try {
                    const megaDir = path.join('./plugins/LitematicaBE/mega_schematics/', loadedSchematic.schematicId);
                    const ext = path.extname(loadedSchematic.filePath) || '.litematic';
                    const destPath = path.join(megaDir, 'original' + ext);
                    if (!fs.existsSync(megaDir)) {
                        fs.mkdirSync(megaDir, { recursive: true });
                    }
                    if (!fs.existsSync(destPath)) {
                        fs.copyFileSync(loadedSchematic.filePath, destPath);
                        logger.info(`[LitematicaBE] 已复制原始文件到 Mega 目录: ${destPath}`);
                    }
                } catch (copyErr) {
                    logger.warn(`[LitematicaBE] 复制原始文件失败: ${copyErr.message}`);
                }
            }

            const projection = {
                id: dataManager.generateId(),
                name: loadedSchematic.name,
                author: loadedSchematic.author,
                dimensions: loadedSchematic.dimensions,
                blocks: loadedSchematic.blocks || [],
                position: placePos,
                dimension: dimidOf(player),
                file: schematic.file,
                filePath: loadedSchematic.filePath || null,
                version: loadedSchematic.version || 0,
                timeCreated: loadedSchematic.timeCreated || null,
                timeModified: loadedSchematic.timeModified || null,
                rotation: 0,
                mirrorX: false,
                mirrorZ: false,
                enabled: true,
                opacity: 0.8,
                renderLayer: -1,
                showBounds: true,
                boundsColor: "#00FF00",
                createdAt: Date.now(),
                totalBlocks: loadedSchematic.totalBlocks || (loadedSchematic.blocks?.length || 0),
                isMega: isMega,
                schematicId: loadedSchematic.schematicId || null,
                blockIndex: loadedSchematic.blockIndex || null,
                blockChunks: loadedSchematic.blockChunks || null
            };

            dataManager.addProjection(projection);
            dataManager.setPlayerCurrentProjection(player.xuid, projection.id);

            if (projManager) {
                projManager.activateProjection(player, projection);
            }

            if (isMega) {
                megaRenderer.initRenderState(player, loadedSchematic.schematicId, projection);
                logger.info('[LitematicaBE] 已启用超大型投影渲染模式');
            }

            // 多投影：startRender 默认与已加载的其它投影并存，并把自己设为木剑控制目标
            renderer.startRender(player, projection, -1);
            const activeCount = (typeof renderer.getPlayerProjections === 'function')
                ? renderer.getPlayerProjections(player).length : 1;
            if (activeCount > 1) {
                tell(player, 'ui.place.multi', activeCount);
                tell(player, 'ui.place.multiHint');
            }
            // MEGA 投影：startRender 建空队列会话，MegaProjectionRenderer.onTick 用 appendBlocks 分块注入

            logger.info(`[LitematicaBE] 投影 "${projection.name}" 已加载 | 位置: (${placePos.x}, ${placePos.y}, ${placePos.z}) | 方块数: ${loadedSchematic.totalBlocks || loadedSchematic.blocks?.length || 0}`);
            if (isMega) {
                logger.info('[LitematicaBE] MEGA 模式 - 分块全量注入');
            }

            // 把边界提示打到聊天栏：玩家能立刻确认"确实落在输入的坐标上"（而不是脚下）
            try { renderer.showBounds(projection, player); } catch (e) { /* 提示失败不影响放置 */ }

            tell(player, 'ui.place.placed', placePos.x, placePos.y, placePos.z);

        } catch (e) {
            tell(player, 'ui.place.failed', e.message);
            logger.error(`[UIManager] executePlaceSchematic error: ${e.message}`);
            logger.error(`[UIManager] Stack: ${e.stack}`);
        }
    }

    // 直接放置全部方块（OP+创造模式）
    async directPlaceAllBlocks(player, data, placePos) {
        const dimid = player.pos.dimid;
        const isMega = !!(data.isMega && data.schematicId);
        const origin = placePos || data.position;

        const { BlockConversions } = require('../easyplace/BlockConversions');
        const { BlockStateConverters } = require('../mappings/BlockStateConverters');
        const { BlockMappingRegistry } = require('../mappings/BlockMappingRegistry');

        const stateConverter = new BlockStateConverters();
        const registry = new BlockMappingRegistry();

        let placed = 0;
        let errors = 0;
        const batchSize = 2000;
        let batchCounter = 0;

        const processBlock = (block) => {
            const wx = origin.x + (block.pos ? block.pos[0] : 0);
            const wy = origin.y + (block.pos ? block.pos[1] : 0);
            const wz = origin.z + (block.pos ? block.pos[2] : 0);

            const javaName = block.name;
            // 写回世界必须用**BDS 原始状态键**：.mcstructure 加载时 state 被去掉了 `minecraft:`
            // 前缀（给 ghost 的 spec.from 用），而 BDS 对部分方块只认带前缀的状态名
            //（实测 observer 的状态定义名是 `minecraft:facing_direction`，写成短键会被丢弃 →
            //  观察者落到默认朝向）。rawState 由 McstructureLoader 一并保留。
            const javaStates = block.rawState || block.state || {};

            if (!javaName || javaName.includes('air')) return;
            if (BlockConversions.isBanned(javaName, dimid)) return;
            if (!BlockConversions.isWhitelistedState(javaName, javaStates)) return;

            try {
                const mapping = registry.getMapping(javaName);
                let beName = mapping ? mapping.b : javaName;

                const beStates = stateConverter.convertJavaToBedrock(javaName, javaStates);

                const converted = BlockConversions.convertToValid(beName, beStates);

                if (javaName === 'minecraft:redstone_torch' || javaName === 'minecraft:redstone_wall_torch') {
                    if (javaStates.lit === 'false' || javaStates.lit === false) {
                        converted.name = 'unlit_redstone_torch';
                    }
                }

                const finalStates = BlockConversions.resetToDefaultStates(converted.states);

                // 使用 NBT 方式放置方块（更可靠，支持颜色等状态）
                let success = false;
                try {
                    const blockNbt = bidirectionalConverter.buildBlockNbt(converted.name, finalStates);
                    success = mc.setBlock(wx, wy, wz, dimid, blockNbt);
                } catch (nbtError) {
                    // NBT 方式失败，回退到简单放置
                    success = mc.setBlock(wx, wy, wz, dimid, converted.name, 0);
                }

                if (success) {
                    placed++;
                } else {
                    errors++;
                }
            } catch (e) {
                errors++;
            }
        };

        if (isMega) {
            const megaManager = global.megaManager;
            const chunkFiles = megaManager.storage.listChunkFiles(data.schematicId);

            if (!chunkFiles || chunkFiles.length === 0) {
                tell(player, 'ui.place.errNoData');
                return;
            }

            let totalBlocks = 0;
            const meta = megaManager.getMeta(data.schematicId);
            if (meta && meta.totalBlocks) {
                totalBlocks = meta.totalBlocks;
            } else {
                tell(player, 'ui.place.warnNoTotal');
            }

            tell(player, 'ui.place.startChunk', totalBlocks > 0 ? totalBlocks.toLocaleString() : '?');
            tell(player, 'ui.place.chunkCount', chunkFiles.length);

            let chunkIdx = 0;
            for (const { cx, cy, cz } of chunkFiles) {
                const chunkBlocks = megaManager.loadChunkFromDisk(data.schematicId, cx, cy, cz);
                if (!chunkBlocks) continue;

                for (const b of chunkBlocks) {
                    processBlock(b);
                    batchCounter++;

                    if (batchCounter >= batchSize) {
                        batchCounter = 0;
                        await new Promise(r => setImmediate(r));
                    }
                }

                chunkIdx++;
                if (chunkIdx % 20 === 0 && chunkIdx < chunkFiles.length) {
                    const pct = totalBlocks > 0
                        ? Math.floor(placed / totalBlocks * 100)
                        : Math.floor(chunkIdx / chunkFiles.length * 100);
                    tell(player, 'ui.place.progress', chunkIdx, chunkFiles.length, pct, placed.toLocaleString());
                }
            }

            await new Promise(r => setImmediate(r));
        } else {
            const blocks = data.blocks || [];
            if (blocks.length === 0) {
                tell(player, 'ui.place.errNoBlocks');
                return;
            }

            tell(player, 'ui.place.startBlocks', blocks.length.toLocaleString());

            for (let i = 0; i < blocks.length; i++) {
                processBlock(blocks[i]);
                batchCounter++;

                if (batchCounter >= batchSize && i + 1 < blocks.length) {
                    batchCounter = 0;
                    await new Promise(r => setImmediate(r));
                }
            }
        }

        tell(player, 'ui.place.done', placed.toLocaleString(), errors > 0 ? t(player, 'ui.place.doneErr', errors) : '');
    }

    async loadAndPlaceSchematic(player, schematic) {
        const loadSchematicFile = global.loadSchematicFile;

        try {
            // 必须带扩展名：同名 .litematic / .mcstructure 并存时，loadSchematicFile 会优先 .litematic，
            // 去掉扩展名等于永远加载前者（测试1 排查事故：菜单里选 mcstructure，实际读的是 litematic）。
            const loadedSchematic = await loadSchematicFile(schematic.file);

            if (!loadedSchematic) {
                tell(player, 'ui.place.errLoad');
                return;
            }

            // 显示放置面板，让玩家确认坐标
            this.showPlacementPanel(player, schematic, loadedSchematic);

        } catch (e) {
            tell(player, 'ui.place.errLoadMsg', e.message);
            logger.error(`[UIManager] loadAndPlaceSchematic error: ${e.message}`);
            logger.error(`[UIManager] Stack: ${e.stack}`);
        }
    }

    showLoadProjection(player) {
        const dataManager = global.dataManager;
        if (!dataManager) {
            tell(player, 'ui.load.errData');
            this.showMainMenu(player);
            return;
        }

        const projections = dataManager.getAllProjections();

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.load.title'));

        if (projections.length === 0) {
            fm.setContent(t(player, 'ui.load.empty'));
            fm.addButton(t(player, 'ui.load.browse'));
            fm.addButton(t(player, 'ui.menu.back'));

            player.sendForm(fm, (player, data) => {
                if (typeof data !== 'number') return;   // 取消表单：LSE 可能回 null 也可能回 undefined
                if (data === 0) {
                    this.showSchematicBrowser(player);
                } else {
                    this.showMainMenu(player);
                }
            });
            return;
        }

        fm.setContent(t(player, 'ui.load.content', projections.length));

        for (const proj of projections) {
            if (!proj) continue;
            const status = this._projectionStatusText(player, proj.id);
            fm.addButton(`${proj.name || t(player, 'ui.load.unnamed')}\n${status} (${proj.dimensions?.x || '?'}×${proj.dimensions?.y || '?'}×${proj.dimensions?.z || '?'})`);
        }
        fm.addButton(t(player, 'ui.load.browse'));
        fm.addButton(t(player, 'ui.menu.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showMainMenu(player);
                return;
            }

            if (data === projections.length) {
                this.showSchematicBrowser(player);
                return;
            }

            if (data === projections.length + 1) {
                this.showMainMenu(player);
                return;
            }

            const selectedProj = projections[data];
            if (selectedProj) {
                this.showProjectionDetail(player, selectedProj);
            } else {
                this.showMainMenu(player);
            }
        });
    }

    /** 加载状态文案：未加载 / 已加载（木剑控制中）/ 已加载（并存） */
    _projectionStatusText(player, projectionId) {
        const renderer = global.renderer;
        if (!renderer || typeof renderer.getPlayerProjections !== 'function') return t(player, 'ui.load.statusNotLoaded');
        const row = renderer.getPlayerProjections(player).find((e) => e.id === projectionId);
        if (!row) return t(player, 'ui.load.statusNotLoaded');
        return row.primary ? t(player, 'ui.load.statusLoadedPrimary') : t(player, 'ui.load.statusLoaded');
    }

    showProjectionDetail(player, projection) {
        if (!projection) {
            tell(player, 'ui.detail.errNoProj');
            this.showMainMenu(player);
            return;
        }

        const renderer = global.renderer;
        const list = (renderer && typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player) : [];
        const mine = list.find((e) => e.id === projection.id) || null;
        const isLoaded = !!mine;
        const currentLayer = mine ? mine.layer : -1;
        const layerText = currentLayer < 0 ? t(player, 'ui.detail.layerAll') : t(player, 'ui.detail.layerN', currentLayer);

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.detail.title'));
        fm.setContent(
            t(player, 'ui.detail.name', projection.name) + '\n' +
            t(player, 'ui.detail.pos', projection.position?.x, projection.position?.y, projection.position?.z) + '\n' +
            t(player, 'ui.detail.dims', projection.dimensions?.x, projection.dimensions?.y, projection.dimensions?.z) + '\n' +
            t(player, 'ui.detail.blocks', projection.blocks?.length || projection.totalBlocks || 0) + '\n' +
            t(player, 'ui.detail.status',
                isLoaded ? (mine.primary ? t(player, 'ui.detail.statusLoadedPrimary') : t(player, 'ui.detail.statusLoaded'))
                         : t(player, 'ui.detail.statusNotLoaded')) + '\n' +
            (isLoaded ? t(player, 'ui.detail.layer', layerText) + '\n' : '') +
            t(player, 'ui.detail.loadedCount', list.length)
        );

        // 按钮 → 动作的显式映射：加/减按钮时不会再把下标错位
        const actions = [];
        if (isLoaded) {
            actions.push(['unload', t(player, 'ui.detail.unload')]);
            if (!mine.primary) actions.push(['primary', t(player, 'ui.detail.primary')]);
        } else {
            actions.push(['load', t(player, 'ui.detail.load')]);
        }
        actions.push(['materials', t(player, 'ui.detail.materials')]);
        actions.push(['placeall', t(player, 'ui.detail.placeall')]);
        actions.push(['delete', t(player, 'ui.detail.delete')]);
        actions.push(['back', t(player, 'ui.detail.back')]);
        for (const [, label] of actions) fm.addButton(label);

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showLoadProjection(player);
                return;
            }
            const act = actions[data];
            if (!act) {
                this.showLoadProjection(player);
                return;
            }

            switch (act[0]) {
                case 'unload':
                    this.unloadProjection(player, projection);
                    break;
                case 'primary':
                    if (renderer && typeof renderer.setPrimaryProjection === 'function') {
                        renderer.setPrimaryProjection(player, projection.id, { notify: true });
                    }
                    this.showProjectionDetail(player, projection);
                    break;
                case 'load':
                    this.renderProjection(player, projection);
                    break;
                case 'materials':
                    this.showMaterialList(player, projection);
                    break;
                case 'placeall': {
                    // 直接放置全部方块（需要OP+创造模式）
                    const isCreative = player.gameMode === 1;
                    const isOp = typeof player.isOP === 'function' ? player.isOP() : false;
                    if (!isCreative || !isOp) {
                        tell(player, 'ui.detail.errNeedOp');
                        this.showProjectionDetail(player, projection);
                        return;
                    }
                    tell(player, 'ui.detail.placing');
                    this.directPlaceAllBlocks(player, projection);
                    // 放置完成后返回详情页
                    setTimeout(() => {
                        this.showProjectionDetail(player, projection);
                    }, 1000);
                    break;
                }
                case 'delete':
                    this.confirmDeleteProjection(player, projection);
                    break;
                case 'back':
                default:
                    this.showLoadProjection(player);
                    break;
            }
        });
    }

    renderProjection(player, projection) {
        const renderer = global.renderer;
        if (!renderer) {
            tell(player, 'ui.load.errRender');
            return;
        }

        if (!projection) {
            tell(player, 'ui.load.errDataInvalid');
            return;
        }
        if (!projection.isMega && (!projection.blocks || projection.blocks.length === 0)) {
            tell(player, 'ui.load.errDataInvalid');
            return;
        }

        // 已加载过：只把木剑控制切过去，不重铺、也不影响别的投影
        if (this.isProjectionLoaded(player, projection.id)) {
            if (typeof renderer.setPrimaryProjection === 'function') {
                renderer.setPrimaryProjection(player, projection.id, { notify: true });
            } else {
                tell(player, 'ui.load.already');
            }
            setTimeout(() => this.showProjectionDetail(player, projection), 300);
            return;
        }

        tell(player, 'ui.load.loading', projection.name);
        tell(player, 'ui.load.blockCount', projection.blocks?.length || projection.totalBlocks || 0);

        const ok = renderer.startRender(player, projection, -1);
        if (!ok) {
            setTimeout(() => this.showProjectionDetail(player, projection), 500);
            return;
        }
        const n = (typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player).length : 1;
        tell(player, 'ui.load.multi', n);

        setTimeout(() => {
            this.showProjectionDetail(player, projection);
        }, 500);
    }

    isProjectionLoaded(player, projectionId) {
        if (!projectionId) return false;
        const renderer = global.renderer;
        if (!renderer) return false;
        // 多投影：渲染器的任务表是唯一判定源
        if (typeof renderer.isProjectionLoaded === 'function') {
            return renderer.isProjectionLoaded(player, projectionId);
        }
        const task = renderer.activeProjections.get(player.xuid);
        return task && task.projection && task.projection.id === projectionId;
    }

    unloadProjection(player, projection) {
        const renderer = global.renderer;
        if (!renderer) {
            tell(player, 'ui.load.errRender2');
            return;
        }

        // 只撤这一个投影的会话：其它已加载的投影必须原样留着
        if (projection && projection.id && typeof renderer.cancelRender === 'function') {
            renderer.cancelRender(player, projection.id);
        } else {
            renderer.cancelRender(player);
        }
        tell(player, 'ui.detail.unloaded', projection && projection.name);

        setTimeout(() => {
            this.showProjectionDetail(player, projection);
        }, 500);
    }

    /**
     * 选择"木剑控制的投影"：多投影并存时，木剑切层/旋转/建造只作用于这一份。
     */
    showSelectActiveProjection(player) {
        const renderer = global.renderer;
        if (!renderer) {
            tell(player, 'ui.select.errRender');
            this.showMainMenu(player);
            return;
        }

        const list = (typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player) : [];

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.select.title'));

        if (!list.length) {
            fm.setContent(t(player, 'ui.select.empty'));
            fm.addButton(t(player, 'ui.select.back'));
            player.sendForm(fm, (player, data) => {
                if (typeof data !== 'number') return;
                this.showProjectionOperations(player);
            });
            return;
        }

        const current = list.find((e) => e.primary);
        fm.setContent(
            t(player, 'ui.select.content', list.length,
                current ? (current.projection?.name || current.id) : t(player, 'ui.select.none'))
        );

        for (const row of list) {
            const tag = row.primary ? t(player, 'ui.select.current') : t(player, 'ui.select.switch');
            const mega = row.isMega ? t(player, 'ui.select.mega') : '';
            const ly = row.layer < 0 ? t(player, 'ui.detail.layerAll') : t(player, 'ui.detail.layerN', row.layer);
            fm.addButton(`${row.projection?.name || row.id}${mega}\n${tag} §8(${ly})`);
        }
        fm.addButton(t(player, 'ui.select.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showProjectionOperations(player);
                return;
            }
            if (data === list.length) {
                this.showProjectionOperations(player);
                return;
            }
            const row = list[data];
            if (!row) {
                this.showProjectionOperations(player);
                return;
            }
            if (typeof renderer.setPrimaryProjection === 'function') {
                renderer.setPrimaryProjection(player, row.id, { notify: true });
            }
            setTimeout(() => this.showSelectActiveProjection(player), 300);
        });
    }

    confirmDeleteProjection(player, projection) {
        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.del.title'));
        fm.setContent(t(player, 'ui.del.content', projection.name));
        fm.addButton(t(player, 'ui.del.confirm'));
        fm.addButton(t(player, 'ui.del.cancel'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') return;   // 取消表单：LSE 可能回 null 也可能回 undefined
            if (data === 0) {
                const dataManager = global.dataManager;
                const renderer = global.renderer;
                if (!dataManager || !projection || !projection.id) return;

                // ═══ 先清世界，清不干净就不删记录（强退后 MEGA 残留兜底）═══
                const targets = [];
                try { for (const op of mc.getOnlinePlayers()) targets.push(op); } catch (e) { /* 忽略 */ }
                try {
                    const loading = (typeof dataManager.getPlayersLoadingProjection === 'function')
                        ? dataManager.getPlayersLoadingProjection(projection.id) : [];
                    const seen = new Set(targets.map((p) => p && p.xuid));
                    for (const xuid of loading) {
                        if (!xuid || seen.has(xuid)) continue;
                        targets.push(mc.getPlayer(xuid) || { xuid });
                        seen.add(xuid);
                    }
                } catch (e) { /* 忽略 */ }

                const purge = (renderer && typeof renderer.purgeProjection === 'function')
                    ? renderer.purgeProjection(targets, projection, { dimid: projection.dimension })
                    : { ok: true };

                if (!purge.ok) {
                    tell(player, 'ui.detail.purgeRemain', purge.remaining);
                    tell(player, 'ui.detail.purgeHint');
                    this.showProjectionDetail(player, projection);
                    return;
                }

                if (renderer && this.isProjectionLoaded(player, projection.id)) {
                    // 只卸载这一个：其它已加载的投影不受影响
                    renderer.cancelRender(player, projection.id);
                }
                // 无活跃任务时 cancelRender 不会走 _dropTask，projManager 里的活动投影会残留，
                // 打印机/木剑继续拿已删除的投影工作。这里兜底清一次。
                try {
                    const pm = global.projManager;
                    const act = pm && typeof pm.getActiveProjectionByPlayer === 'function'
                        ? pm.getActiveProjectionByPlayer(player) : null;
                    if (act && act.projection && String(act.projection.id) === String(projection.id)) {
                        pm.removeActiveProjection(player.xuid);
                    }
                } catch (e) { /* 忽略 */ }
                try {
                    if (typeof dataManager.removeProjectionFromAllPlayers === 'function') {
                        dataManager.removeProjectionFromAllPlayers(projection.id);
                    }
                } catch (e) { /* 忽略 */ }
                dataManager.removeProjection(projection.id);
                tell(player, 'ui.detail.deleted', projection.name, purge.restored || 0);

                setTimeout(() => {
                    this.showLoadProjection(player);
                }, 500);
            } else {
                this.showProjectionDetail(player, projection);
            }
        });
    }

    showMaterialList(player, projection) {
        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.mat.title'));
        fm.setContent(t(player, 'ui.mat.content', projection.name, projection.blocks?.length || 0));
        fm.addButton(t(player, 'ui.mat.gen'));
        fm.addButton(t(player, 'ui.mat.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number' || data === 1) {
                this.showProjectionDetail(player, projection);
                return;
            }

            if (data === 0) {
                // 生成材料清单
                this.generateMaterialExcel(player, projection);
            }
        });
    }

    generateMaterialExcel(player, projection) {
        // 使用全局已初始化的 materialCounter
        const materialCounter = global.materialCounter;
        if (!materialCounter) {
            tell(player, 'ui.mat.err');
            return;
        }

        // 生成Excel文件
        materialCounter.generateExcel(projection, player);

        // 返回材料清单界面
        setTimeout(() => {
            this.showMaterialList(player, projection);
        }, 500);
    }

    showProjectionManage(player) {
        const dataManager = global.dataManager;
        if (!dataManager) {
            tell(player, 'ui.manage.errData');
            this.showMainMenu(player);
            return;
        }

        const projections = dataManager.getAllProjections();

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.manage.title'));

        if (projections.length === 0) {
            fm.setContent(t(player, 'ui.manage.empty'));
        } else {
            fm.setContent(t(player, 'ui.manage.content', projections.length));
            for (const proj of projections) {
                fm.addButton(`${proj.name}\n(${proj.position?.x}, ${proj.position?.y}, ${proj.position?.z})`);
            }
        }

        fm.addButton(t(player, 'ui.manage.delAll'));
        fm.addButton(t(player, 'ui.manage.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showMainMenu(player);
                return;
            }

            if (projections.length === 0) {
                if (data === 0) {
                    this.showMainMenu(player);
                }
                return;
            }

            if (data === projections.length) {
                this.confirmClearProjections(player);
            } else if (data === projections.length + 1) {
                this.showMainMenu(player);
            } else if (data >= 0 && data < projections.length) {
                const projection = projections[data];
                if (projection && projection.id) {
                    this.showProjectionDetail(player, projection);
                } else {
                    tell(player, 'ui.manage.errInvalid');
                    this.showProjectionManage(player);
                }
            } else {
                this.showMainMenu(player);
            }
        });
    }

    showSettings(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.settings.title'));
        fm.setContent(t(player, 'ui.settings.content'));

        fm.addButton(t(player, 'ui.settings.clear'));
        fm.addButton(t(player, 'ui.settings.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number' || data === 1) {
                this.showMainMenu(player);
                return;
            }

            if (data === 0) {
                this.confirmClearProjections(player);
            }
        });
    }

    confirmClearProjections(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.clear.title'));
        fm.setContent(t(player, 'ui.clear.content'));
        fm.addButton(t(player, 'ui.clear.confirm'));
        fm.addButton(t(player, 'ui.clear.cancel'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') return;   // 取消表单：LSE 可能回 null 也可能回 undefined
            if (data === 0) {
                const dataManager = global.dataManager;
                const renderer = global.renderer;
                if (dataManager) {
                    const projections = dataManager.getAllProjections();
                    const targets = [];
                    try { for (const op of mc.getOnlinePlayers()) targets.push(op); } catch (e) { /* 忽略 */ }
                    let removed = 0;
                    let kept = 0;
                    for (const proj of projections) {
                        if (!proj || !proj.id) continue;
                        const purge = (renderer && typeof renderer.purgeProjection === 'function')
                            ? renderer.purgeProjection(targets, proj, { dimid: proj.dimension })
                            : { ok: true, restored: 0 };
                        if (!purge.ok) { kept++; continue; }
                        if (renderer && this.isProjectionLoaded(player, proj.id)) {
                            renderer.cancelRender(player, proj.id);
                        }
                        dataManager.removeProjection(proj.id);
                        removed++;
                    }
                    try {
                        if (typeof dataManager.removeProjectionFromAllPlayers === 'function') {
                            for (const proj of projections) {
                                if (proj && proj.id && !dataManager.getProjection(proj.id)) {
                                    dataManager.removeProjectionFromAllPlayers(proj.id);
                                }
                            }
                        }
                    } catch (e) { /* 忽略 */ }
                    tell(player, 'ui.clear.done', removed, kept ? t(player, 'ui.clear.doneKept', kept) : '');
                }
            }
            this.showMainMenu(player);
        });
    }

    showProjectionOperations(player) {
        const renderer = global.renderer;
        const easyPlaceManager = global.easyPlaceManager;

        if (!renderer) {
            tell(player, 'ui.ops.errRender');
            this.showMainMenu(player);
            return;
        }

        const list = (typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player) : [];
        const primary = list.find((e) => e.primary) || null;

        const isLayerMode = renderer.layerRenderMode?.get(player.xuid) || false;
        const isEasyPlace = easyPlaceManager?.isEnabled(player) || false;
        const isFastPlace = easyPlaceManager?.isFastPlaceEnabled(player) || false;
        const isCorrection = easyPlaceManager?.isCorrectionEnabled(player) || false;
        const hasActive = list.length > 0 || !!renderer.activeProjections?.has(player.xuid);

        const layerStatus = isLayerMode ? t(player, 'ui.ops.on') : t(player, 'ui.ops.off');
        const easyStatus = isEasyPlace ? t(player, 'ui.ops.on') : t(player, 'ui.ops.off');
        const fastStatus = isFastPlace ? t(player, 'ui.ops.on') : t(player, 'ui.ops.off');
        const correctionStatus = isCorrection ? t(player, 'ui.ops.on') : t(player, 'ui.ops.off');
        const projStatus = hasActive
            ? t(player, 'ui.ops.projStatus', list.length) + (primary ? t(player, 'ui.ops.projStatusPrimary', primary.projection?.name || primary.id) : '')
            : t(player, 'ui.ops.projNone');

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.ops.title'));
        fm.setContent(t(player, 'ui.ops.content', layerStatus, easyStatus, fastStatus, correctionStatus, projStatus));

        // 动作 → 按钮：动态按钮集合也不会错位
        const actions = [
            ['layer', isLayerMode ? t(player, 'ui.ops.layerOff') : t(player, 'ui.ops.layerOn')],
            ['easy', isEasyPlace ? t(player, 'ui.ops.easyOff') : t(player, 'ui.ops.easyOn')],
            ['fast', isFastPlace ? t(player, 'ui.ops.fastOff') : t(player, 'ui.ops.fastOn')],
            ['correction', isCorrection ? t(player, 'ui.ops.corrOff') : t(player, 'ui.ops.corrOn')],
            ['verify', t(player, 'ui.ops.verify')],
            ['select', t(player, 'ui.ops.select')],
            ['unload', t(player, 'ui.ops.unload')],
            ['cancel', t(player, 'ui.ops.cancel')],
            ['back', t(player, 'ui.ops.back')],
        ];
        for (const [, label] of actions) fm.addButton(label);

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showMainMenu(player);
                return;
            }
            const act = actions[data];
            if (!act) {
                this.showMainMenu(player);
                return;
            }
            switch (act[0]) {
                case 'layer': this.toggleLayerRenderFromMenu(player); break;
                case 'easy': this.toggleEasyPlaceFromMenu(player); break;
                case 'fast': this.toggleFastPlaceFromMenu(player); break;
                case 'correction': this.toggleCorrectionFromMenu(player); break;
                case 'verify': this.showVerifyResult(player); break;
                case 'select': this.showSelectActiveProjection(player); break;
                case 'unload': this.showUnloadPicker(player); break;
                case 'cancel': this.cancelRenderFromMenu(player); break;
                case 'back':
                default: this.showMainMenu(player); break;
            }
        });
    }

    /**
     * 卸载某个投影（不会动其它已加载的投影）。
     */
    showUnloadPicker(player) {
        const renderer = global.renderer;
        const list = (renderer && typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player) : [];

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.unload.title'));

        if (!list.length) {
            fm.setContent(t(player, 'ui.unload.empty'));
            fm.addButton(t(player, 'ui.unload.back'));
            player.sendForm(fm, (player, data) => {
                if (typeof data !== 'number') return;
                this.showProjectionOperations(player);
            });
            return;
        }

        fm.setContent(t(player, 'ui.unload.content', list.length));
        for (const row of list) {
            const tag = row.primary ? t(player, 'ui.unload.primary') : '';
            const ly = row.layer < 0 ? t(player, 'ui.detail.layerAll') : t(player, 'ui.detail.layerN', row.layer);
            fm.addButton(`${row.projection?.name || row.id}${tag}\n§7${ly}`);
        }
        fm.addButton(t(player, 'ui.unload.all'));
        fm.addButton(t(player, 'ui.unload.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showProjectionOperations(player);
                return;
            }
            if (data === list.length) {
                // 全部卸载
                renderer.cancelRender(player);
                tell(player, 'ui.unload.done');
                setTimeout(() => this.showProjectionOperations(player), 300);
                return;
            }
            if (data === list.length + 1) {
                this.showProjectionOperations(player);
                return;
            }
            const row = list[data];
            if (!row) {
                this.showProjectionOperations(player);
                return;
            }
            renderer.cancelRender(player, row.id);
            tell(player, 'ui.unload.doneOne', row.projection?.name || row.id);
            setTimeout(() => this.showUnloadPicker(player), 300);
        });
    }

    toggleLayerRenderFromMenu(player) {
        const renderer = global.renderer;
        const dataManager = global.dataManager;
        const projManager = global.projManager;
        
        if (!renderer) {
            tell(player, 'ui.ops.errRender');
            this.showProjectionOperations(player);
            return;
        }

        if (!renderer.layerRenderMode) {
            renderer.layerRenderMode = new Map();
        }

        const current = renderer.layerRenderMode.get(player.xuid) || false;
        renderer.layerRenderMode.set(player.xuid, !current);

        const status = !current ? t(player, 'ui.ops.onColor') : t(player, 'ui.ops.offColor');
        tell(player, 'ui.ops.layerToggled', status);

        // 自动切换到建造模式
        if (!current && dataManager) {
            dataManager.setPlayerToolMode(player.xuid, 'build');
            tell(player, 'ui.ops.autoBuild');
        }

        const activeProj = projManager?.getActiveProjectionByPlayer(player);
        if (activeProj) {
            const projection = activeProj.projection;
            if (!current) {
                // 开启逐层模式，默认从第 0 层开始。
                // 只改 projManager 的状态是不够的（它不碰世界），必须同步真正铺 ghost 的渲染器：
                // 普通投影走 gr.setLayer，MEGA 走分块计划，统一收口在 applyLayer。
                const targetLayer = 0;
                projManager.switchLayer(player, 'up');
                const r = (typeof renderer.applyLayer === 'function')
                    ? renderer.applyLayer(player, projection, targetLayer)
                    : null;
                if (r && r.ok) {
                    const detail = (typeof r.chunks === 'number' && r.chunks > 0)
                        ? t(player, 'ui.ops.chunksPending', r.chunks)
                        : t(player, 'ui.ops.gridCount', r.count || 0);
                    tell(player, 'ui.ops.layer0', projection.dimensions.y, detail);
                } else {
                    renderer.currentRenderLayer.set(player.xuid, targetLayer);
                }
            } else {
                projManager.switchLayer(player, 'all');
                const r = (typeof renderer.applyLayer === 'function')
                    ? renderer.applyLayer(player, projection, -1)
                    : null;
                if (r && r.ok) {
                    tell(player, 'ui.ops.layerAllPending');
                } else {
                    renderer.currentRenderLayer.set(player.xuid, -1);
                    tell(player, 'ui.ops.layerAll');
                }
            }
        }

        setTimeout(() => {
            this.showProjectionOperations(player);
        }, 500);
    }

    toggleEasyPlaceFromMenu(player) {
        const easyPlaceManager = global.easyPlaceManager;
        if (!easyPlaceManager) {
            tell(player, 'ui.ops.errEasy');
            this.showProjectionOperations(player);
            return;
        }

        easyPlaceManager.toggle(player);

        setTimeout(() => {
            this.showProjectionOperations(player);
        }, 500);
    }

    toggleCorrectionFromMenu(player) {
        const easyPlaceManager = global.easyPlaceManager;
        if (!easyPlaceManager) {
            tell(player, 'ui.ops.errEasy');
            this.showProjectionOperations(player);
            return;
        }

        easyPlaceManager.toggleCorrection(player);

        setTimeout(() => {
            this.showProjectionOperations(player);
        }, 500);
    }

    cancelRenderFromMenu(player) {
        const renderer = global.renderer;
        if (!renderer) {
            tell(player, 'ui.ops.errRender');
            this.showMainMenu(player);
            return;
        }

        // 不带投影 id = 撤销该玩家全部会话（"取消全部渲染"）
        renderer.cancelRender(player);
        tell(player, 'ui.ops.cancelDone');

        setTimeout(() => {
            this.showMainMenu(player);
        }, 500);
    }

    toggleFastPlaceFromMenu(player) {
        const easyPlaceManager = global.easyPlaceManager;
        if (!easyPlaceManager) {
            tell(player, 'ui.ops.errEasy');
            this.showProjectionOperations(player);
            return;
        }

        easyPlaceManager.toggleFastPlace(player);

        setTimeout(() => {
            this.showProjectionOperations(player);
        }, 500);
    }

    showVerifyResult(player) {
        const blockVerifier = global.blockVerifier;
        const projManager = global.projManager;

        if (!blockVerifier) {
            tell(player, 'ui.ops.errVerify');
            this.showProjectionOperations(player);
            return;
        }

        const activeProj = projManager?.getActiveProjectionByPlayer(player);

        if (!activeProj || !activeProj.projection) {
            tell(player, 'ui.ops.noActive');
            this.showProjectionOperations(player);
            return;
        }

        const projection = activeProj.projection;
        tell(player, 'ui.ops.verifying');

        // 执行核心验证
        let results;
        try {
            results = blockVerifier.verifyProjection(projection);
        } catch (e) {
            logger.error(`[UIManager] verifyProjection failed: ${e.message}`);
            tell(player, 'ui.ops.verifyFail', e.message);
            this.showProjectionOperations(player);
            return;
        }

        // 执行多余方块检测（异步不阻塞，但会稍慢）
        let extraResult = null;
        try {
            extraResult = blockVerifier.detectExtraBlocks(projection);
        } catch (e) {
            logger.warn(`[UIManager] Extra blocks detection skipped: ${e.message}`);
        }

        // 保存验证结果供后续标注使用
        const allProblems = [...results.blocks];
        if (extraResult && extraResult.extraBlocks.length > 0) {
            for (const eb of extraResult.extraBlocks) {
                allProblems.push({
                    position: eb.position,
                    level: 'extra',
                    levelName: '多余方块'
                });
            }
        }
        const lastResult = {
            projection,
            results,
            extraResult,
            allProblems,
            timestamp: Date.now()
        };
        this.lastVerifyResults.set(player.xuid, lastResult);

        const matchPercent = results.total > 0 ? ((results.match / results.total) * 100).toFixed(1) : 0;

        let content = t(player, 'ui.verify.proj', projection.name) + '\n\n';
        content += t(player, 'ui.verify.total', results.total) + '\n';
        content += t(player, 'ui.verify.match', results.match) + '\n';
        content += t(player, 'ui.verify.typeErr', results.typeMatch) + '\n';
        content += t(player, 'ui.verify.errBlock', results.noMatch) + '\n';
        content += t(player, 'ui.verify.missing', results.missing) + '\n';

        if (extraResult) {
            content += t(player, 'ui.verify.extra', extraResult.extraCount);
            if (extraResult.totalScanned >= 50000) {
                content += t(player, 'ui.verify.extraScanned', extraResult.totalScanned);
            }
            content += '\n';
        }

        content += t(player, 'ui.verify.percent', matchPercent) + '\n';
        content += t(player, 'ui.verify.problemTotal', allProblems.length);

        // 简要问题分布
        if (allProblems.length > 0) {
            const sampleCount = Math.min(allProblems.length, 5);
            content += t(player, 'ui.verify.sampleTitle');
            for (let i = 0; i < sampleCount; i++) {
                const b = allProblems[i];
                const colorChar = b.level === 'extra' ? '§6' : 
                    (b.level === 1 ? '§c' : (b.level === 2 ? '§e' : '§b'));
                const name = b.levelName || (b.level === 'extra' ? t(player, 'ui.verify.catExtra') : t(player, 'ui.verify.catUnknown'));
                content += t(player, 'ui.verify.sampleItem', colorChar, name, b.position.x, b.position.y, b.position.z) + '\n';
            }
            if (allProblems.length > 5) {
                content += t(player, 'ui.verify.more', allProblems.length - 5);
            }
        }

        const fm = mc.newSimpleForm();
        fm.setTitle(t(player, 'ui.verify.title'));
        fm.setContent(content);

        if (allProblems.length > 0) {
            fm.addButton(t(player, 'ui.verify.mark'));
        }
        fm.addButton(t(player, 'ui.verify.detail'));
        fm.addButton(t(player, 'ui.verify.refresh'));
        fm.addButton(t(player, 'ui.verify.back'));

        player.sendForm(fm, (player, data) => {
            if (typeof data !== 'number') {
                this.showProjectionOperations(player);
                return;
            }

            const saved = this.lastVerifyResults.get(player.xuid);
            const hasProblems = allProblems.length > 0;
            const markBtn = hasProblems ? 0 : -1;          // "标注"按钮
            const detailBtn = hasProblems ? 1 : 0;          // "详细问题列表"
            const refreshBtn = hasProblems ? 2 : 1;         // "刷新验证"
            const backBtn = hasProblems ? 3 : 2;            // "返回"

            if (hasProblems && data === markBtn) {
                // 标注问题方块
                if (!saved) {
                    tell(player, 'ui.verify.expired');
                    this.showProjectionOperations(player);
                    return;
                }
                const marked = blockVerifier.markProblemBlocks(player, saved.allProblems);
                if (marked > 0) {
                    setTimeout(() => this.showProjectionOperations(player), 1000);
                } else {
                    tell(player, 'ui.verify.cantMark');
                    setTimeout(() => this.showProjectionOperations(player), 1000);
                }
            } else if (data === detailBtn) {
                // 详细问题列表
                this.showVerificationDetail(player);
            } else if (data === refreshBtn) {
                // 刷新
                this.showVerifyResult(player);
            } else {
                this.showProjectionOperations(player);
            }
        });
    }

    /**
     * 显示验证详细问题列表
     */
    showVerificationDetail(player) {
        const saved = this.lastVerifyResults.get(player.xuid);
        if (!saved) {
            tell(player, 'ui.verify.expired');
            this.showProjectionOperations(player);
            return;
        }

        const allProblems = saved.allProblems;
        if (allProblems.length === 0) {
            tell(player, 'ui.verify.noProblems');
            this.showVerifyResult(player);
            return;
        }

        const pageSize = 8;
        const totalPages = Math.ceil(allProblems.length / pageSize);
        let currentPage = 0;

        const showPage = () => {
            const start = currentPage * pageSize;
            const end = Math.min(start + pageSize, allProblems.length);
            const pageBlocks = allProblems.slice(start, end);

            const fm = mc.newSimpleForm();
            fm.setTitle(t(player, 'ui.verify.title2', currentPage + 1, totalPages));

            let content = '';
            for (let i = 0; i < pageBlocks.length; i++) {
                const b = pageBlocks[i];
                const idx = start + i + 1;
                let catName = b.levelName;
                if (b.level === 'extra') catName = t(player, 'ui.verify.catExtra');
                else if (b.level === 1) catName = t(player, 'ui.verify.catErr');
                else if (b.level === 2) catName = t(player, 'ui.verify.catTypeErr');
                else if (b.level === 4) catName = t(player, 'ui.verify.catMissing');

                content += t(player, 'ui.verify.item', idx, catName, b.position.x, b.position.y, b.position.z) + '\n';
            }

            content += t(player, 'ui.verify.total2', allProblems.length);

            fm.setContent(content);

            // 每个问题方块一个按钮用于传送
            for (let i = 0; i < pageBlocks.length; i++) {
                fm.addButton(t(player, 'ui.verify.teleport', start + i + 1));
            }

            if (currentPage < totalPages - 1) {
                fm.addButton(t(player, 'ui.verify.next'));
            }
            if (currentPage > 0) {
                fm.addButton(t(player, 'ui.verify.prev'));
            }

            fm.addButton(t(player, 'ui.verify.markAll'));
            fm.addButton(t(player, 'ui.verify.back'));

            player.sendForm(fm, (player, data) => {
                if (typeof data !== 'number') {
                    this.showVerifyResult(player);
                    return;
                }

                const teleCount = pageBlocks.length;
                const nextBtn = currentPage < totalPages - 1 ? teleCount : -1;
                const prevBtn = (currentPage < totalPages - 1 ? teleCount + 1 : teleCount);
                if (currentPage === totalPages - 1) {
                    // no next button
                }
                const markAllBtn = teleCount + (currentPage < totalPages - 1 ? 1 : 0) + (currentPage > 0 ? 1 : 0);
                const backBtn = markAllBtn + 1;

                if (data < teleCount) {
                    // 传送到问题方块
                    const target = pageBlocks[data];
                    const wx = target.position.x;
                    const wy = target.position.y + 1;
                    const wz = target.position.z;
                    try {
                        mc.runcmdEx(`tp "${player.name}" ${wx} ${wy} ${wz}`);
                    } catch (e) {
                        tell(player, 'ui.verify.teleFail', e.message);
                    }
                    this.showVerificationDetail(player);
                } else if (data === teleCount && currentPage < totalPages - 1) {
                    currentPage++;
                    showPage();
                } else if (data === teleCount + (currentPage < totalPages - 1 ? 1 : 0) && currentPage > 0) {
                    currentPage--;
                    showPage();
                } else if (data === markAllBtn) {
                    const blockVerifier = global.blockVerifier;
                    const marked = blockVerifier.markProblemBlocks(player, allProblems);
                    if (marked > 0) {
                        tell(player, 'ui.verify.marked');
                    }
                    this.showVerifyResult(player);
                } else {
                    this.showVerifyResult(player);
                }
            });
        };

        showPage();
    }
}

module.exports = { UIManager };