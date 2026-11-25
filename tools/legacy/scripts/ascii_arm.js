/** 对比：项目 RP 的 piston_top.png vs samples 的 piston_top_normal / piston_inner，并看 pistonArm 各分区 */
const fs = require('fs');
const path = require('path');
const png = require(path.join(__dirname, '..', 'tools', 'lib', 'png.js'));

const sb = 'C:\\Users\\25491\\Desktop\\建模贴图\\resource\\bedrock-samples-v1.26.60.5-full\\resource_pack\\textures';
const RP = path.join(__dirname, '..', 'resources', 'addon', 'LitematicaBE_RP', 'textures', 'blocks');
const SYM = '.#@%&*+=-~^:;<>abcde';

function gridImg(img, label, x0 = 0, y0 = 0, w = 16, h = 16) {
    const colors = new Map();
    const rows = [];
    for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
            const i = ((y0 + y) * img.width + (x0 + x)) * 4;
            if (img.data[i + 3] === 0) { row += ' '; continue; }
            const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
            if (!colors.has(key)) colors.set(key, SYM[colors.size % SYM.length]);
            row += colors.get(key);
        }
        rows.push(row);
    }
    console.log(`\n=== ${label}  颜色数 ${colors.size} ===`);
    rows.forEach((r, i) => console.log(String(i).padStart(2, '0') + '|' + r + '|'));
    console.log([...colors.entries()].map(([k, s]) => `${s}=#${k.split(',').map((n) => (+n).toString(16).padStart(2, '0')).join('')}`).join('  '));
}

const projTop = png.decode(fs.readFileSync(path.join(RP, 'piston_top.png')));
gridImg(projTop, '项目 RP piston_top.png');

const arm = png.decode(fs.readFileSync(path.join(sb, 'entity', 'pistonarm', 'pistonArm.png')));
gridImg(arm, 'arm (16,0) 推面', 16, 0);
gridImg(arm, 'arm (32,0) 内面', 32, 0);
gridImg(arm, 'arm (0,16) 板侧 16x4 只取前4行', 0, 16, 16, 4);
gridImg(arm, 'arm (64,24) 头块 6x8', 64, 24, 6, 8);
gridImg(arm, 'arm (70,18) 头块端面 6x6', 70, 18, 6, 6);
gridImg(arm, 'arm (64,4) 杆 4x8', 64, 4, 4, 8);
gridImg(arm, 'arm (64,16) 6x8 区', 64, 16, 6, 8);
