class InventoryHelper {
    constructor() {
        this.shulkerBoxTypes = [
            'minecraft:shulker_box',
            'minecraft:white_shulker_box',
            'minecraft:orange_shulker_box',
            'minecraft:magenta_shulker_box',
            'minecraft:light_blue_shulker_box',
            'minecraft:yellow_shulker_box',
            'minecraft:lime_shulker_box',
            'minecraft:pink_shulker_box',
            'minecraft:gray_shulker_box',
            'minecraft:light_gray_shulker_box',
            'minecraft:cyan_shulker_box',
            'minecraft:purple_shulker_box',
            'minecraft:blue_shulker_box',
            'minecraft:brown_shulker_box',
            'minecraft:green_shulker_box',
            'minecraft:red_shulker_box',
            'minecraft:black_shulker_box'
        ];

        this._COLOR_PREFIXES = [
            'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
            'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'
        ];

        this._COLORED_BLOCK_BASES = [
            'wool', 'carpet', 'terracotta', 'concrete', 'concrete_powder',
            'stained_glass', 'stained_glass_pane', 'glazed_terracotta',
            'bed', 'candle', 'banner', 'wall_banner', 'shulker_box'
        ];
    }

    /**
     * 根据方块类型和状态，生成可能在玩家背包中出现的物品名列表。
     * 对于有颜色/特殊变体的方块，基岩版背包中常使用"颜色_方块名"而不是"方块名 + 内部状态"。
     */
    _expandSearchNames(blockType, blockState) {
        const norm = this.normalize(blockType);
        const short = norm.replace(/^minecraft:/, '');
        const results = [norm];

        if (blockState && blockState.color) {
            const color = String(blockState.color).toLowerCase();
            for (const base of this._COLORED_BLOCK_BASES) {
                if (short === base || short.endsWith('_' + base)) {
                    // short 可能是 stained_glass 或 old_color_stained_glass 形式。
                    // 取 base 之前的前缀和 color 拼接新名
                    const prefix = short === base ? '' : short.substring(0, short.length - base.length - 1);
                    const candidate = 'minecraft:' + (prefix ? prefix + '_' : '') + color + '_' + base;
                    if (!results.includes(candidate)) results.push(candidate);
                }
            }
        }

        // 反向：如果 blockType 本身已经是 color_type 形式，则把基名也加上
        for (const prefix of this._COLOR_PREFIXES) {
            for (const base of this._COLORED_BLOCK_BASES) {
                if (short === prefix + '_' + base) {
                    const baseName = 'minecraft:' + base;
                    if (!results.includes(baseName)) results.push(baseName);
                }
            }
        }

        return results;
    }

    selectBlock(player, blockType, blockState = null) {
        const selectedSlot = this.getSelectedSlot(player);
        const inventory = player.getInventory();

        let foundSlot = this.findBlockInInventory(inventory, blockType, selectedSlot, blockState);

        if (foundSlot === -1) {
            foundSlot = this.findBlockInShulkerBoxes(player, inventory, blockType, blockState);
        }

        if (foundSlot === -1) return false;

        if (foundSlot === selectedSlot) return true;

        const success = this.swapItems(inventory, selectedSlot, foundSlot);
        if (success) {
            player.refreshItems();
            return true;
        }
        return false;
    }

    getSelectedSlot(player) {
        try {
            if (player.selectedSlot !== undefined) {
                return player.selectedSlot;
            }
            
            const inventory = player.getInventory();
            if (inventory && inventory.selectedSlot !== undefined) {
                return inventory.selectedSlot;
            }
            
            const nbt = player.getNbt();
            if (nbt) {
                const data = nbt.getData ? nbt.getData() : nbt;
                if (data && data.SelectedSlot !== undefined) {
                    return data.SelectedSlot;
                }
                if (typeof nbt.get === 'function') {
                    try {
                        const slot = nbt.get('SelectedSlot');
                        if (typeof slot === 'number' && slot >= 0 && slot <= 8) {
                            return slot;
                        }
                    } catch (e) {
                    }
                }
            }
        } catch (e) {
            logger.warn(`[EasyPlace] Failed to get selected slot: ${e.message}`);
        }
        return 0;
    }

