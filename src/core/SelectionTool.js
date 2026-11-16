// SelectionTool - 选区工具
// 处理玩家使用木剑选取两个坐标点的逻辑

// 玩家提示已接入国际化（LSE `i18n`，见 src/i18n/I18n.js）；未加载时回落 key 原文
const { tell } = require('../i18n/I18n');

/**
 * 取玩家所在维度 ID。
 * LSE 的 Player 对象没有 dim / dimid 属性（只有 pos 是 FloatPos，带 dim 文字名与 dimid 数字），
 */
function dimidOf(player) {
    const d = player && player.pos && player.pos.dimid;
    return typeof d === 'number' ? d : 0;
}

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
            dimension: dimidOf(player)
        });
        tell(player, 'selection.point1');
        tell(player, 'selection.hint');
    }

    /**
     * 取消选区
     */
    cancelSelection(player) {
        this.selections.delete(player.xuid);
        tell(player, 'selection.cancelled');
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
        if (sel.dimension !== dimidOf(player)) {
            tell(player, 'selection.sameDimension');
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
            tell(player, 'selection.pos1Selected', pos.x, pos.y, pos.z);
            tell(player, 'selection.point2');
            return false;
        } else if (sel.state === 'waiting_pos2') {
            sel.pos2 = pos;
            sel.state = 'completed';
            tell(player, 'selection.pos2Selected', pos.x, pos.y, pos.z);

            // 计算选区范围
            const region = this.calculateRegion(sel.pos1, sel.pos2);
            const volume = (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1) * (region.maxZ - region.minZ + 1);

            tell(player, 'selection.done');
            tell(player, 'selection.range', region.minX, region.minY, region.minZ, region.maxX, region.maxY, region.maxZ);
            tell(player, 'selection.size',
                region.maxX - region.minX + 1,
                region.maxY - region.minY + 1,
                region.maxZ - region.minZ + 1,
                volume);

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
