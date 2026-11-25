/**
 * ghost_map_report.js — 生成 ghost 贴图映射的「诊断报告 + 手填表」
 *
 * 输出：
 *   tools/ghost_map_manual.csv   供人工补全的映射表（UTF-8 BOM，Excel 直接打开）
 *   work/ghost_map_report.json   机器可读的诊断明细
 *
 * 每一行 = 一个 Java 方块名（BlockMappingRegistry.getAllJavaNames()）：
 *   java         Java 方块名（minecraft: 前缀已去掉）
 *   be           当前映射到的 BE 方块名
 *   status       ok     已生效（不需要动）
 *                fill   贴图能自动解析出来，只是 ghost 清单没收录 → 采纳即可
 *                manual 解析不出贴图 → 需要人工指定 texture
 *                skip   空气/纯技术方块，本就不该出 ghost（保持 generic 即可）
 *   texture      最终要用的贴图名（fill 行已预填；manual 行留空待填）
 *   geometry     full_block / stairs / slab（当前构建一律打包成 full_block，形状延后）
 *   suggest      manual 行的建议贴图（规则推导后命中贴图集才填）
 *   note         说明
 *
 * 用法：node work/ghost_map_report.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const resolver = require(path.join(ROOT, 'tools', 'ghost_texture_resolver.js'));
const { BlockMappingRegistry } = require(path.join(ROOT, 'LitematicaBE-2.6.0', 'plugins', 'LitematicaBE', 'src', 'mappings', 'BlockMappingRegistry'));

const reg = new BlockMappingRegistry();
const { set: texSet, entries } = resolver.loadTextureSet(path.join(ROOT, 'work', 'texture_inventory.json'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'ghost_manifest.json'), 'utf8'));
const byTex = new Map(manifest.blocks.map(b => [b.texture, b.id]));

/** 不该出 ghost 的名字（SurfaceExtractor / GhostGuard 已按空气处理） */
const SKIP = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'light']);

/** 规则建议：给解析不出来的方块猜一个贴图（只在贴图集里真有时才写进 suggest） */
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];

/** 彩色布类（banner/bed）在贴图集里没有独立贴图，用同色羊毛近似 */
function colorOf(short) {
    for (const c of COLORS) {
        if (short.startsWith(c + '_')) return c;
    }
    return null;
}
function woodOf(short) {
    for (const w of WOODS) {
        if (short.startsWith(w + '_')) return w;
    }
    return null;
}
/** 木种 -> 木板贴图（sign / shelf / chest 之类只能按材质近似） */
function planksOf(short) {
    const w = woodOf(short);
    if (!w) return [];
    return [`${w}_planks`, 'oak_planks'];
}

