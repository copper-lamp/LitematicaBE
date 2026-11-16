/**
 * test_fastplace_command.js — 带状态方块走 /setblock 命令
 *
 * 事故：墙火把被放成竖立火把（NBT 状态键在 1.21 带命名空间，无前缀键被 BDS 忽略），
 * 贴墙无支撑 → 立即破坏 → 打印机循环重放。
 *
 * 约定：blockStates 非空时，placeBlockAt / fastPlaceBlockAt 先走
 *   execute in <dim> run setblock <x> <y> <z> <name> ["key"="value",...]
 * 状态键去掉 `minecraft:` 前缀（与原版 /setblock 语法一致）；命令失败再回退旧 NBT 路径。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fastplace-cmd-')));

const { EasyPlaceManager } = require(path.join(PLUGIN, 'src', 'easyplace', 'EasyPlaceManager.js'));

let pass = 0;
let fail = 0;
function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`);
    }
}

const commands = [];
let setBlockCalls = 0;
let setBlockResult = true;

global.logger = { info() {}, warn() {}, error() {}, debug() {} };
global.mc = {
    runcmdEx(cmd) { commands.push(cmd); return { success: true }; },
    setBlock() { setBlockCalls++; return setBlockResult; },
    getBlock() { return null; },
    newItem(t, c) { return { type: t, count: c }; },
};

const mgr = new EasyPlaceManager({ getActiveProjectionByPlayer() { return null; } }, {}, null);

function reset() {
    commands.length = 0;
    setBlockCalls = 0;
    setBlockResult = true;
}

// ══════════════════════════════════════════════════════
console.log('\n=== 带状态放置走命令 ===');

check('1. 墙火把：命令带 torch_facing_direction，键不带命名空间', () => {
    reset();
    const ok = mgr.fastPlaceBlockAt(1, 64, 2, 0, 'torch', { torch_facing_direction: 'west' });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(commands, [
        'execute in overworld run setblock 1 64 2 torch ["torch_facing_direction"="west"]',
    ]);
    assert.strictEqual(setBlockCalls, 0, '命令成功时不应再走 setBlock');
});

check('2. 观察者：minecraft: 前缀键被去掉', () => {
    reset();
    mgr.fastPlaceBlockAt(1, 64, 2, 1, 'observer', { 'minecraft:facing_direction': 'west' });
    assert.deepStrictEqual(commands, [
        'execute in nether run setblock 1 64 2 observer ["facing_direction"="west"]',
    ]);
});

check('3. 布尔状态 → true/false；数字原样', () => {
    reset();
    mgr.fastPlaceBlockAt(1, 64, 2, 2, 'lever', { open_bit: true, redstone_signal: 3 });
    assert.deepStrictEqual(commands, [
        'execute in the_end run setblock 1 64 2 lever ["open_bit"="true","redstone_signal"="3"]',
    ]);
});

check('4. 无状态：不走命令，直接 setBlock', () => {
    reset();
    const ok = mgr.fastPlaceBlockAt(1, 64, 2, 0, 'stone', {});
    assert.strictEqual(ok, true);
    assert.strictEqual(commands.length, 0);
    assert.ok(setBlockCalls >= 1, '无状态应走 setBlock');
});

check('5. 命令失败：回退 setBlock（不丢方块）', () => {
    reset();
    global.mc.runcmdEx = (cmd) => { commands.push(cmd); return { success: false }; };
    try {
        const ok = mgr.fastPlaceBlockAt(1, 64, 2, 0, 'torch', { torch_facing_direction: 'west' });
        assert.strictEqual(ok, true);
        assert.strictEqual(commands.length, 1);
        assert.ok(setBlockCalls >= 1, '命令失败必须回退 setBlock');
    } finally {
        global.mc.runcmdEx = (cmd) => { commands.push(cmd); return { success: true }; };
    }
});

check('6. placeBlockAt（手动/纠错）同样走命令', () => {
    reset();
    mgr.placeBlockAt(3, 70, -2, 0, 'torch', { torch_facing_direction: 'south' });
    assert.deepStrictEqual(commands, [
        'execute in overworld run setblock 3 70 -2 torch ["torch_facing_direction"="south"]',
    ]);
});

check('7. runcmdEx 抛错：不崩，回退 setBlock', () => {
    reset();
    global.mc.runcmdEx = () => { throw new Error('boom'); };
    try {
        const ok = mgr.fastPlaceBlockAt(1, 64, 2, 0, 'torch', { torch_facing_direction: 'west' });
        assert.strictEqual(ok, true);
        assert.ok(setBlockCalls >= 1);
    } finally {
        global.mc.runcmdEx = (cmd) => { commands.push(cmd); return { success: true }; };
    }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
