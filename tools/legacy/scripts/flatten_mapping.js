/**
 * flatten_mapping.js — P2.0：把 javaToBedrock 里的 legacy 容器 ID 展开为 1.21 扁平化 ID
 *
 * 背景（E6）：映射表停留在基岩版扁平化之前，182 条（20.9%）输出 `wool` / `planks` /
 * `stonebrick` / `log` / `stained_hardened_clay` 这类容器 ID。基岩版自 1.16.100 起逐步拆分，
 * 1.19.70 羊毛、1.20.0 原木与地毯、1.20.10 混凝土、1.20.20/30 染色玻璃与陶瓦、
 * 1.20.50 木板与石头变种、1.20.70 树叶与木质台阶、1.20.80 树苗、1.21.0 草丛与大型花、
 * 珊瑚三兄弟，全部改成与 Java 同名的独立 identifier（`white_wool`、`oak_planks`、`tube_coral` …），
 * 旧 ID 仅以 `aliasid=<legacy> / <data>` 形式保留。
 *
 * 展开规则：新 ID = Java 短名。唯一特例是 `minecraft:grass`（Java 1.20.3 才改名），
 * 基岩版 1.21.0 拆分后叫 `short_grass`，不是 `grass`。
 *
 * 依据（wiki 的 Bedrock Edition Identifier 列，含 aliasid 佐证）：
 *   - 木板: https://minecraft.wiki/w/Planks        （`oak_planks` / alias `planks / 0`）
 *   - 羊毛: https://minecraft.wiki/w/Wool          （`white_wool` / alias `wool / 0`）
 *   - 石砖: https://minecraft.wiki/w/Stone_Bricks  （`stone_bricks` / alias `stonebrick / 0`）
 *   - 珊瑚: https://minecraft.wiki/w/Coral         （`tube_coral` / alias `coral / 0`）
 *   - 珊瑚块: https://minecraft.wiki/w/Coral_Block （`tube_coral_block` / alias `coral_block / 0`）
 *   - 树苗: https://minecraft.wiki/w/Sapling       （`oak_sapling` / alias `sapling / 0`）
 *   - 大型花: https://minecraft.wiki/w/Sunflower   （`sunflower` / alias `double_plant / 0`）
 *   - 矮草丛: https://minecraft.wiki/w/Short_Grass （`short_grass` / alias `tallgrass / 0`）
 *   - 蕨: https://minecraft.wiki/w/Fern            （`fern` / alias `tallgrass / 1`）
 *   - 扁平化总表: https://zh.minecraft.wiki/w/基岩版扁平化
 *
 * 用法：
 *   node work/flatten_mapping.js           # 只出报告与 plan，不改源码
 *   node work/flatten_mapping.js --apply   # 写回 BlockMappingRegistry.js 并生成 flattening_map.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'LitematicaBE-2.6.0', 'plugins', 'LitematicaBE', 'src', 'mappings', 'BlockMappingRegistry.js');
const OUT_MAP = path.join(ROOT, 'tools', 'flattening_map.json');
const OUT_PLAN = path.join(ROOT, 'work', 'flatten_plan.json');

/** 需要展开的 legacy 容器 ID（与 probe_legacy_ids.js 的判据一致） */
const LEGACY_CONTAINERS = new Set([
    'wool', 'concrete', 'stained_glass', 'stained_glass_pane', 'stained_hardened_clay',
    'carpet', 'planks', 'wooden_slab', 'sapling', 'log', 'log2', 'leaves', 'leaves2',
    'stonebrick', 'stone', 'tallgrass', 'double_plant', 'monster_egg',
    'coral_block', 'coral', 'coral_fan', 'hardened_clay',
    // 第二批：映射表里用无下划线写法，probe 的旧判据漏掉了它们
    'concretepowder', 'fence', 'wood',
]);

/** Java 名与 BE 扁平化名不一致的特例 */
const SPECIAL = {
    'minecraft:grass': 'short_grass',   // Java 1.20.3 之前叫 grass，基岩版拆分为 short_grass
};

/** 拆分后不再需要的"变种选择"状态（它们已经变成独立 ID） */
const DROP_STATE_KEYS = new Set([
    'stone_type', 'sand_type', 'dirt_type', 'old_log_type', 'new_log_type', 'wood_type',
    'color', 'coral_color', 'coral_hang_type_bit', 'monster_egg_stone_type',
    'stone_brick_type', 'chisel_type', 'double_plant_type', 'tall_grass_type',
    'sapling_type', 'deprecated',
]);

/** 位掩码 8=needsColor / 16=needsWoodType：拆成独立 ID 后这两个标志失去意义 */
const DROP_FLAG_BITS = 8 | 16;

