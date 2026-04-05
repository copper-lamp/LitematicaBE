﻿// UIManager - UI管理器
// 处理GUI表单、屏幕提示、ActionBar消息等

const fs = require('fs');
const path = require('path');

class UIManager {
    constructor() {
        this.actionBarMessages = new Map();
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
        fm.setContent('投影工具 v2.1.0\n选择一个操作：');

        fm.addButton('加载投影');
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
                    this.showProjectionManage(player);
                    break;
                case 2:
                    this.showProjectionOperations(player);
                    break;
                case 3:
                    this.showAbout(player);
                    break;
            }
        });
    }

    showAbout(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('关于投影');
        fm.setContent(
            'Litematica BE\n\n' +
            '版本: 2.1.0\n\n' +
            '功能说明:\n' +
            '- 加载原理图文件\n' +
            '- 使用粒子显示投影\n' +
            '- 逐层渲染模式\n' +
            '- 木剑切换层\n' +
            '- 轻松放置辅助\n\n' +
            '使用方法:\n' +
            '- 手持木剑蹲下点击打开菜单\n' +
            '- 逐层模式下用木剑切换层\n' +
            '- 抬头向上切换，低头向下切换'
        );
        fm.addButton('返回主菜单');

        player.sendForm(fm, (player, data) => {
            this.showMainMenu(player);
        });
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

    async loadAndPlaceSchematic(player, schematic) {
        const loader = global.loader;
        const dataManager = global.dataManager;
        const renderer = global.renderer;

        try {
            const SCHEMATIC_PATH = './plugins/LitematicaBE/schematics/';
            let filePath = SCHEMATIC_PATH + schematic.file;

            const loadedSchematic = await loader.load(filePath);

            if (!loadedSchematic) {
                player.tell('§c加载失败：无法解析原理图文件');
                return;
            }

            const pos = player.pos;
            const placePos = {
                x: Math.floor(pos.x),
                y: Math.floor(pos.y) - 1,
                z: Math.floor(pos.z)
            };

            const projection = {
                id: dataManager.generateId(),
                name: loadedSchematic.name,
                author: loadedSchematic.author,
                dimensions: loadedSchematic.dimensions,
                blocks: loadedSchematic.blocks,
                position: placePos,
                dimension: player.dim,
                file: schematic.file,
                rotation: 0,
                mirrorX: false,
                mirrorZ: false,
                enabled: true,
                opacity: 0.8,
                renderLayer: -1,
                showBounds: true,
                boundsColor: "#00FF00",
                createdAt: Date.now(),
                totalBlocks: loadedSchematic.blocks.length
            };

            dataManager.addProjection(projection);
            dataManager.setPlayerCurrentProjection(player.xuid, projection.id);

            const projManager = global.projManager;
            if (projManager) {
                projManager.activateProjection(player, projection);
            }

            const renderer = global.renderer;
            if (renderer) {
                renderer.layerRenderMode.set(player.xuid, false);
                renderer.currentRenderLayer.set(player.xuid, -1);
            }

            renderer.startRender(player, projection, -1);

            player.tell(`§a投影 "${projection.name}" 已加载！`);
            player.tell(`§a位置: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
            player.tell(`§a方块数: ${loadedSchematic.blocks.length}`);
            player.tell(`§e使用 §e/litematica build §e切换到建造模式(逐层渲染)`);

        } catch (e) {
            player.tell('§c加载失败：' + e.message);
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
            const status = this.isProjectionLoaded(player, proj.id) ? '[已加载]' : '[未加载]';
            fm.addButton(`${proj.name}\n${status} (${proj.dimensions?.x}×${proj.dimensions?.y}×${proj.dimensions?.z})`);
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
            this.showProjectionDetail(player, selectedProj);
        });
    }

    showProjectionDetail(player, projection) {
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
                    this.confirmDeleteProjection(player, projection);
                    break;
                case 3:
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
                if (dataManager) {
                    if (this.isProjectionLoaded(player, projection.id)) {
                        renderer.cancelRender(player);
                    }
                    dataManager.removeProjection(projection.id);
                    player.tell('§a投影 "${projection.name}" 已删除');
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
        // 确保MaterialCounter已初始化
        if (!global.materialCounter) {
            const { MaterialCounter } = require('../utils/MaterialCounter');
            global.materialCounter = new MaterialCounter();
        }

        // 生成Excel文件
        global.materialCounter.generateExcel(projection, player);

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
                const projections = dataManager.getAllProjections();
                for (const proj of projections) {
                    dataManager.removeProjection(proj.id);
                }
                player.tell('§a所有投影已清除');
            }
            this.showMainMenu(player);
        });
    }

    showProjectionOperations(player) {
        const renderer = global.renderer;
        if (!renderer) {
            player.tell('§c错误：渲染器未初始化');
            this.showMainMenu(player);
            return;
        }

        const isLayerMode = renderer.layerRenderMode?.get(player.xuid) || false;
        const isEasyPlace = renderer.easyPlaceMode?.get(player.xuid) || false;
        const hasActive = renderer.activeProjections?.has(player.xuid);

        const fm = mc.newSimpleForm();
        fm.setTitle('投影操作');
        fm.setContent(
            `当前状态:\n` +
            `逐层显示: ${isLayerMode ? '开启' : '关闭'}\n` +
            `轻松放置: ${isEasyPlace ? '开启' : '关闭'}\n` +
            `投影状态: ${hasActive ? '已加载' : '未加载'}`
        );

        fm.addButton(`${isLayerMode ? '关闭' : '开启'}逐层显示`);
        fm.addButton(`${isEasyPlace ? '关闭' : '开启'}轻松放置`);
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
                    this.cancelRenderFromMenu(player);
                    break;
                case 3:
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
                const maxLayer = projection.dimensions.y - 1;
                projManager.switchLayer(player, 'down');
                renderer.currentRenderLayer.set(player.xuid, maxLayer);
                player.tell(`§a已切换到第 ${maxLayer} 层（共 ${projection.dimensions.y} 层）`);
            } else {
                projManager.switchLayer(player, 'all');
                renderer.currentRenderLayer.set(player.xuid, -1);
                player.tell('§a已切换到完整渲染模式');
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
}

module.exports = { UIManager };