const RULES = [
    [/^waxed_(.+)$/, n => [n.replace(/^waxed_/, '')]],
    [/_wall_hanging_sign$/, n => planksOf(n)],
    [/_hanging_sign$/, n => planksOf(n)],
    [/_wall_sign$/, n => planksOf(n)],
    [/_sign$/, n => planksOf(n)],
    [/_wall_banner$/, n => [colorOf(n) ? `${colorOf(n)}_wool` : 'white_wool']],
    [/_banner$/, n => [colorOf(n) ? `${colorOf(n)}_wool` : 'white_wool']],
    [/_bed$/, n => [colorOf(n) ? `${colorOf(n)}_wool` : 'red_wool']],
    [/_carpet$/, n => [colorOf(n) ? `${colorOf(n)}_wool` : 'white_wool']],
    [/_wool$/, n => [n]],
    [/_shelf$/, n => [n]],
    [/_wood$/, n => [n.replace(/_wood$/, '_log'), n.replace(/_wood$/, '_log_top')]],
    [/_hyphae$/, n => [n.replace(/_hyphae$/, '_stem'), n.replace(/_hyphae$/, '_stem_top')]],
    [/^stripped_(.+)_wood$/, n => [n.replace(/_wood$/, '_log')]],
    [/^infested_(.+)$/, n => [n.replace(/^infested_/, '')]],
    [/^suspicious_gravel$/, () => ['suspicious_gravel_0']],
    [/^suspicious_sand$/, () => ['suspicious_sand_0']],
    [/^smooth_quartz_(stairs|slab)$/, () => ['quartz_block_bottom']],
    [/^quartz_(stairs|slab)$/, () => ['quartz_block_side']],
    [/^brick_block$/, () => ['bricks']],
    [/^tnt$/, () => ['tnt_side']],
    [/^chest$|^trapped_chest$/, () => ['oak_planks', 'spruce_planks']],
    [/^ender_chest$/, () => ['obsidian', 'end_stone']],
    [/^cactus$/, () => ['cactus_side']],
    [/^pumpkin$/, () => ['pumpkin_side']],
    [/^melon$/, () => ['melon_side']],
    [/^bamboo$|^bamboo_sapling$/, () => ['bamboo_stalk', 'bamboo_singleleaf']],
    [/^hay_block$/, () => ['hay_block_side']],
    [/^bone_block$/, () => ['bone_block_side']],
    [/^dried_kelp_block$/, () => ['dried_kelp_side']],
    [/^decorated_pot$/, () => ['terracotta', 'bricks']],
    [/^chain$/, () => ['iron_chain', 'iron_block']],
    [/^cake$|^candle_cake$/, () => ['cake_side']],
    [/^frosted_ice$/, () => ['frosted_ice_0']],
    [/^pointed_dripstone$/, () => ['pointed_dripstone_up_tip', 'pointed_dripstone_up_frozen']],
    [/^small_dripleaf$/, () => ['small_dripleaf_top', 'small_dripleaf_stem']],
    [/^tall_grass$/, () => ['tall_grass_top', 'tall_grass_bottom']],
    [/^large_fern$/, () => ['large_fern_top', 'large_fern_bottom']],
    [/^sunflower$|^lilac$|^rose_bush$|^peony$/, n => [n + '_top', n + '_front']],
    [/^pitcher_plant$/, () => ['pitcher_crop_top', 'pitcher_crop_side']],
    [/^wheat$/, () => ['wheat_stage7']],
    [/^carrots$/, () => ['carrots_stage3']],
    [/^potatoes$/, () => ['potatoes_stage3']],
    [/^beetroots$/, () => ['beetroots_stage3']],
    [/^nether_wart$/, () => ['nether_wart_stage2']],
    [/^torchflower_crop$/, () => ['torchflower_crop_stage1']],
    [/^sweet_berry_bush$/, () => ['sweet_berry_bush_stage3']],
    [/^fire$/, () => ['fire_0']],
    [/^water$/, () => ['water_still']],
    [/^lava$/, () => ['lava_still']],
    [/^(command_block|chain_command_block|repeating_command_block)$/, n => [n + '_front', n]],
    [/^reinforced_deepslate$/, () => ['reinforced_deepslate_side', 'reinforced_deepslate_top']],
    [/^light_weighted_pressure_plate$/, () => ['gold_block']],
    [/^heavy_weighted_pressure_plate$/, () => ['iron_block']],
    [/^piston$|^sticky_piston$/, () => ['piston_side', 'piston_top']],
    [/^redstone_wire$/, () => ['redstone_dust_dot']],
    [/^end_portal$|^end_gateway$/, () => ['end_portal_frame_top', 'obsidian']],
    [/^water_cauldron$|^lava_cauldron$|^powder_snow_cauldron$/, () => ['cauldron_top']],
    [/^sniffer_egg$/, () => ['sniffer_egg_not_cracked_top', 'sniffer_egg_not_cracked_side']],
    [/^bubble_column$/, () => ['water_still']],
];

function suggest(short) {
    for (const [re, fn] of RULES) {
        if (!re.test(short)) continue;
        for (const cand of fn(short)) {
            if (cand && texSet.has(cand)) return cand;
        }
    }
    return '';
}

const rows = [];
const stat = { ok: 0, pending: 0, skip: 0 };
const srcCount = { auto: 0, manual: 0 };
const pendingNames = [];

// 增量：CSV 已存在时保留人工已填的 texture / status，重跑不清空劳动成果
const CSV_PATH = path.join(ROOT, 'tools', 'ghost_map_manual.csv');
const prev = new Map();
if (fs.existsSync(CSV_PATH)) {
    const text = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\ufeff/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const head = lines.shift().split(',').map(s => s.trim());
    const iJ = head.indexOf('java'), iT = head.indexOf('texture'),
        iS = head.indexOf('status'), iSrc = head.indexOf('source');
    for (const line of lines) {
        // 只在没有逗号/引号的简单行上做保留（texture 列本身不含逗号）
        const cells = line.split(',');
        const java = (cells[iJ] || '').trim();
        if (!java) continue;
        prev.set(java, {
            texture: (cells[iT] || '').trim(),
            status: (cells[iS] || '').trim().toLowerCase(),
            source: iSrc >= 0 ? (cells[iSrc] || '').trim().toLowerCase() : '',
        });
    }
}

