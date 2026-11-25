/**
 * flatten_variants.js — P2.0b：把"变种仍靠数据值区分"的条目展开为 1.21 扁平化独立 ID
 *
 * 背景：P2.0（flatten_mapping.js）处理的是"容器 ID 带 <color>/<wood> 变体"的大类；
 * 本脚本处理剩下的"多对一"：Java 侧的变种被映射到同一个 BE 容器 ID + 变种状态，
 * 而基岩版在 1.21.10 / 1.21.20 / 1.21.30 已经把它们拆成独立 identifier。
 *
 * 症状（不修就会踩）：
 *   - 反向写世界时 minecraft:chiseled_sandstone 只会落下普通 sandstone（丢变种）；
 *   - BlockVerifier.typeMatch 拿世界返回的 chiseled_sandstone 去比对容器名 sandstone，必然不等；
 *   - easyplace 取物料时拿到的可能是普通砂岩。
 *
 * 逐条证据（identifier 见「基岩版」列 nameid / aliasid，拆分批次见「基岩版扁平化」总表）：
 *   1.21.20.21 砂岩      → 砂岩 / 雕纹砂岩 / 切制砂岩 / 平滑砂岩
 *                https://zh.minecraft.wiki/w/基岩版扁平化  +  https://minecraft.wiki/w/Chiseled_Sandstone（alias sandstone / 1）
 *                https://minecraft.wiki/w/Cut_Sandstone（alias sandstone / 2）  https://minecraft.wiki/w/Smooth_Sandstone（alias sandstone / 3）
 *   1.21.20.22 红砂岩    → 红砂岩 / 雕纹红砂岩 / 切制红砂岩 / 平滑红砂岩
 *                https://minecraft.wiki/w/Chiseled_Red_Sandstone（alias redsandstone / 1）
 *   1.21.20.22 石英块    → 石英块 / 雕纹石英块 / 石英柱 / 平滑石英块
 *                https://minecraft.wiki/w/Chiseled_Quartz_Block（alias quartzblock / 1）
 *                https://minecraft.wiki/w/Quartz_Pillar（alias quartzblock / 2）  https://minecraft.wiki/w/Smooth_Quartz_Block（alias quartzblock / 3）
 *   1.21.20.22 泥土      → 泥土 / 砂土
 *                https://minecraft.wiki/w/Coarse_Dirt（nameid=coarsedirt，alias dirt / 1，id=-962）
 *   1.21.20.22 沙子      → 沙子 / 红沙     https://zh.minecraft.wiki/w/红沙（BE nameid=redsand）
 *   1.21.20.22 铁砧      → 铁砧 / 开裂的铁砧 / 损坏的铁砧
 *                https://zh.minecraft.wiki/w/铁砧（BE nameid=chippedanvil / damagedanvil）
 *   1.21.10.22 海晶石    → 海晶石 / 暗海晶石 / 海晶石砖
 *                https://minecraft.wiki/w/Dark_Prismarine（alias prismarine / 1）  https://minecraft.wiki/w/Prismarine_Bricks（alias prismarine / 2）
 *   1.21.30.21 紫珀块    → 紫珀块 / 紫珀柱（雕纹、平滑紫珀为未使用 ID）
 *                https://minecraft.wiki/w/Purpur_Pillar（alias purpurblock / 2）
 *
 * 未改动（已核对，当前写法就是对的）：
 *   - minecraft:bricks → brick_block：BE 的正式 identifier 仍是 brick_block
 *     （https://minecraft.wiki/w/Bricks：JE nameid=bricks / BE nameid=brickblock，无 aliasid）
 *   - wooden_button / red_flower：BE 仍用数据值区分
 *
 * 用法：
 *   node work/flatten_variants.js           # dry-run：只出报告 + plan
 *   node work/flatten_variants.js --apply    # 写回 BlockMappingRegistry.js + legacyBedrockId 回退表
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'LitematicaBE-2.6.0', 'plugins', 'LitematicaBE', 'src', 'mappings', 'BlockMappingRegistry.js');
const OUT_MAP = path.join(ROOT, 'tools', 'variant_flattening_map.json');
const OUT_PLAN = path.join(ROOT, 'work', 'variant_flatten_plan.json');

/** 逐条展开表：java 名 -> { to, legacy, since, evidence } */
const VARIANTS = {
    // ==== 砂岩（1.21.20.21）====
    'minecraft:sandstone': { to: 'sandstone', legacy: null, since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:chiseled_sandstone': { to: 'chiseled_sandstone', legacy: 'sandstone', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Chiseled_Sandstone' },
    'minecraft:cut_sandstone': { to: 'cut_sandstone', legacy: 'sandstone', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Cut_Sandstone' },
    'minecraft:smooth_sandstone': { to: 'smooth_sandstone', legacy: 'sandstone', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Smooth_Sandstone' },

    // ==== 红砂岩（1.21.20.22）====
    'minecraft:red_sandstone': { to: 'red_sandstone', legacy: null, since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:chiseled_red_sandstone': { to: 'chiseled_red_sandstone', legacy: 'red_sandstone', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Chiseled_Red_Sandstone' },
    'minecraft:cut_red_sandstone': { to: 'cut_red_sandstone', legacy: 'red_sandstone', since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:smooth_red_sandstone': { to: 'smooth_red_sandstone', legacy: 'red_sandstone', since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },

    // ==== 石英（1.21.20.22）====
    'minecraft:quartz_block': { to: 'quartz_block', legacy: null, since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:chiseled_quartz_block': { to: 'chiseled_quartz_block', legacy: 'quartz_block', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Chiseled_Quartz_Block' },
    'minecraft:quartz_pillar': { to: 'quartz_pillar', legacy: 'quartz_block', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Quartz_Pillar' },
    'minecraft:smooth_quartz': { to: 'smooth_quartz', legacy: 'quartz_block', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Smooth_Quartz_Block' },

    // ==== 海晶石（1.21.10.22）====
    'minecraft:prismarine': { to: 'prismarine', legacy: null, since: '1.21.10', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:prismarine_bricks': { to: 'prismarine_bricks', legacy: 'prismarine', since: '1.21.10', evidence: 'https://minecraft.wiki/w/Prismarine_Bricks' },
    'minecraft:dark_prismarine': { to: 'dark_prismarine', legacy: 'prismarine', since: '1.21.10', evidence: 'https://minecraft.wiki/w/Dark_Prismarine' },

    // ==== 紫珀（1.21.30.21）====
    'minecraft:purpur_block': { to: 'purpur_block', legacy: null, since: '1.21.30', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:purpur_pillar': { to: 'purpur_pillar', legacy: 'purpur_block', since: '1.21.30', evidence: 'https://minecraft.wiki/w/Purpur_Pillar' },

    // ==== 泥土 / 沙子 / 海绵 / 铁砧（同类多对一，1.21.20–1.21.30）====
    'minecraft:dirt': { to: 'dirt', legacy: null, since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:coarse_dirt': { to: 'coarse_dirt', legacy: 'dirt', since: '1.21.20', evidence: 'https://minecraft.wiki/w/Coarse_Dirt' },
    'minecraft:sand': { to: 'sand', legacy: null, since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化' },
    'minecraft:red_sand': { to: 'red_sand', legacy: 'sand', since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/红沙' },
    'minecraft:sponge': { to: 'sponge', legacy: null, since: '1.21.30', evidence: 'https://zh.minecraft.wiki/w/海绵' },
    'minecraft:wet_sponge': { to: 'wet_sponge', legacy: 'sponge', since: '1.21.30', evidence: 'https://zh.minecraft.wiki/w/海绵' },
    'minecraft:anvil': { to: 'anvil', legacy: null, since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/铁砧' },
    'minecraft:chipped_anvil': { to: 'chipped_anvil', legacy: 'anvil', since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/铁砧' },
    'minecraft:damaged_anvil': { to: 'damaged_anvil', legacy: 'anvil', since: '1.21.20', evidence: 'https://zh.minecraft.wiki/w/铁砧' },

    // ==== 蘑菇柄（1.21.40「拆分与合并」：红蘑菇方块 / 蘑菇柄 / 棕色蘑菇块）====
    // 旧写法把它映射成 brown_mushroom_block（靠 huge_mushroom_bits 区分），世界返回的却是独立 ID
    'minecraft:mushroom_stem': { to: 'mushroom_stem', legacy: 'brown_mushroom_block', since: '1.21.40', evidence: 'https://zh.minecraft.wiki/w/蘑菇方块' },
};

/** 1.20.10 染色潜影盒拆分为 <color>_shulker_box（https://zh.minecraft.wiki/w/基岩版扁平化） */
for (const color of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) {
    VARIANTS[`minecraft:${color}_shulker_box`] = {
        to: `${color}_shulker_box`,
        legacy: 'shulker_box',
        since: '1.20.10',
        evidence: 'https://zh.minecraft.wiki/w/基岩版扁平化',
    };
}

/** 拆分后不再需要的"变种选择"状态（含本次新增的 6 个） */
const DROP_STATE_KEYS = new Set([
    'sand_stone_type', 'prismarine_block_type', 'chisel_type',
    'dirt_type', 'sand_type', 'sponge_type',
    'pillar_axis',   // quartz_block 拆分后，pillar_axis 只属于 quartz_pillar（同名映射无需 s）
    'stone_type', 'old_log_type', 'new_log_type', 'wood_type',
    'color', 'coral_color', 'coral_hang_type_bit', 'monster_egg_stone_type',
    'stone_brick_type', 'double_plant_type', 'tall_grass_type',
    'sapling_type', 'deprecated',
]);

// body 里可能含 s:{...}（内层还有一层 }），所以尾部用贪婪匹配到行末
const ENTRY_RE = /^(\s*)"(minecraft:[a-z0-9_]+)":\{b:"([a-z0-9_]+)"(.*)\}(,?)\s*$/;
const LEGACY_BLOCK_RE = /const legacyBedrockId = \{([\s\S]*?)\r?\n\};/;

/** s:{...} 是否只含"变种选择"键 → 是则可以整体删除 */
function stateIsVariantOnly(inner) {
    const parts = inner.split(',').map(s => s.split(':')).filter(p => p.length === 2);
    if (!parts.length) return false;
    return parts.every(([k, v]) => {
        const key = k.trim().replace(/"/g, '').trim();
        const val = v.trim().replace(/"/g, '').trim();
        return DROP_STATE_KEYS.has(key) || DROP_STATE_KEYS.has(val);
    });
}

function stripVariantState(body) {
    return body.replace(/,s:\{([^}]*)\}/, (match, inner) => (stateIsVariantOnly(inner) ? '' : match));
}

/** 拆成独立 ID 后，needsColor(8) / needsWoodType(16) 两个标志位失去意义 */
function stripVariantFlags(body) {
    return body.replace(/,f:(\d+)/, (match, n) => {
        const f = Number(n) & ~(8 | 16);
        return f ? `,f:${f}` : '';
    });
}

function main() {
    const apply = process.argv.includes('--apply');
    const text = fs.readFileSync(REGISTRY, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(eol);

    const plan = [];
    const legacyAdd = {};
    const touched = new Set();

    const outLines = lines.map(line => {
        const m = ENTRY_RE.exec(line);
        if (!m) return line;
        const [, indent, java, be, body, comma] = m;
        const rule = VARIANTS[java];
        if (!rule) return line;

        if (touched.has(java)) {
            console.warn(`[warn] ${java} 在 javaToBedrock 中出现多次，只改第一条`);
            return line;
        }
        touched.add(java);

        const newBody = stripVariantFlags(stripVariantState(body));
        const next = `${indent}"${java}":{b:"${rule.to}"${newBody}}${comma}`;
        const changed = be !== rule.to || newBody !== body;
        plan.push({ java, from: be, to: rule.to, legacy: rule.legacy, since: rule.since, evidence: rule.evidence, changed, stateDropped: newBody !== body });
        if (rule.legacy && java !== rule.legacy) legacyAdd[java] = rule.legacy;
        return changed ? next : line;
    });

    const missing = Object.keys(VARIANTS).filter(j => !touched.has(j));
    const changed = plan.filter(p => p.changed);

    console.log('=== P2.0b 变种多对一展开 ===');
    console.log(`目标条目: ${Object.keys(VARIANTS).length} / 命中: ${plan.length} / 需改写: ${changed.length}`);
    for (const p of plan) {
        const flag = p.changed ? (p.from !== p.to ? ` ${p.from} -> ${p.to}` : ' 仅清理变种状态') : ' 已符合（无需改写）';
        console.log(`  ${p.java.padEnd(38)}${flag}${p.stateDropped ? '  [s 已清理]' : ''}`);
    }
    if (missing.length) {
        console.log(`\n[warn] 未在映射表中找到: ${missing.join(', ')}`);
    }

    fs.writeFileSync(OUT_PLAN, JSON.stringify({ generatedAt: new Date().toISOString(), count: plan.length, changed: changed.length, entries: plan }, null, 2) + '\n', 'utf8');

    const mapOut = {
        $comment: 'P2.0b 产物：变种多对一 -> 扁平化独立 ID 的逐条规则与证据。由 work/flatten_variants.js 生成，勿手改。',
        targetVersion: 'bedrock-1.21.130',
        rule: '新 ID = Java 短名（扁平化后 BE 与 JE 同名）；legacy 字段写回 legacyBedrockId 供老版本 BDS 回退',
        dropStateKeys: [...DROP_STATE_KEYS],
        unchanged: {
            'minecraft:bricks': 'BE 正式 identifier 仍是 brick_block（nameid=brickblock，无 aliasid）',
            'minecraft:oak_button .. dark_oak_button': 'BE 仍用数据值区分木种',
            'minecraft:poppy .. lily_of_the_valley': 'BE 仍用 red_flower + 数据值',
        },
        entries: plan,
    };

    if (!apply) {
        console.log(`\n[dry-run] 报告写入 ${path.relative(ROOT, OUT_PLAN)}；加 --apply 才改源码`);
        return;
    }

    if (!changed.length && Object.keys(legacyAdd).length === 0) {
        console.log('\n源码已是扁平化状态，未写入');
        fs.writeFileSync(OUT_MAP, JSON.stringify(mapOut, null, 2) + '\n', 'utf8');
        return;
    }

    let nextText = outLines.join(eol);

    // 合并 legacy 回退表（新增条目按 java 名排序，保持整块整洁）
    const lb = LEGACY_BLOCK_RE.exec(nextText);
    if (!lb) {
        console.warn('[warn] 未找到 legacyBedrockId 块，legacy 回退未更新');
    } else {
        const existing = {};
        for (const line of lb[1].split(/\r?\n/)) {
            const mm = /^\s*"(minecraft:[a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)",?\s*$/.exec(line);
            if (mm) existing[mm[1]] = mm[2];
        }
        const merged = Object.assign({}, existing, legacyAdd);
        const keys = Object.keys(merged).sort();
        const blockBody = keys.map(k => `    "${k}":"${merged[k]}",`).join(eol);
        nextText = nextText.replace(LEGACY_BLOCK_RE, `const legacyBedrockId = {${eol}${blockBody}${eol}};`);
        console.log(`\nlegacy 回退表: ${Object.keys(existing).length} -> ${keys.length} 条（新增 ${keys.length - Object.keys(existing).length}）`);
    }

    fs.writeFileSync(REGISTRY, nextText, 'utf8');
    fs.writeFileSync(OUT_MAP, JSON.stringify(mapOut, null, 2) + '\n', 'utf8');
    console.log(`[apply] 已写入 ${path.relative(ROOT, REGISTRY)}（改写 ${changed.length} 条）`);
    console.log(`[apply] 已生成 ${path.relative(ROOT, OUT_MAP)}`);
}

main();