/** 按 legacy 容器归类的证据表（写进 flattening_map.json） */
const RULES = {
    wool: { expand: '<color>_wool', since: '1.19.70', evidence: 'https://minecraft.wiki/w/Wool' },
    concrete: { expand: '<color>_concrete', since: '1.20.10', evidence: 'https://minecraft.wiki/w/Concrete' },
    stained_glass: { expand: '<color>_stained_glass', since: '1.20.20', evidence: 'https://minecraft.wiki/w/Stained_Glass' },
    stained_glass_pane: { expand: '<color>_stained_glass_pane', since: '1.20.20', evidence: 'https://minecraft.wiki/w/Stained_Glass_Pane' },
    stained_hardened_clay: { expand: '<color>_terracotta', since: '1.20.30', evidence: 'https://minecraft.wiki/w/Terracotta' },
    hardened_clay: { expand: 'terracotta', since: '1.20.30', evidence: 'https://minecraft.wiki/w/Terracotta' },
    carpet: { expand: '<color>_carpet', since: '1.20.0', evidence: 'https://minecraft.wiki/w/Carpet' },
    planks: { expand: '<wood>_planks', since: '1.20.50', evidence: 'https://minecraft.wiki/w/Planks' },
    wooden_slab: { expand: '<wood>_slab', since: '1.20.70', evidence: 'https://minecraft.wiki/w/Slab' },
    sapling: { expand: '<wood>_sapling', since: '1.20.80', evidence: 'https://minecraft.wiki/w/Sapling' },
    log: { expand: '<wood>_log', since: '1.20.0', evidence: 'https://minecraft.wiki/w/Log' },
    log2: { expand: '<wood>_log', since: '1.20.0', evidence: 'https://minecraft.wiki/w/Log' },
    leaves: { expand: '<wood>_leaves', since: '1.20.70', evidence: 'https://minecraft.wiki/w/Leaves' },
    leaves2: { expand: '<wood>_leaves', since: '1.20.70', evidence: 'https://minecraft.wiki/w/Leaves' },
    stonebrick: { expand: 'stone_bricks / mossy_* / cracked_* / chiseled_*', since: '已拆分', evidence: 'https://minecraft.wiki/w/Stone_Bricks' },
    stone: { expand: 'stone / granite / diorite / andesite / polished_*', since: '1.20.50', evidence: 'https://minecraft.wiki/w/Stone' },
    tallgrass: { expand: 'short_grass / fern', since: '1.21.0', evidence: 'https://minecraft.wiki/w/Short_Grass' },
    double_plant: { expand: 'sunflower / lilac / rose_bush / peony / tall_grass / large_fern', since: '1.21.0', evidence: 'https://minecraft.wiki/w/Sunflower' },
    monster_egg: { expand: 'infested_*', since: '1.21.0', evidence: 'https://minecraft.wiki/w/Infested_Block' },
    coral_block: { expand: '<type>_coral_block', since: '1.20.0', evidence: 'https://minecraft.wiki/w/Coral_Block' },
    coral: { expand: '<type>_coral', since: '1.20.0', evidence: 'https://minecraft.wiki/w/Coral' },
    coral_fan: { expand: '<type>_coral_fan', since: '1.20.80', evidence: 'https://minecraft.wiki/w/Coral_Fan' },
    concretepowder: { expand: '<color>_concrete_powder', since: '1.20.30', evidence: 'https://minecraft.wiki/w/Concrete_Powder' },
    fence: { expand: '<wood>_fence', since: '1.19.80', evidence: 'https://minecraft.wiki/w/Wooden_Fence' },
    wood: { expand: '<wood>_wood / stripped_<wood>_wood', since: '1.20.70', evidence: 'https://minecraft.wiki/w/Wood' },
};

const LINE_RE = /^(\s*)"(minecraft:[a-z0-9_]+)":\{b:"([a-z0-9_]+)"(.*)\}(,?)\s*$/;

