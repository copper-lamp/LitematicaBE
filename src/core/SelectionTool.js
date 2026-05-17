// SelectionTool - 选区工具
// 处理玩家使用木剑选取两个坐标点的逻辑

class SelectionTool {
    constructor() {
        // 存储玩家的选区状态: xuid -> { pos1: {x,y,z,dim}, pos2: {x,y,z,dim}, state: 'idle'|'waiting_pos1'|'waiting_pos2' }
        this.selections = new Map();
        // 冷却时间防止重复触发
        this.cooldowns = new Map();
    }

    /**
     * 开始选区流程
     */
    startSelection(player) {
        const xuid = player.xuid;
        this.selections.set(xuid, {
            pos1: null,
            pos2: null,
            state: 'waiting_pos1',
            dimension: player.dim
        });
        player.tell('§a请使用 §e木剑右键 §a选择第 §e1 §a个坐标点');
        player.tell('§7提示: 手持木剑，右键点击方块即可选择');
    }

    /**
     * 取消选区
     */
    cancelSelection(player) {
        this.selections.delete(player.xuid);
        player.tell('§c选区已取消');
    }

    /**
     * 获取玩家的选区状态
     */
    getSelection(xuid) {
        return this.selections.get(xuid);
    }

    /**
     * 检查玩家是否正在选区
     */
    isSelecting(xuid) {
        const sel = this.selections.get(xuid);
        return sel && (sel.state === 'waiting_pos1' || sel.state === 'waiting_pos2');
    }

    /**
     * 处理木剑右键事件
     * @returns {boolean} 是否消耗事件（true=继续处理，false=拦截）
     */
    handleSwordClick(player, block) {
        const xuid = player.xuid;
        const sel = this.selections.get(xuid);

        if (!sel) return true;
        if (sel.dimension !== player.dim) {
            player.tell('§c错误: 两个选区点必须在同一维度');
            return false;
        }

        // 冷却检查
        const now = Date.now();
        const lastClick = this.cooldowns.get(xuid) || 0;
        if (now - lastClick < 500) return false;
        this.cooldowns.set(xuid, now);

        const pos = {
            x: Math.floor(block.pos.x),
            y: Math.floor(block.pos.y),
            z: Math.floor(block.pos.z)
        };

        if (sel.state === 'waiting_pos1') {
            sel.pos1 = pos;
            sel.state = 'waiting_pos2';
            player.tell(`§a第 1 个坐标点已选择: §e(${pos.x}, ${pos.y}, ${pos.z})`);
            player.tell('§a请使用 §e木剑右键 §a选择第 §e2 §a个坐标点');
            return false;
        } else if (sel.state === 'waiting_pos2') {
            sel.pos2 = pos;
            sel.state = 'completed';
            player.tell(`§a第 2 个坐标点已选择: §e(${pos.x}, ${pos.y}, ${pos.z})`);

            // 计算选区范围
            const region = this.calculateRegion(sel.pos1, sel.pos2);
            const volume = (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1) * (region.maxZ - region.minZ + 1);

            player.tell(`§a选区完成!`);
            player.tell(`§7范围: §f(${region.minX}, ${region.minY}, ${region.minZ}) §7到 §f(${region.maxX}, ${region.maxY}, ${region.maxZ})`);
            player.tell(`§7尺寸: §f${region.maxX - region.minX + 1}×${region.maxY - region.minY + 1}×${region.maxZ - region.minZ + 1} §7= §f${volume} §7个方块`);

            // 触发选区完成回调
            this.onSelectionComplete(player, region);
            return false;
        }

        return true;
    }

    /**
     * 计算规整的选区范围
     */
    calculateRegion(pos1, pos2) {
        return {
            minX: Math.min(pos1.x, pos2.x),
            minY: Math.min(pos1.y, pos2.y),
            minZ: Math.min(pos1.z, pos2.z),
            maxX: Math.max(pos1.x, pos2.x),
            maxY: Math.max(pos1.y, pos2.y),
            maxZ: Math.max(pos1.z, pos2.z)
        };
    }

    /**
     * 选区完成回调（由外部设置）
     */
    onSelectionComplete(player, region) {
        // 默认实现: 打开保存UI
        // 外部可以通过设置此回调来自定义行为
        if (this._onCompleteCallback) {
            this._onCompleteCallback(player, region);
        }
    }

    /**
     * 设置选区完成回调
     */
    setOnCompleteCallback(callback) {
        this._onCompleteCallback = callback;
    }

    /**
     * 清理玩家选区数据
     */
    cleanup(xuid) {
        this.selections.delete(xuid);
        this.cooldowns.delete(xuid);
    }
}

module.exports = { SelectionTool };
