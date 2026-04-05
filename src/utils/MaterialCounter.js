// MaterialCounter - 材料统计模块
// 统计投影方块材料并生成Excel表格

const fs = require('fs');
const path = require('path');
const { blockNameMapper } = require('./BlockNameMapper');

class MaterialCounter {
    constructor() {
        this.exportsDir = './plugins/LitematicaBE/exports/';
        this.cooldownMap = new Map(); // 冷却时间记录
        this.COOLDOWN_TIME = 15000; // 15秒冷却
        this.blockNameMapper = blockNameMapper; // 使用独立的映射表
        this.ensureExportsDir();
    }

    // 确保导出目录存在
    ensureExportsDir() {
        if (!fs.existsSync(this.exportsDir)) {
            fs.mkdirSync(this.exportsDir, { recursive: true });
        }
    }

    // 检查并自动安装依赖
    ensureDependency(packageName) {
        try {
            require(packageName);
            return true;
        } catch (e) {
            logger.info(`[MaterialCounter] 正在安装依赖: ${packageName}...`);
            try {
                const { execSync } = require('child_process');
                const pluginDir = path.resolve('./plugins/LitematicaBE');
                execSync(`cd "${pluginDir}" && npm install ${packageName}`, { 
                    stdio: 'pipe',
                    timeout: 60000 
                });
                logger.info(`[MaterialCounter] ${packageName} 安装成功`);
                return true;
            } catch (installErr) {
                logger.error(`[MaterialCounter] ${packageName} 安装失败: ${installErr.message}`);
                return false;
            }
        }
    }

    // 检查冷却时间
    checkCooldown(player) {
        const now = Date.now();
        const lastTime = this.cooldownMap.get(player.xuid) || 0;
        const remaining = this.COOLDOWN_TIME - (now - lastTime);
        
        if (remaining > 0) {
            return {
                canUse: false,
                remainingSeconds: Math.ceil(remaining / 1000)
            };
        }
        
        return { canUse: true, remainingSeconds: 0 };
    }

    // 更新冷却时间
    updateCooldown(player) {
        this.cooldownMap.set(player.xuid, Date.now());
    }

    // 统计材料
    countMaterials(projection) {
        const materials = new Map();
        
        if (!projection || !projection.blocks) {
            return materials;
        }

        for (const block of projection.blocks) {
            const blockName = block.name || 'minecraft:unknown';
            const blockId = block.id !== undefined ? block.id : 0;
            const blockData = block.data !== undefined ? block.data : 0;
            
            // 生成唯一键（包含颜色/变体信息）
            const key = this.getMaterialKey(blockName, blockId, blockData);
            
            if (materials.has(key)) {
                materials.get(key).count++;
            } else {
                materials.set(key, {
                    name: blockName,
                    id: blockId,
                    data: blockData,
                    count: 1,
                    chineseName: this.blockNameMapper.resolve(blockName)
                });
            }
        }
        
        return materials;
    }

    // 生成材料唯一键
    getMaterialKey(name, id, data) {
        // 提取变体信息（如颜色）
        const variant = this.getVariantInfo(name, data);
        return `${name}:${variant}`;
    }

    // 获取变体信息
    getVariantInfo(name, data) {
        // 羊毛、混凝土、陶瓦等有色方块
        if (name.includes('wool') || name.includes('concrete') || 
            name.includes('terracotta') || name.includes('stained_glass') ||
            name.includes('carpet') || name.includes('banner') ||
            name.includes('bed') || name.includes('shulker_box')) {
            return this.getColorName(data);
        }
        
        // 木头类型
        if (name.includes('planks') || name.includes('log') || 
            name.includes('wood') || name.includes('leaves') ||
            name.includes('sapling') || name.includes('fence') ||
            name.includes('stairs') || name.includes('slab')) {
            return this.getWoodType(data);
        }
        
        return 'default';
    }

    // 获取颜色名称
    getColorName(data) {
        const colors = [
            '白色', '橙色', '品红色', '淡蓝色', '黄色', 
            '黄绿色', '粉红色', '灰色', '淡灰色', '青色',
            '紫色', '蓝色', '棕色', '绿色', '红色', '黑色'
        ];
        return colors[data] || '未知';
    }

    // 获取木头类型
    getWoodType(data) {
        const types = ['橡木', '云杉木', '白桦木', '丛林木', '金合欢木', '深色橡木'];
        return types[data] || '橡木';
    }

    // 生成Excel文件
    generateExcel(projection, player) {
        // 检查冷却时间
        const cooldown = this.checkCooldown(player);
        if (!cooldown.canUse) {
            player.tell(`§c请等待 ${cooldown.remainingSeconds} 秒后再次生成材料清单`);
            return null;
        }

        // 确保依赖已安装
        if (!this.ensureDependency('xlsx')) {
            player.tell('§c错误：无法安装Excel依赖，请检查网络连接');
            return null;
        }

        const XLSX = require('xlsx');
        
        // 统计材料
        const materials = this.countMaterials(projection);
        
        if (materials.size === 0) {
            player.tell('§c投影中没有方块数据');
            return null;
        }

        // 转换为数组并按数量排序（多的在前）
        const materialArray = Array.from(materials.values());
        materialArray.sort((a, b) => b.count - a.count);

        // 准备Excel数据
        const data = [];
        
        // 表头
        data.push(['方块名称', '方块ID', '数量']);
        
        // 数据行
        for (const item of materialArray) {
            data.push([
                item.chineseName,
                item.name,
                item.count
            ]);
        }

        // 创建worksheet
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        // 设置列宽
        ws['!cols'] = [
            { wch: 20 }, // 方块名称
            { wch: 35 }, // 方块ID
            { wch: 10 }  // 数量
        ];

        // 创建工作簿
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '材料清单');

        // 生成文件名（覆盖之前的）
        const safeName = projection.name.replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `材料清单_${safeName}.xlsx`;
        const filePath = path.join(this.exportsDir, fileName);

        // 如果文件已存在，删除旧文件
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                logger.warn(`[MaterialCounter] 删除旧文件失败: ${e.message}`);
            }
        }

        // 写入文件
        try {
            XLSX.writeFile(wb, filePath);
            
            // 更新冷却时间
            this.updateCooldown(player);
            
            // 获取相对路径用于显示
            const relativePath = filePath.replace(/^\.\//, '');
            
            player.tell(`§a材料清单已生成！`);
            player.tell(`§a共统计 ${materialArray.length} 种方块`);
            player.tell(`§7文件位置: ${relativePath}`);
            
            logger.info(`[MaterialCounter] 材料清单已生成: ${filePath}`);
            
            return filePath;
        } catch (e) {
            logger.error(`[MaterialCounter] 生成Excel失败: ${e.message}`);
            player.tell('§c生成材料清单失败，请查看控制台日志');
            return null;
        }
    }
}

module.exports = { MaterialCounter };
