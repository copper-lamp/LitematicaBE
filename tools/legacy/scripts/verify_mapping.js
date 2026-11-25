/**
 * verify_mapping.js — P2.0.3/P2.0.4 的验收脚本
 *
 * 校验项：
 *   1. tools/flattening_map.json 里每条 entries 的 to 与 BlockMappingRegistry 当前输出一致（防回退）
 *   2. legacy 回退表覆盖全部展开条目，且 legacy ID 与展开前的原值一致
 *   3. 全部 BE identifier 形如 ^[a-z0-9_]+$（不含空格、大写、冒号）
 *   4. 展开后仍然多对一的 BE 名（多个 Java 名共用一个 BE 名）单独列出 —— 扁平化完成的质量指标
 *   5. 抽样 20 条打印 java -> be，供人工与 wiki Identifier 列对照
 *
 * 用法：node work/verify_mapping.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { BlockMappingRegistry } = require(path.join(ROOT, 'LitematicaBE-2.6.0', 'plugins', 'LitematicaBE', 'src', 'mappings', 'BlockMappingRegistry'));

const mapPath = path.join(ROOT, 'tools', 'flattening_map.json');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const reg = new BlockMappingRegistry();

const problems = [];

// 1. 展开结果与源码一致
let mismatched = 0;
for (const e of map.entries) {
    const actual = reg.getBedrockName(e.java);
    if (actual !== e.to) {
        mismatched++;
        if (mismatched <= 10) problems.push(`${e.java}: 期望 ${e.to}，实际 ${actual}`);
    }
}

// 2. legacy 回退可用且等于展开前的值
let legacyBad = 0;
for (const e of map.entries) {
    const legacy = reg.getBedrockName(e.java, { legacy: true });
    if (legacy !== e.from) {
        legacyBad++;
        if (legacyBad <= 10) problems.push(`${e.java}: legacy 期望 ${e.from}，实际 ${legacy}`);
    }
}

// 3. identifier 格式
const ID_RE = /^[a-z0-9_]+$/;
for (const name of reg.getAllBedrockNames()) {
    if (!ID_RE.test(name)) problems.push(`BE 名格式非法: "${name}"`);
}

// 4. 多对一统计（扁平化完成后应当很有限）
const beToJava = new Map();
for (const j of reg.getAllJavaNames()) {
    const be = reg.getBedrockName(j);
    if (!be) continue;
    if (!beToJava.has(be)) beToJava.set(be, []);
    beToJava.get(be).push(j.replace('minecraft:', ''));
}
const manyToOne = [...beToJava.entries()].filter(([, list]) => list.length > 1);

console.log('=== P2.0 验收 ===');
console.log(`展开条目: ${map.entries.length} 条（源码不一致 ${mismatched} 条；legacy 回退异常 ${legacyBad} 条）`);
console.log(`BE 名总数: ${reg.getAllBedrockNames().length}，仍多对一的 BE 名: ${manyToOne.length} 个`);
if (manyToOne.length) {
    for (const [be, list] of manyToOne.slice(0, 12)) {
        console.log(`  ${be} <- ${list.join(', ')}${list.length > 6 ? ' …' : ''}`);
    }
}

const sample = ['minecraft:oak_planks', 'minecraft:white_wool', 'minecraft:light_blue_concrete',
    'minecraft:black_stained_glass', 'minecraft:cyan_stained_glass_pane', 'minecraft:lime_carpet',
    'minecraft:magenta_terracotta', 'minecraft:terracotta', 'minecraft:stone_bricks',
    'minecraft:chiseled_stone_bricks', 'minecraft:oak_log', 'minecraft:dark_oak_leaves',
    'minecraft:oak_slab', 'minecraft:birch_sapling', 'minecraft:granite', 'minecraft:polished_andesite',
    'minecraft:grass', 'minecraft:fern', 'minecraft:sunflower', 'minecraft:infested_stone'];

console.log('\n抽样 20 条（java -> bedrock，对照 wiki Identifier 列）:');
for (const j of sample) {
    const now = reg.getBedrockName(j);
    const before = reg.getBedrockName(j, { legacy: true });
    console.log(`  ${j.padEnd(38)} -> ${String(now).padEnd(26)} (扁平化前 ${before || '-'})`);
}

if (problems.length) {
    console.log(`\n结果: FAIL（${problems.length} 项）`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
} else {
    console.log('\n结果: PASS（展开结果稳定、legacy 回退可用、identifier 合法）');
}