/** body 里的 s:{...} 是否只含"变种选择"键（Java 状态名与 BE 状态名两侧都认） */
function stateIsVariantOnly(inner) {
    const parts = inner.split(',').map(s => s.split(':')).filter(p => p.length === 2);
    if (!parts.length) return false;
    return parts.every(([k, v]) => {
        const key = k.trim().replace(/"/g, '');
        const val = v.trim().replace(/"/g, '');
        return DROP_STATE_KEYS.has(key) || DROP_STATE_KEYS.has(val);
    });
}

function rewriteBody(body) {
    let out = body;
    out = out.replace(/,s:\{([^}]*)\}/, (match, inner) => (stateIsVariantOnly(inner) ? '' : match));
    out = out.replace(/,f:(\d+)/, (match, n) => {
        let f = Number(n);
        if (f & DROP_FLAG_BITS) f &= ~DROP_FLAG_BITS;
        return f ? `,f:${f}` : '';
    });
    return out;
}

function main() {
    const apply = process.argv.includes('--apply');
    const text = fs.readFileSync(REGISTRY, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(eol);

    const plan = [];
    const legacyTable = {};
    const outLines = lines.map(line => {
        const m = LINE_RE.exec(line);
        if (!m) return line;
        const [, indent, java, be, body, comma] = m;
        if (!LEGACY_CONTAINERS.has(be)) return line;

        const newBe = SPECIAL[java] || (java.split(':')[1] || be);
        const newBody = rewriteBody(body);

        plan.push({ java, from: be, to: newBe, bodyBefore: body, bodyAfter: newBody });
        legacyTable[java] = be;

        return `${indent}"${java}":{b:"${newBe}"${newBody}}${comma}`;
    });

    const byContainer = {};
    for (const p of plan) {
        byContainer[p.from] = (byContainer[p.from] || 0) + 1;
    }

    console.log(`=== P2.0 映射表扁平化 ===`);
    console.log(`待展开条目: ${plan.length}`);
    for (const [from, n] of Object.entries(byContainer).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${from.padEnd(22)} ${String(n).padStart(3)} 条`);
    }

    const changedExample = plan.filter(p => p.from !== p.to).slice(0, 8);
    console.log('\n抽样:');
    for (const p of changedExample) {
        console.log(`  ${p.java}  ${p.from} -> ${p.to}${p.bodyBefore !== p.bodyAfter ? '（并清理变种状态/标志）' : ''}`);
    }

    fs.writeFileSync(OUT_PLAN, JSON.stringify({ generatedAt: new Date().toISOString(), count: plan.length, byContainer, entries: plan }, null, 2) + '\n', 'utf8');

    const flatteningMap = {
        $comment: 'P2.0 产物：legacy 容器 ID -> 1.21 扁平化 ID 的展开规则与逐条结果。由 work/flatten_mapping.js 生成，勿手改。',
        targetVersion: 'bedrock-1.21.130',
        rule: '新 ID = Java 短名；特例见 special',
        special: SPECIAL,
        rules: RULES,
        legacyAlias: legacyTable,
        entries: plan.map(p => ({ java: p.java, from: p.from, to: p.to })),
    };

    if (!apply) {
        console.log(`\n[dry-run] 报告已写入 ${path.relative(ROOT, OUT_PLAN)}；加 --apply 才会改源码`);
        return;
    }

    const nextText = outLines.join(eol);
    if (nextText === text) {
        console.log('\n源码已是扁平化状态，未写入');
        return;
    }

    // 追加 legacy 回退表与 legacy 选项（P2.0.4）
    let finalText = nextText;
    if (!finalText.includes('const legacyBedrockId')) {
        const legacyLines = Object.keys(legacyTable).sort().map(j => `    "${j}":"${legacyTable[j]}",`).join(eol);
        const block = `// P2.0.4 legacy 回退表：扁平化之前的容器 ID（老版本 BDS 用 getBedrockName(name, {legacy:true})）${eol}const legacyBedrockId = {${eol}${legacyLines}${eol}};${eol}${eol}`;
        finalText = finalText.replace('const javaToBedrock = {', block + 'const javaToBedrock = {');
    }
    if (!finalText.includes('legacyBedrockId[javaName]')) {
        const oldFn = [
            '    /** Lookup BE name for a Java block */',
            '    getBedrockName(javaName) {',
            '        const m = javaToBedrock[javaName];',
            '        return m ? m.b : null;',
            '    }',
        ].join(eol);
        const newFn = [
            '    /**',
            '     * Lookup BE name for a Java block',
            '     * @param {string} javaName',
            '     * @param {{legacy?: boolean}} [opts] legacy=true 返回扁平化之前的容器 ID（仅老版本 BDS 需要）',
            '     */',
            '    getBedrockName(javaName, opts) {',
            '        const m = javaToBedrock[javaName];',
            '        if (!m) return null;',
            '        if (opts && opts.legacy) return legacyBedrockId[javaName] || m.b;',
            '        return m.b;',
            '    }',
        ].join(eol);
        if (!finalText.includes(oldFn)) {
            console.warn('[warn] 未找到 getBedrockName 原实现，legacy 选项未挂载');
        }
        finalText = finalText.replace(oldFn, newFn);
    }

    fs.writeFileSync(REGISTRY, finalText, 'utf8');
    fs.writeFileSync(OUT_MAP, JSON.stringify(flatteningMap, null, 2) + '\n', 'utf8');
    console.log(`\n[apply] 已写入 ${path.relative(ROOT, REGISTRY)}（${plan.length} 条）`);
    console.log(`[apply] 已生成 ${path.relative(ROOT, OUT_MAP)}`);
}

main();
