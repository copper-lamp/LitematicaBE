// UIManager - UI管理器
// 处理GUI表单、屏幕提示、ActionBar消息等

const fs = require('fs');
const path = require('path');
const { bidirectionalConverter } = require('../mappings/BidirectionalBlockConverter');

class UIManager {
    constructor() {
        this.actionBarMessages = new Map();
        this.lastVerifyResults = new Map();
        this.schematicsDir = './plugins/LitematicaBE/schematics/';
        this.startActionBarLoop();
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
                if (ext === '.litematic') {
                    const name = path.basename(file, ext);
                    schematics.push({
                        name: name,
                        file: file,
                        type: 'litematic'
                    });
                }
            }
        } catch (e) {
            logger.error(`[UIManager] 读取原理图目录失败: ${e.message}`);
        }
        
        return schematics;
    }

    startActionBarLoop() {
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
        fm.setContent('Litematica BE v2.4.2\n选择一个操作：');

        fm.addButton('加载投影');
        fm.addButton('保存投影');
        fm.addButton('投影管理');
        fm.addButton('投影操作');
        fm.addButton('关于投影');

        player.sendForm(fm, (player, data) => {
            if (data === null) return;

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
        fm.setTitle('关于投影');
        fm.setContent(
            '§6§lLitematica BE§r\n\n' +
            '§7版本: §f2.4.2\n\n' +
            '§e§l功能说明:§r\n' +
            '§f• 加载原理图 (.litematic)\n' +
            '§f• 保存原理图\n' +
            '§f• 逐层渲染\n' +
            '§f• 木剑换层\n' +
            '§f• 轻松放置\n' +
            '§f• 投影打印机§r\n\n' +
            '§e§l使用教学:§r\n' +
            '§a1. §f手持§6木剑§f蹲下点击打开主菜单\n' +
            '§a2. §f选择"浏览新原理图"加载.litematic文件\n' +
            '§a3. §f投影会放置在玩家脚下位置\n' +
            '§a4. §f在 §e投影操作 §f开启逐层建造模式\n' +
            '§a5. §f逐层模式下，§6抬头向上§f切换下层，§6低头向下§f切换上层\n' +
            '§a6. §f手持材料对准投影即可轻松放置\n' +
            '§a7. §f开启投影打印机可自动快速放置方块§r\n\n' +
            '§e§l开发者信息:§r\n' +
            '§f开发团队: copper-lamp\n' +
            '§fGitHub: §bhttps://github.com/copper-lamp/LitematicaBE§r\n\n' +
            '§f本项目为公益开源项目，与java版Litematica兼容\n' +
            '§e§lBug反馈:§r\n' +
            '§f如果遇到问题，请前往GitHub仓库提交Issue，我们会尽快修复\n' +
            '§f加入QQ群 861900673 反馈问题§r'
        );
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            this.showMainMenu(player);
        });
    }

    // ==================== 保存原理图菜单 ====================

    showSaveSchematicMenu(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('保存原理图');
        fm.setContent('使用木剑选取两个坐标点，将选区保存为.litematic文件\n\n作者将自动设置为您的玩家ID');

        fm.addButton('开始选区');
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
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
            player.tell('§c错误: 选区工具未初始化');
            return;
        }

        selectionTool.startSelection(player);
        //player.tell('§a选区模式已启动');
        //player.tell('§7使用木剑右键点击方块选择坐标');
    }

    /**
     * 显示保存原理图UI表单（选区完成后调用）
     */
    showSaveSchematicForm(player, region) {
        const fm = mc.newCustomForm();
        fm.setTitle('保存原理图');
        fm.addLabel(
            `选区范围: (${region.minX}, ${region.minY}, ${region.minZ}) ， (${region.maxX}, ${region.maxY}, ${region.maxZ})\n` +
            `尺寸: ${region.maxX - region.minX + 1}×${region.maxY - region.minY + 1}×${region.maxZ - region.minZ + 1}\n` +
            `作者: ${player.name}`
        );
        fm.addInput('原理图名称', '输入原理图名称...', '');
        fm.addInput('描述（可选）', '输入描述...', '');

        player.sendForm(fm, (player, data) => {
            if (data === null || data === undefined) {
                player.tell('§c保存已取消');
                const selectionTool = global.selectionTool;
                if (selectionTool) selectionTool.cleanup(player.xuid);
                return;
            }

            const fileName = data[1] ? String(data[1]).trim() : '';
            const description = data[2] ? String(data[2]).trim() : '';

            if (!fileName) {
                player.tell('§c错误: 原理图名称不能为空');
                this.showSaveSchematicForm(player, region);
                return;
            }

            // 验证文件名
            if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(fileName)) {
                player.tell('§c错误: 名称只能包含字母、数字、下划线、横线和中文');
                this.showSaveSchematicForm(player, region);
                return;
            }

            this.doSaveSchematic(player, region, fileName, description);
        });
    }

    /**
     * 执行保存原理图
     */
    async doSaveSchematic(player, region, fileName, description) {
        const schematicSaver = global.schematicSaver;
        const selectionTool = global.selectionTool;

        if (!schematicSaver) {
            player.tell('§c错误: 保存器未初始化');
            return;
        }

        player.tell('§a正在扫描方块...');

        try {
            const result = await schematicSaver.saveSchematic(
                region,
                player.dim,
                fileName,
                player.name,
                description
            );

            player.tell(`§a原理图保存成功!`);
            player.tell(`§7文件: §f${result.fileName}.litematic`);
            player.tell(`§7方块数: §f${result.blockCount}`);
            player.tell(`§7尺寸: §f${result.dimensions.x}×${result.dimensions.y}×${result.dimensions.z}`);

            // 清理选区状态
            if (selectionTool) selectionTool.cleanup(player.xuid);

        } catch (e) {
            player.tell(`§c保存失败: ${e.message}`);
            logger.error(`[UIManager] saveSchematic error: ${e.message}`);
            logger.error(`[UIManager] Stack: ${e.stack}`);
        }
    }

    showSchematicBrowser(player, onSelect = null) {
        // 直接读取 schematics 目录
        const schematics = this.listSchematics();
        if (schematics.length === 0) {
            player.tell('§c未找到原理图文件！');
            player.tell('§7请将.litematic文件放入 plugins/LitematicaBE/schematics/ 目录');
            this.showMainMenu(player);
            return;
        }

        const fm = mc.newSimpleForm();
        fm.setTitle('原理图浏览器');
        fm.setContent(`找到 ${schematics.length} 个原理图文件\n选择一个来加载并放置：`);

        for (const schem of schematics) {
            fm.addButton(`${schem.name}\n${schem.type.toUpperCase()} 格式`);
        }

        player.sendForm(fm, (player, data) => {
            if (data === null) {
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
        fm.setTitle('放置投影');

        // 投影信息
        const totalBlocks = loadedSchematic.totalBlocks || (loadedSchematic.blocks?.length || 0);
        const dims = loadedSchematic.dimensions || { x: '?', y: '?', z: '?' };
        const isMega = loadedSchematic.isMega && loadedSchematic.schematicId;
        const version = loadedSchematic.version || '未知';
        const timeCreated = loadedSchematic.timeCreated
            ? new Date(Number(loadedSchematic.timeCreated)).toLocaleString()
            : '未知';
        const timeModified = loadedSchematic.timeModified
            ? new Date(Number(loadedSchematic.timeModified)).toLocaleString()
            : '未知';

        fm.addLabel(`投影名称: ${loadedSchematic.name}`);
        fm.addLabel(`作者: ${loadedSchematic.author || '未知'}`);
        fm.addLabel(`尺寸: ${dims.x} x ${dims.y} x ${dims.z}`);
        fm.addLabel(`方块数: ${totalBlocks.toLocaleString()}`);
        fm.addLabel(`创建时间: ${timeCreated}`);
        fm.addLabel(`修改时间: ${timeModified}`);
        fm.addLabel(`数据版本: ${version}`);
        if (isMega) {
            fm.addLabel('当前投影为超大型投影 - 将使用LOD优化');
        }

        // 坐标输入 - 紧凑排列
        fm.addLabel('--- 放置坐标 ---');
        fm.addInput(`X = ${defaultX}`, `${defaultX}`, `${defaultX}`);
        fm.addInput(`Y = ${defaultY}`, `${defaultY}`, `${defaultY}`);
        fm.addInput(`Z = ${defaultZ}`, `${defaultZ}`, `${defaultZ}`);

        fm.addLabel('点击提交放置投影');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showSchematicBrowser(player);
                return;
            }

            const labelCount = isMega ? 9 : 8;
            const inputX = data[labelCount] || `${defaultX}`;
            const inputY = data[labelCount + 1] || `${defaultY}`;
            const inputZ = data[labelCount + 2] || `${defaultZ}`;

            const placePos = {
                x: parseInt(inputX) || defaultX,
                y: parseInt(inputY) || defaultY,
                z: parseInt(inputZ) || defaultZ
            };

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
            const isMega = loadedSchematic.isMega && loadedSchematic.schematicId;

            // 复制原始 .litematic 到 Mega 目录，方便材料清单等功能使用
            if (isMega && loadedSchematic.filePath) {
                try {
                    const megaDir = path.join('./plugins/LitematicaBE/mega_schematics/', loadedSchematic.schematicId);
                    const destPath = path.join(megaDir, 'original.litematic');
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
                dimension: player.dim,
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

            // 默认关闭逐层渲染（显示全部层）
            renderer.layerRenderMode.set(player.xuid, false);
            renderer.currentRenderLayer.set(player.xuid, -1);
            renderer.startRender(player, projection, -1);
            // MegaProjectionRenderer.onTick 会通过 updateBlocks 注入 LOD 方块数据

            logger.info(`[LitematicaBE] 投影 "${projection.name}" 已加载 | 位置: (${placePos.x}, ${placePos.y}, ${placePos.z}) | 方块数: ${loadedSchematic.totalBlocks || loadedSchematic.blocks?.length || 0}`);
            if (isMega) {
                logger.info('[LitematicaBE] MEGA模式 - 使用LOD优化');
            }

            player.tell(`投影已放置于 (${placePos.x}, ${placePos.y}, ${placePos.z})`);

        } catch (e) {
            player.tell('放置失败：' + e.message);
            logger.error(`[UIManager] executePlaceSchematic error: ${e.message}`);
            logger.error(`[UIManager] Stack: ${e.stack}`);
        }
    }

    // 直接放置全部方块（OP+创造模式）
    async directPlaceAllBlocks(player, data, placePos) {
        const dimid = player.pos.dimid;
        const isMega = data.isMega && data.schematicId;
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
            const javaStates = block.state || {};

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

                const cmd = BlockConversions.buildSetBlockCommand(wx, wy, wz, converted.name, finalStates);
                const result = mc.runcmdEx(cmd);

                if (result.success) {
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
                player.tell('§c没有找到分块数据');
                return;
            }

            let totalBlocks = 0;
            const meta = megaManager.getMeta(data.schematicId);
            if (meta && meta.totalBlocks) {
                totalBlocks = meta.totalBlocks;
            } else {
                player.tell('§e警告: 无法获取方块总数，将显示进度百分比');
            }

            player.tell(`§a开始分块放置 ${totalBlocks > 0 ? totalBlocks.toLocaleString() : '?'} 个方块...`);
            player.tell(`§7共 ${chunkFiles.length} 个分块`);

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
                    player.tell(`§7进度: ${chunkIdx}/${chunkFiles.length} 分块 (${pct}%), 已放置 ${placed.toLocaleString()}`);
                }
            }

            await new Promise(r => setImmediate(r));
        } else {
            const blocks = data.blocks || [];
            if (blocks.length === 0) {
                player.tell('§c没有找到方块数据');
                return;
            }

            player.tell(`§a开始放置 ${blocks.length.toLocaleString()} 个方块...`);

            for (let i = 0; i < blocks.length; i++) {
                processBlock(blocks[i]);
                batchCounter++;

                if (batchCounter >= batchSize && i + 1 < blocks.length) {
                    batchCounter = 0;
                    await new Promise(r => setImmediate(r));
                }
            }
        }

        player.tell(`§a完成: ${placed} 个方块已放置${errors > 0 ? `, §c${errors} 个失败` : ''}`);
    }

    async loadAndPlaceSchematic(player, schematic) {
        const loadSchematicFile = global.loadSchematicFile;

        try {
            // 使用 loadSchematicFile 以支持 Mega 模式自动检测
            const loadedSchematic = await loadSchematicFile(schematic.file.replace('.litematic', ''));

            if (!loadedSchematic) {
                player.tell('§c加载失败：无法解析原理图文件');
                return;
            }

            // 显示放置面板，让玩家确认坐标
            this.showPlacementPanel(player, schematic, loadedSchematic);

        } catch (e) {
            player.tell('§c加载失败：' + e.message);
            logger.error(`[UIManager] loadAndPlaceSchematic error: ${e.message}`);
            logger.error(`[UIManager] Stack: ${e.stack}`);
        }
    }

    showLoadProjection(player) {
        const dataManager = global.dataManager;
        if (!dataManager) {
            player.tell('§c错误：数据管理器未初始化');
            this.showMainMenu(player);
            return;
        }

        const projections = dataManager.getAllProjections();

        const fm = mc.newSimpleForm();
        fm.setTitle('加载投影');

        if (projections.length === 0) {
            fm.setContent('暂无已放置的投影\n\n请先使用原理图浏览器加载原理图');
            fm.addButton('+ 浏览新原理图');
            fm.addButton('返回主菜单');

            player.sendForm(fm, (player, data) => {
                if (data === 0) {
                    this.showSchematicBrowser(player);
                } else {
                    this.showMainMenu(player);
                }
            });
            return;
        }

        fm.setContent(`找到 ${projections.length} 个已放置的投影\n点击选择一个投影查看详情：`);

        for (const proj of projections) {
            if (!proj) continue;
            const status = this.isProjectionLoaded(player, proj.id) ? '[已加载]' : '[未加载]';
            fm.addButton(`${proj.name || '未命名'}\n${status} (${proj.dimensions?.x || '?'}×${proj.dimensions?.y || '?'}×${proj.dimensions?.z || '?'})`);
        }
        fm.addButton('+ 浏览新原理图');
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
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

    showProjectionDetail(player, projection) {
        if (!projection) {
            player.tell('§c投影不存在');
            this.showMainMenu(player);
            return;
        }
        
        const isLoaded = this.isProjectionLoaded(player, projection.id);
        const renderer = global.renderer;
        const currentLayer = renderer?.currentRenderLayer?.get(player.xuid) || 0;

        const fm = mc.newSimpleForm();
        fm.setTitle('投影详情');
        fm.setContent(
            `投影名称: ${projection.name}\n` +
            `位置: (${projection.position?.x}, ${projection.position?.y}, ${projection.position?.z})\n` +
            `尺寸: ${projection.dimensions?.x}×${projection.dimensions?.y}×${projection.dimensions?.z}\n` +
            `方块数: ${projection.blocks?.length || 0}\n` +
            `状态: ${isLoaded ? '已加载' : '未加载'}\n` +
            (isLoaded ? `当前层: 第 ${currentLayer} 层` : '')
        );

        if (isLoaded) {
            fm.addButton('卸载投影');
        } else {
            fm.addButton('加载投影');
        }
        fm.addButton('查看材料清单');
        fm.addButton('直接放置全部方块');
        fm.addButton('删除投影');
        fm.addButton('返回');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showLoadProjection(player);
                return;
            }

            switch (data) {
                case 0:
                    if (isLoaded) {
                        this.unloadProjection(player, projection);
                    } else {
                        this.renderProjection(player, projection);
                    }
                    break;
                case 1:
                    this.showMaterialList(player, projection);
                    break;
                case 2:
                    // 直接放置全部方块（需要OP+创造模式）
                    const isCreative = player.gameMode === 1;
                    const isOp = typeof player.isOP === 'function' ? player.isOP() : false;
                    if (!isCreative || !isOp) {
                        player.tell('§c此功能需要创造模式且具有OP权限');
                        this.showProjectionDetail(player, projection);
                        return;
                    }
                    player.tell('§a正在直接放置全部方块，请稍候...');
                    this.directPlaceAllBlocks(player, projection);
                    // 放置完成后返回详情页
                    setTimeout(() => {
                        this.showProjectionDetail(player, projection);
                    }, 1000);
                    break;
                case 3:
                    this.confirmDeleteProjection(player, projection);
                    break;
                case 4:
                default:
                    this.showLoadProjection(player);
                    break;
            }
        });
    }

    renderProjection(player, projection) {
        const renderer = global.renderer;
        if (!renderer) {
            player.tell('§c错误：渲染器未初始化');
            return;
        }

        if (!projection || !projection.blocks || projection.blocks.length === 0) {
            player.tell('§c错误：投影数据无效');
            return;
        }

        if (this.isProjectionLoaded(player, projection.id)) {
            player.tell('§c该投影已在渲染中');
            return;
        }

        player.tell(`§a正在渲染投影: ${projection.name}`);
        player.tell(`§a方块数: ${projection.blocks.length}`);

        renderer.startRender(player, projection, -1);

        setTimeout(() => {
            this.showProjectionDetail(player, projection);
        }, 500);
    }

    isProjectionLoaded(player, projectionId) {
        if (!projectionId) return false;
        const renderer = global.renderer;
        if (!renderer) return false;
        const task = renderer.activeProjections.get(player.xuid);
        return task && task.projection && task.projection.id === projectionId;
    }

    unloadProjection(player, projection) {
        const renderer = global.renderer;
        if (!renderer) {
            player.tell('错误：渲染器未初始化');
            return;
        }

        renderer.cancelRender(player);
        player.tell(`§a投影 "${projection.name}" 已卸载`);

        setTimeout(() => {
            this.showProjectionDetail(player, projection);
        }, 500);
    }

    confirmDeleteProjection(player, projection) {
        const fm = mc.newSimpleForm();
        fm.setTitle('确认删除');
        fm.setContent(
            `确定要删除投影 "${projection.name}" 吗？\n\n此操作将永久删除该投影数据，不可恢复。`
        );
        fm.addButton('确认删除');
        fm.addButton('取消');

        player.sendForm(fm, (player, data) => {
            if (data === 0) {
                const dataManager = global.dataManager;
                if (dataManager && projection && projection.id) {
                    if (this.isProjectionLoaded(player, projection.id)) {
                        renderer.cancelRender(player);
                    }
                    dataManager.removeProjection(projection.id);
                    player.tell(`§a投影 "${projection.name}" 已删除`);
                }
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
        fm.setTitle('材料清单');
        fm.setContent(
            `投影: ${projection.name}\n\n` +
            `方块总数: ${projection.blocks?.length || 0}\n\n` +
            `点击"生成Excel"导出材料清单到文件`
        );
        fm.addButton('生成Excel');
        fm.addButton('返回');

        player.sendForm(fm, (player, data) => {
            if (data === null || data === 1) {
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
            player.tell('§c错误：材料统计模块未初始化');
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
            player.tell('§c错误：数据管理器未初始化');
            this.showMainMenu(player);
            return;
        }

        const projections = dataManager.getAllProjections();

        const fm = mc.newSimpleForm();
        fm.setTitle('投影管理');

        if (projections.length === 0) {
            fm.setContent('暂无投影\n\n请先加载原理图');
        } else {
            fm.setContent(`共 ${projections.length} 个投影`);
            for (const proj of projections) {
                fm.addButton(`${proj.name}\n(${proj.position?.x}, ${proj.position?.y}, ${proj.position?.z})`);
            }
        }

        fm.addButton('删除所有投影');
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
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
                    player.tell('§c错误：投影数据无效');
                    this.showProjectionManage(player);
                }
            } else {
                this.showMainMenu(player);
            }
        });
    }

    showSettings(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('LitematicaBE 设置');
        fm.setContent('选择设置选项：');

        fm.addButton('清除所有投影');
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            if (data === null || data === 1) {
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
        fm.setTitle('确认清除');
        fm.setContent('确定要清除所有投影吗？\n此操作不可恢复。');
        fm.addButton('确认清除');
        fm.addButton('取消');

        player.sendForm(fm, (player, data) => {
            if (data === 0) {
                const dataManager = global.dataManager;
                if (dataManager) {
                    const projections = dataManager.getAllProjections();
                    for (const proj of projections) {
                        if (proj && proj.id) {
                            dataManager.removeProjection(proj.id);
                        }
                    }
                    player.tell('§a所有投影已清除');
                }
            }
            this.showMainMenu(player);
        });
    }

    showProjectionOperations(player) {
        const renderer = global.renderer;
        const easyPlaceManager = global.easyPlaceManager;
        
        if (!renderer) {
            player.tell('§c错误：渲染器未初始化');
            this.showMainMenu(player);
            return;
        }

        const isLayerMode = renderer.layerRenderMode?.get(player.xuid) || false;
        const isEasyPlace = easyPlaceManager?.isEnabled(player) || false;
        const isFastPlace = easyPlaceManager?.isFastPlaceEnabled(player) || false;
        const hasActive = renderer.activeProjections?.has(player.xuid);

        const layerStatus = isLayerMode ? '开启' : '关闭';
        const easyStatus = isEasyPlace ? '开启' : '关闭';
        const fastStatus = isFastPlace ? '开启' : '关闭';
        const projStatus = hasActive ? '已加载' : '未加载';

        const fm = mc.newSimpleForm();
        fm.setTitle('投影操作');
        fm.setContent(
            `当前状态:\n` +
            `逐层显示: ${layerStatus}\n` +
            `轻松放置: ${easyStatus}\n` +
            `投影打印机: ${fastStatus}\n` +
            `投影状态: ${projStatus}`
        );

        fm.addButton(`${isLayerMode ? '关闭' : '开启'}逐层显示`);
        fm.addButton(`${isEasyPlace ? '关闭' : '开启'}轻松放置`);
        fm.addButton(`${isFastPlace ? '关闭' : '开启'}投影打印机`);
        fm.addButton('验证投影');
        fm.addButton('取消渲染');
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showMainMenu(player);
                return;
            }

            switch (data) {
                case 0:
                    this.toggleLayerRenderFromMenu(player);
                    break;
                case 1:
                    this.toggleEasyPlaceFromMenu(player);
                    break;
                case 2:
                    this.toggleFastPlaceFromMenu(player);
                    break;
                case 3:
                    this.showVerifyResult(player);
                    break;
                case 4:
                    this.cancelRenderFromMenu(player);
                    break;
                case 5:
                default:
                    this.showMainMenu(player);
                    break;
            }
        });
    }

    toggleLayerRenderFromMenu(player) {
        const renderer = global.renderer;
        const dataManager = global.dataManager;
        const projManager = global.projManager;
        
        if (!renderer) {
            player.tell('§c错误：渲染器未初始化');
            this.showProjectionOperations(player);
            return;
        }

        if (!renderer.layerRenderMode) {
            renderer.layerRenderMode = new Map();
        }

        const current = renderer.layerRenderMode.get(player.xuid) || false;
        renderer.layerRenderMode.set(player.xuid, !current);

        const status = !current ? '§a开启' : '§c关闭';
        player.tell(`逐层渲染模式已${status}`);

        // 自动切换到建造模式
        if (!current && dataManager) {
            dataManager.setPlayerToolMode(player.xuid, 'build');
            player.tell('§a已自动切换到建造模式');
        }

        const activeProj = projManager?.getActiveProjectionByPlayer(player);
        if (activeProj) {
            const projection = activeProj.projection;
            if (!current) {
                // 开启逐层模式，默认从第0层开始
                renderer.currentRenderLayer.set(player.xuid, 0);
                projManager.switchLayer(player, 'up');
                player.tell(`已切换到第 0 层（共 ${projection.dimensions.y} 层）`);
            } else {
                projManager.switchLayer(player, 'all');
                renderer.currentRenderLayer.set(player.xuid, -1);
                player.tell('已切换到完整渲染模式');
            }
        }

        setTimeout(() => {
            this.showProjectionOperations(player);
        }, 500);
    }

    toggleEasyPlaceFromMenu(player) {
        const easyPlaceManager = global.easyPlaceManager;
        if (!easyPlaceManager) {
            player.tell('§c错误：轻松放置模块未初始化');
            this.showProjectionOperations(player);
            return;
        }

        easyPlaceManager.toggle(player);

        setTimeout(() => {
            this.showProjectionOperations(player);
        }, 500);
    }

    cancelRenderFromMenu(player) {
        const renderer = global.renderer;
        if (!renderer) {
            player.tell('§c错误：渲染器未初始化');
            this.showMainMenu(player);
            return;
        }

        renderer.cancelRender(player);

        setTimeout(() => {
            this.showMainMenu(player);
        }, 500);
    }

    toggleFastPlaceFromMenu(player) {
        const easyPlaceManager = global.easyPlaceManager;
        if (!easyPlaceManager) {
            player.tell('§c错误：轻松放置模块未初始化');
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
            player.tell('§c错误：验证模块未初始化');
            this.showProjectionOperations(player);
            return;
        }

        const activeProj = projManager?.getActiveProjectionByPlayer(player);

        if (!activeProj || !activeProj.projection) {
            player.tell('§c没有活动的投影');
            this.showProjectionOperations(player);
            return;
        }

        const projection = activeProj.projection;
        player.tell('§7正在验证投影，请稍候...');

        // 执行核心验证
        const results = blockVerifier.verifyProjection(projection);

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

        let content = `投影: ${projection.name}\n\n`;
        content += `§e总方块数: §f${results.total}\n`;
        content += `§a完全匹配: §f${results.match}\n`;
        content += `§e状态错误: §f${results.typeMatch}\n`;
        content += `§c错误方块: §f${results.noMatch}\n`;
        content += `§b缺失方块: §f${results.missing}\n`;

        if (extraResult) {
            content += `§6多余方块: §f${extraResult.extraCount}`;
            if (extraResult.totalScanned >= 50000) {
                content += ` §7(已扫描${extraResult.totalScanned}格)`;
            }
            content += '\n';
        }

        content += `\n§7完成度: §f${matchPercent}%\n`;
        content += `§7问题方块合计: §f${allProblems.length} 个`;

        // 简要问题分布
        if (allProblems.length > 0) {
            const sampleCount = Math.min(allProblems.length, 5);
            content += '\n\n§7问题方块示例:\n';
            for (let i = 0; i < sampleCount; i++) {
                const b = allProblems[i];
                const colorChar = b.level === 'extra' ? '§6' : 
                    (b.level === 1 ? '§c' : (b.level === 2 ? '§e' : '§b'));
                const name = b.levelName || (b.level === 'extra' ? '多余方块' : '未知');
                content += `${colorChar}  ${name} @ (${b.position.x}, ${b.position.y}, ${b.position.z})\n`;
            }
            if (allProblems.length > 5) {
                content += `§7  ... 还有 ${allProblems.length - 5} 个问题方块`;
            }
        }

        const fm = mc.newSimpleForm();
        fm.setTitle('验证结果');
        fm.setContent(content);

        if (allProblems.length > 0) {
            fm.addButton('标注问题方块');
        }
        fm.addButton('详细问题列表');
        fm.addButton('刷新验证');
        fm.addButton('返回');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
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
                    player.tell('§c验证结果已过期，请重新验证');
                    this.showProjectionOperations(player);
                    return;
                }
                const marked = blockVerifier.markProblemBlocks(player, saved.allProblems);
                if (marked > 0) {
                    setTimeout(() => this.showProjectionOperations(player), 1000);
                } else {
                    player.tell('§c无法标记问题方块（可能所有问题位置均未加载）');
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
            player.tell('§c验证结果已过期，请重新验证');
            this.showProjectionOperations(player);
            return;
        }

        const allProblems = saved.allProblems;
        if (allProblems.length === 0) {
            player.tell('§a没有检测到问题方块');
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
            fm.setTitle(`问题方块 (${currentPage + 1}/${totalPages})`);

            let content = '';
            for (let i = 0; i < pageBlocks.length; i++) {
                const b = pageBlocks[i];
                const idx = start + i + 1;
                let catName = b.levelName;
                if (b.level === 'extra') catName = '§6多余方块';
                else if (b.level === 1) catName = '§c错误方块';
                else if (b.level === 2) catName = '§e状态错误';
                else if (b.level === 4) catName = '§b缺失方块';

                content += `${idx}. ${catName}§r @ (${b.position.x}, ${b.position.y}, ${b.position.z})\n`;
            }

            content += `\n§7共 ${allProblems.length} 个问题方块`;

            fm.setContent(content);

            // 每个问题方块一个按钮用于传送
            for (let i = 0; i < pageBlocks.length; i++) {
                fm.addButton(`传送到 #${start + i + 1}`);
            }

            if (currentPage < totalPages - 1) {
                fm.addButton('下一页 ▶');
            }
            if (currentPage > 0) {
                fm.addButton('◀ 上一页');
            }

            fm.addButton('标注全部问题方块');
            fm.addButton('返回');

            player.sendForm(fm, (player, data) => {
                if (data === null) {
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
                        player.tell(`§c传送失败: ${e.message}`);
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
                        player.tell('§a已标注全部问题方块');
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