for (const javaFull of reg.getAllJavaNames()) {
    const short = resolver.stripNamespace(javaFull);
    const be = reg.getBedrockName(javaFull) || '';
    const r = resolver.resolveTexture(javaFull, { has: n => texSet.has(n), getBedrockName: j => reg.getBedrockName(j) });
    const geometry = r.geometry;
    const old = prev.get(short);

    let status = 'pending';
    let texture = '';
    let source = '';
    let sug = suggest(short);
    let note = '';

    if (old && old.status === 'skip') {
        status = 'skip';
        note = '人工标记为不生成 ghost';
    } else if (SKIP.has(short) || short.endsWith('_air')) {
        status = 'skip';
        note = '空气/技术方块，渲染前已被过滤';
    } else if (old && old.texture) {
        // 人工填过 / 自动预填过，原样保留
        texture = old.texture;
        status = 'ok';
        source = old.source || 'manual';
        note = source === 'auto' ? `自动解析（via ${r.via}）` : '人工指定';
    } else if (r.texture && texSet.has(r.texture)) {
        texture = r.texture;
        status = 'ok';
        source = 'auto';
        note = `自动解析（via ${r.via}）`;
    } else {
        note = sug
            ? `建议 ${sug}：命中贴图集但未自动采用，确认后填进 texture`
            : '贴图集里没有直接对应，需人工决定（留空 = 灰色通用块）';
        pendingNames.push(short);
    }

    if (status === 'ok' && source) srcCount[source]++;
    stat[status]++;
    rows.push({ java: short, be, status, texture, geometry, suggest: sug, source, note });
}

// ---- CSV（UTF-8 BOM，Excel 直接双击可读） ----
// 待补全的排在最前：打开表先看到要填的，往下才是已完成的
const ORDER = { pending: 0, ok: 1, skip: 2 };
rows.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || a.java.localeCompare(b.java));
const head = ['java', 'be', 'status', 'texture', 'geometry', 'suggest', 'source', 'note'];
const esc = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = [head.join(',')];
for (const r of rows) lines.push(head.map(h => esc(r[h])).join(','));
fs.writeFileSync(CSV_PATH, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');

// ---- JSON 报告 ----
const detail = {
    generatedAt: new Date().toISOString(),
    registry: {
        javaNames: rows.length,
        addonVersion: manifest.addonVersion,
        manifestBlocks: manifest.blocks.length,
        manifestTextures: new Set(manifest.blocks.map(b => b.texture)).size,
    },
    counts: stat,
    sources: srcCount,
    coverage: {
        effectiveNow: stat.ok,
        effectiveRateNow: +(stat.ok / rows.length * 100).toFixed(1),
    },
    pending: rows.filter(r => r.status === 'pending').map(r => ({ java: r.java, be: r.be, suggest: r.suggest })),
    pendingWithSuggestion: rows.filter(r => r.status === 'pending' && r.suggest).length,
};
fs.writeFileSync(path.join(ROOT, 'work', 'ghost_map_report.json'), JSON.stringify(detail, null, 2), 'utf8');

const withTex = stat.ok;
console.log('=== ghost 映射诊断 ===');
console.log(`Java 方块名总数: ${rows.length}`);
console.log(`  ok      已指定贴图      ${withTex}（自动 ${srcCount.auto} / 人工 ${srcCount.manual}）`);
console.log(`  pending 待人工补全      ${stat.pending}（其中 ${detail.pendingWithSuggestion} 条已有建议值）`);
console.log(`  skip    空气/技术方块   ${stat.skip}`);
console.log(`当前覆盖率 ${detail.coverage.effectiveRateNow}%（未覆盖的 ${stat.pending} 条显示为灰块）`);
console.log(`\n已写入 tools/ghost_map_manual.csv（${rows.length} 行）与 work/ghost_map_report.json`);
