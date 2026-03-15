// UIManager - UI管理器
// 处理GUI表单、屏幕提示、ActionBar消息等

class UIManager {
    constructor() {
        this.actionBarMessages = new Map(); // 玩家当前的ActionBar消息
        this.startActionBarLoop();
    }

    /**
     * 启动ActionBar更新循环
     */
    startActionBarLoop() {
        mc.listen('onTick', () => {
            this.updateActionBars();
        });
    }

    /**
     * 更新所有ActionBar
     */
    updateActionBars() {
        for (const [xuid, message] of this.actionBarMessages) {
            const player = mc.getPlayer(xuid);
            if (player) {
                player.setTitle(message, 3); // 3 = ActionBar
            }
        }
    }

    /**
     * 设置玩家的ActionBar消息
     */
    setActionBar(player, message) {
        this.actionBarMessages.set(player.xuid, message);
    }

    /**
     * 清除玩家的ActionBar
     */
    clearActionBar(player) {
        this.actionBarMessages.delete(player.xuid);
    }

    /**
     * 显示主菜单
     */
    showMainMenu(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§6Litematica BE');
        fm.setContent('§6投影工具 v2.0.0\n§f选择一个操作：');
        
        fm.addButton('§l加载原理图');
        fm.addButton('§l我的投影');
        fm.addButton('§l选择操作模式');
        fm.addButton('§l设置');
        fm.addButton('§l帮助');

        player.sendForm(fm, (player, data) => {
            if (data === null) return;
            
            switch (data) {
                case 0:
                    this.showSchematicBrowser(player);
                    break;
                case 1:
                    this.showMyProjections(player);
                    break;
                case 2:
                    this.showModeSelector(player);
                    break;
                case 3:
                    this.showSettings(player);
                    break;
                case 4:
                    this.showHelp(player);
                    break;
            }
        });
    }

    /**
     * 显示操作模式选择
     */
    showModeSelector(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§e选择操作模式');
        fm.setContent('§f选择一个模式来使用木剑操作：\n\n');
        
        fm.addButton('§l放置模式\n§7点击方块放置投影');
        fm.addButton('§l旋转模式\n§7点击空气旋转投影');
        fm.addButton('§l建造模式\n§7抬头/低头切换层');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showMainMenu(player);
                return;
            }
            