    findBlockInInventory(inventory, blockType, excludeSlot = -1, blockState = null) {
        const searchNames = this._expandSearchNames(blockType, blockState);
        for (let i = 0; i < 9; i++) {
            if (i === excludeSlot) continue;
            const item = inventory.getItem(i);
            if (item && !item.isNull() && this.matchBlockTypeMulti(item.type, searchNames)) {
                return i;
            }
        }

        for (let i = 9; i < 36; i++) {
            const item = inventory.getItem(i);
            if (item && !item.isNull() && this.matchBlockTypeMulti(item.type, searchNames)) {
                return i;
            }
        }

        return -1;
    }

    isShulkerBox(itemType) {
        if (!itemType) return false;
        const normalized = this.normalize(itemType);
        return this.shulkerBoxTypes.includes(normalized);
    }

    normalize(name) {
        if (!name) return '';
        let n = name.toLowerCase().trim();
        if (!n.includes(':')) n = `minecraft:${n}`;
        return n;
    }

    findBlockInShulkerBoxes(player, inventory, blockType, blockState = null) {
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (!item || item.isNull()) continue;

            if (this.isShulkerBox(item.type)) {
                const found = this.extractFromShulkerBox(player, inventory, i, blockType, blockState);
                if (found !== -1) {
                    return found;
                }
            }
        }
        return -1;
    }

    extractFromShulkerBox(player, inventory, shulkerSlot, blockType, blockState = null) {
        try {
            const shulkerItem = inventory.getItem(shulkerSlot);
            if (!shulkerItem) return -1;

            const nbt = shulkerItem.getNbt();
            if (!nbt) return -1;

            const tag = nbt.getTag ? nbt.getTag('tag') : nbt.get('tag');
            if (!tag) return -1;

            const blockEntityTag = tag.get ? tag.get('BlockEntityTag') : tag.BlockEntityTag;
            if (!blockEntityTag) return -1;

            const items = blockEntityTag.get ? blockEntityTag.get('Items') : blockEntityTag.Items;
            if (!items || !items.length) return -1;

            const searchNames = this._expandSearchNames(blockType, blockState);

            for (let i = 0; i < items.length; i++) {
                const itemNbt = items[i];
                const itemId = itemNbt.get ? itemNbt.get('id') : itemNbt.id;
                
                if (this.matchBlockTypeMulti(itemId, searchNames)) {
                    const slot = itemNbt.get ? itemNbt.get('Slot') : itemNbt.Slot;
                    const count = itemNbt.get ? itemNbt.get('Count') : itemNbt.Count;
                    
                    logger.info(`[EasyPlace] Found ${itemId} x${count} in shulker box at slot ${shulkerSlot}, internal slot ${slot}`);
                    
                    const selectedSlot = this.getSelectedSlot(player);
                    
                    const extracted = this.extractItemFromShulker(inventory, shulkerSlot, i, selectedSlot);
                    if (extracted) {
                        return selectedSlot;
                    }
                }
            }
        } catch (e) {
            logger.warn(`[EasyPlace] Failed to extract from shulker box: ${e.message}`);
        }
        return -1;
    }

    extractItemFromShulker(inventory, shulkerSlot, itemIndex, targetSlot) {
        try {
            const shulkerItem = inventory.getItem(shulkerSlot);
            if (!shulkerItem) return false;

            const nbt = shulkerItem.getNbt();
            if (!nbt) return false;

            let tag = nbt.getTag ? nbt.getTag('tag') : nbt.get('tag');
            if (!tag) {
                tag = nbt.set ? nbt.set('tag', {}) : { tag: {} };
                tag = nbt.get('tag');
            }

            let blockEntityTag = tag.get ? tag.get('BlockEntityTag') : tag.BlockEntityTag;
            if (!blockEntityTag) {
                return false;
            }

            let items = blockEntityTag.get ? blockEntityTag.get('Items') : blockEntityTag.Items;
            if (!items || !items.length) return false;

            const itemNbt = items[itemIndex];
            if (!itemNbt) return false;

            const itemId = itemNbt.get ? itemNbt.get('id') : itemNbt.id;
            const count = (itemNbt.get ? itemNbt.get('Count') : itemNbt.Count) || 1;

            const newItem = mc.newItem(itemId, count);
            if (!newItem) return false;

            const currentTargetItem = inventory.getItem(targetSlot);
            
            if (currentTargetItem && !currentTargetItem.isNull()) {
                if (currentTargetItem.type === itemId && currentTargetItem.count < currentTargetItem.maxCount) {
                    const addCount = Math.min(count, currentTargetItem.maxCount - currentTargetItem.count);
                    currentTargetItem.count += addCount;
                    
                    const remaining = count - addCount;
                    if (remaining > 0) {
                        const remainingItem = mc.newItem(itemId, remaining);
                        player.giveItem(remainingItem);
                    }
                } else {
                    inventory.setItem(targetSlot, newItem);
                    player.giveItem(currentTargetItem);
                }
            } else {
                inventory.setItem(targetSlot, newItem);
            }

            items.splice(itemIndex, 1);

            return true;
        } catch (e) {
            logger.error(`[EasyPlace] Failed to extract item from shulker: ${e.message}`);
            return false;
        }
    }

    matchBlockType(actual, expected) {
        return this.matchBlockTypeMulti(actual, [expected]);
    }

    matchBlockTypeMulti(actual, expectedList) {
        const normActual = this.normalize(actual);
        for (const expected of expectedList) {
            if (this.normalize(expected) === normActual) return true;
        }
        return false;
    }

    swapItems(inventory, slot1, slot2) {
        try {
            const item1 = inventory.getItem(slot1);
            const item2 = inventory.getItem(slot2);

            inventory.setItem(slot1, item2);
            inventory.setItem(slot2, item1);

            return true;
        } catch (e) {
            logger.error(`[EasyPlace] Failed to swap items: ${e.message}`);
            return false;
        }
    }

    countBlock(player, blockType, blockState = null) {
        const inventory = player.getInventory();
        let count = 0;
        const searchNames = this._expandSearchNames(blockType, blockState);

        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item && !item.isNull()) {
                if (this.matchBlockTypeMulti(item.type, searchNames)) {
                    count += item.count;
                } else if (this.isShulkerBox(item.type)) {
                    count += this.countBlockInShulker(item, blockType, blockState);
                }
            }
        }
        return count;
    }

    countBlockInShulker(shulkerItem, blockType, blockState = null) {
        try {
            const nbt = shulkerItem.getNbt();
            if (!nbt) return 0;

            const tag = nbt.getTag ? nbt.getTag('tag') : nbt.get('tag');
            if (!tag) return 0;

            const blockEntityTag = tag.get ? tag.get('BlockEntityTag') : tag.BlockEntityTag;
            if (!blockEntityTag) return 0;

            const items = blockEntityTag.get ? blockEntityTag.get('Items') : blockEntityTag.Items;
            if (!items || !items.length) return 0;

            const searchNames = this._expandSearchNames(blockType, blockState);

            let count = 0;
            for (const itemNbt of items) {
                const itemId = itemNbt.get ? itemNbt.get('id') : itemNbt.id;
                const itemCount = itemNbt.get ? itemNbt.get('Count') : itemNbt.Count;
                
                if (this.matchBlockTypeMulti(itemId, searchNames)) {
                    count += itemCount || 1;
                }
            }
            return count;
        } catch (e) {
            return 0;
        }
    }
}

module.exports = { InventoryHelper };
