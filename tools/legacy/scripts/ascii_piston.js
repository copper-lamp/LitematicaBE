/** 用字符网格"看"贴图：颜色聚类后输出 16×16 / 分区字符图 */
const fs = require('fs');
const path = require('path');
const png = require(path.join(__dirname, '..', 'tools', 'lib', 'png.js'));

const sb = 'C:\\Users\\25491\\Desktop\\建模贴图\\resource\\bedrock-samples-v1.26.60.5-full\\resource_pack\\textures';
const SYM = '.#@%&*+=-~^:;<>abcde';

function grid(src, label, x0 = 0, y0 = 0, w = 16, h = 16) {
    const img = png.decode(fs.readFileSync(src));
    const colors = new Map();
    const rows = [];
    for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
            const i = ((y0 + y) * img.width + (x0 + x)) * 4;
            const a = img.data[i + 3];
            if (a === 0) { row += ' '; continue; }
            const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
            if (!colors.has(key)) colors.set(key, SYM[colors.size % SYM.length]);
            row += colors.get(key);
        }
        rows.push(row);
    }
    console.log(`\n=== ${label}  ${w}x${h} @ (${x0},${y0})  颜色数 ${colors.size} ===`);
    rows.forEach((r, i) => console.log(String(i).padStart(2, '0') + '|' + r + '|'));
    const list = [...colors.entries()].map(([k, s]) => `${s}=#${k.split(',').map((n) => (+n).toString(16).padStart(2, '0')).join('')}`);
    console.log(list.join('  '));
}

const B = (n) => path.join(sb, 'blocks', `${n}.png`);
const A = (n) => path.join(sb, 'entity', 'pistonarm', `${n}.png`);

grid(B('piston_side'), 'piston_side 方块侧壁');
grid(B('piston_bottom'), 'piston_bottom 方块底面');
grid(B('piston_inner'), 'piston_inner');
grid(B('piston_top_normal'), 'piston_top_normal');
grid(B('piston_top_sticky'), 'piston_top_sticky');

console.log('\n\n########## pistonArm 分区 ##########');
grid(A('pistonArm'), 'arm[0,0] 空白槽', 0, 0, 16, 16);
grid(A('pistonArm'), 'arm[16,0] 推面(木纹)', 16, 0, 16, 16);
grid(A('pistonArm'), 'arm[32,0] 内面', 32, 0, 16, 16);
grid(A('pistonArm'), 'arm[48,0] 空白槽', 48, 0, 16, 16);
grid(A('pistonArm'), 'arm[64,0..16] 臂', 64, 0, 16, 16);
grid(A('pistonArm'), 'arm[80,0] 空白槽', 80, 0, 16, 16);
grid(A('pistonArm'), 'arm[96,0] 空白槽', 96, 0, 16, 16);
grid(A('pistonArm'), 'arm[112,0] 空白槽', 112, 0, 16, 16);
grid(A('pistonArm'), 'arm[0,16] 板侧面+方块面', 0, 16, 16, 16);
grid(A('pistonArm'), 'arm[64,16]', 64, 16, 16, 16);
grid(A('pistonArmSticky'), 'armSticky[16,0] 黏性推面', 16, 0, 16, 16);