            const dataManager = global.dataManager;
            switch (data) {
                case 0:
                    dataManager.setPlayerToolMode(player.xuid, 'place');
                    player.tell('§a已切换到 §e放置模式');
                    player.tell('§7使用木剑点击方块放置投影');
                    break;
                case 1:
                    dataManager.setPlayerToolMode(player.xuid, 'rotate');
                    player.tell('§a已切换到 §9旋转模式');
                    player.tell('§7使用木剑点击来旋转投影');
                    break;
                case 2:
                    dataManager.setPlayerToolMode(player.xuid, 'build');
                    player.tell('§a已切换到 §6建造模式');
                    player.tell('§7抬头/低头+木剑切换层');
                    break;
            }
        });
    }

    /**
     * 显示原理图浏览器
     */
    showSchematicBrowser(player, onSelect = null) {
        const schematics = this.getSchematicList();
        
        if (schematics.length === 0) {
            player.tell('§c没有找到原理图文件！');
            player.tell('请将.litematic放入 §fplugins/LitematicaBE/schematics/ §7目录');
            return;
        }

        const fm = mc.newSimpleForm();
        fm.setTitle('§l§b原理图浏览器');
        fm.setContent(`找到 ${schematics.length} 个原理图文件\n§f选择一个来加载：`);

        for (const schem of schematics) {
            fm.addButton(`§f${schem.name}\n§7${schem.type.toUpperCase()} 格式`);
        }

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showMainMenu(player);
                return;
            }

            const selected = schematics[data];
            if (selected) {
                if (onSelect) {
                    onSelect(player, selected);
                } else {
                    this.showModeSelection(player, selected);
                }
            }
        });
    }

    /**
     * 显示模式选择菜单
     */
    showModeSelection(player, schematic) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§a选择操作模式');
        fm.setContent(
            `§f已加载: §e${schematic.name}\n` +
            `§f尺寸: §7${schematic.dimensions?.x || '?'}x${schematic.dimensions?.y || '?'}x${schematic.dimensions?.z || '?'}\n\n` +
            `§f选择一个操作模式：`
        );

        fm.addButton('§l放置模式\n§7使用木剑放置投影');
        fm.addButton('§l旋转模式\n§7使用木剑旋转投影');
        fm.addButton('§l建造模式\n§7分层显示，逐层建造');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showSchematicBrowser(player);
                return;
            }

            const modes = ['place', 'rotate', 'build'];
            const modeNames = ['放置模式', '旋转模式', '建造模式'];
            const selectedMode = modes[data];

            // 保存原理图到玩家会话
            const playerSessions = global.playerSessions;
            if (playerSessions) {
                let session = playerSessions.get(player.xuid);
                if (!session) {
                    session = { selectedSchematic: null, tempProjection: null };
                    playerSessions.set(player.xuid, session);
                }
                session.selectedSchematic = schematic;
            }

            // 设置玩家模式
            const dataManager = global.dataManager;
            dataManager.setPlayerToolMode(player.xuid, selectedMode);
            
            player.tell(`§a已切换到${modeNames[data]}`);
            player.tell('§7使用木剑点击方块进行操作');
        });
    }

    /**
     * 显示我的投影列表
     */
    showMyProjections(player) {
        const dataManager = global.dataManager;
        const projections = dataManager.getAllProjections();
        
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§a投影管理');
        
        if (projections.length === 0) {
            fm.setContent('§c当前没有放置的投影');
            fm.addButton('§l§c返回主菜单');
        } else {
            fm.setContent(`§7当前共有 §e${projections.length} §7个投影\n§f选择要管理的投影：`);
            
            for (const proj of projections) {
                const isOwner = proj.author === player.xuid;
                const owner = isOwner ? '§a你' : '§7其他玩家';
                fm.addButton(`§f${proj.name}\n§7${proj.position?.x || '?'},${proj.position?.y || '?'},${proj.position?.z || '?'} §8| §${owner}`);
            }
            fm.addButton('§l§c删除所有投影');
            fm.addButton('§l§c返回主菜单');
        }

        player.sendForm(fm, (player, data) => {
            if (data === null) return;
            
            if (projections.length === 0) {
                if (data === 0) this.showMainMenu(player);
                return;
            }
            
            if (data === projections.length) {
                this.confirmClearProjections(player);
                return;
            }
            
            if (data === projections.length + 1) {
                this.showMainMenu(player);
                return;
            }
            
            // 选择了一个投影
            const selectedProj = projections[data];
            this.showProjectionManage(player, selectedProj);
        });
    }

    /**
     * 管理单个投影
     */
    showProjectionManage(player, projection) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§e投影管理');
        fm.setContent(`§f投影: §e${projection.name}\n§7位置: (${projection.position?.x}, ${projection.position?.y}, ${projection.position?.z})`);
        
        fm.addButton('§l§a查看信息');
        fm.addButton('§l§b传送到这里');
        fm.addButton('§l§c删除此投影');
        fm.addButton('§l返回列表');

        player.sendForm(fm, (player, data) => {
            if (data === null) {
                this.showMyProjections(player);
                return;
            }
            
            const dataManager = global.dataManager;
            
            switch (data) {
                case 0:
                    player.tell(`§e========== 投影信息 ==========`);
                    player.tell(`§f名称: §e${projection.name}`);
                    player.tell(`§f位置: (${projection.position?.x}, ${projection.position?.y}, ${projection.position?.z})`);
                    player.tell(`§f维度: §f${projection.dimension}`);
                    player.tell(`§f方块数: §f${projection.totalBlocks || '?'}`);
                    player.tell(`§f尺寸: §f${projection.dimensions?.x}x${projection.dimensions?.y}x${projection.dimensions?.z}`);
                    this.showProjectionManage(player, projection);
                    break;
                case 1:
                    if (player.dim === projection.dimension) {
                        player.teleport({ x: projection.position.x + 0.5, y: projection.position.y + 1, z: projection.position.z + 0.5, dim: projection.dimension });
                        player.tell('§a已传送到投影位置');
                    } else {
                        player.tell('§c需要先前往同一维度');
                    }
                    this.showProjectionManage(player, projection);
                    break;
                case 2:
                    dataManager.removeProjection(projection.id);
                    player.tell(`§c已删除投影: ${projection.name}`);
                    this.showMyProjections(player);
                    break;
                case 3:
                    this.showMyProjections(player);
                    break;
            }
        });
    }

    /**
     * 显示设置菜单
     */
    showSettings(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§e设置');
        fm.setContent('§f调整投影显示设置：');

        fm.addButton('§l§b透明度: 80%');
        fm.addButton('§l§a显示范围框: §a开');
        fm.addButton('§l§e范围提示: §a开');
        fm.addButton('§l§f操作提示: §a开');
        fm.addButton('§l§c清除所有投影');
        fm.addButton('§l返回主菜单');

        player.sendForm(fm, (player, data) => {
            if (data === null || data === 5) {
                this.showMainMenu(player);
                return;
            }

            switch (data) {
                case 0:
                    this.showOpacitySettings(player);
                    break;
                case 4:
                    this.confirmClearProjections(player);
                    break;
                default:
                    player.tell('§a设置已更新');
                    this.showSettings(player);
            }
        });
    }

    /**
     * 显示透明度设置
     */
    showOpacitySettings(player) {
        const fm = mc.newSlider();
        fm.setTitle('§l§b透明度设置');
        fm.setContent('§f调整投影方块透明度');
        fm.addSlider('透明度', 0, 100, 80);

        player.sendForm(fm, (player, data) => {
            if (data !== null) {
                const opacity = data[0] / 100;
                player.tell(`§a透明度已设置为 ${data[0]}%`);
            }
            this.showSettings(player);
        });
    }

    /**
     * 确认清除投影
     */
    confirmClearProjections(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§c确认清除');
        fm.setContent('§e确定要清除所有投影吗？\n§7此操作不可恢复。');
        fm.addButton('§c确认清除');
        fm.addButton('§a取消');

        player.sendForm(fm, (player, data) => {
            if (data === 0) {
                const dataManager = global.dataManager;
                const projections = dataManager.getAllProjections();
                for (const proj of projections) {
                    dataManager.removeProjection(proj.id);
                }
                player.tell('§c所有投影已清除');
            }
            this.showMainMenu(player);
        });
    }

    /**
     * 显示帮助
     */
    showHelp(player) {
        const fm = mc.newSimpleForm();
        fm.setTitle('§l§7帮助');
        fm.setContent(
            '§f=== Litematica BE 帮助 ===\n\n' +
            '§6木剑操作:\n' +
            '§f  蹲下 + 点击 §7- 打开菜单\n' +
            '§f  站立 + 点击 §7- 执行当前模式操作\n\n' +
            '§6三种模式:\n' +
            '§b  放置模式 §7- 点击方块放置投影\n' +
            '§d  旋转模式 §7- 点击旋转投影\n' +
            '§e  建造模式 §7- 抬头/低头切换层\n\n' +
            '§6范围提示:\n' +
            '§f  进入投影范围时会显示提示\n' +
            '§f  使用木剑加载投影'
        );
        fm.addButton('§l§a返回主菜单');

        player.sendForm(fm, (player, data) => {
            this.showMainMenu(player);
        });
    }

    /**
     * 显示范围提示
     */
    showRangeNotification(player, projection) {
        const message = `§e附近有一个投影 §f${projection.name} §7| §b使用木剑加载`;
        player.tell(message);
    }

    /**
     * 更新放置模式提示
     */
    updatePlaceModeTip(player, projection) {
        const message = `§a[放置模式] §7点击方块放置 | §e${projection.name} §7| §b旋转: ${projection.rotation}°`;
        this.setActionBar(player, message);
    }

    /**
     * 更新旋转模式提示
     */
    updateRotateModeTip(player, projection) {
        const message = `§b[旋转模式] §7点击旋转投影 | §e${projection.name} §7| §b旋转: ${projection.rotation}°`;
        this.setActionBar(player, message);
    }

    /**
     * 更新建造模式提示
     */
    updateBuildModeTip(player, projection, layer) {
        const progress = Math.round((layer / projection.dimensions.y) * 100);
        const message = `§e[建造模式] §7抬头/低头切换层 | §b层: ${layer}/${projection.dimensions.y} §7| §a进度: ${progress}%`;
        this.setActionBar(player, message);
    }

    /**
     * 获取原理图列表
     */
    getSchematicList() {
        const schematics = [];
        const path = './plugins/LitematicaBE/schematics/';
        
        if (!File.exists(path)) {
            return schematics;
        }

        const files = File.getFilesList(path);
        for (const file of files) {
            if (file.endsWith('.litematic') || file.endsWith('.json')) {
                const name = file.replace('.litematic', '').replace('.json', '');
                const type = file.endsWith('.litematic') ? 'litematic' : 'json';
                schematics.push({ name, file, type });
            }
        }

        return schematics;
    }

    /**
     * 发送模式切换提示
     */
    sendModeChangeTip(player, mode) {
        const modeNames = {
            'place': '§b放置模式',
            'rotate': '§d旋转模式',
            'build': '§e建造模式',
            'none': '§7无模式'
        };

        player.tell(`§a已切换到${modeNames[mode] || mode}`);
        
        switch (mode) {
            case 'place':
                player.tell('§7使用木剑点击方块来放置投影');
                break;
            case 'rotate':
                player.tell('§7使用木剑点击任意位置来旋转投影');
                break;
            case 'build':
                player.tell('§7抬头/低头+木剑切换层，平视切换显示');
                break;
        }
    }
}

module.exports = { UIManager };
