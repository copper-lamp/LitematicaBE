/** 把活塞相关贴图放大 20× 导出，供肉眼核对（最近邻放大） */
const fs = require('fs');
const path = require('path');
const png = require(path.join(__dirname, '..', 'tools', 'lib', 'png.js'));

const S = 20;
const sb = 'C:\\Users\\25491\\Desktop\\建模贴图\\resource\\bedrock-samples-v1.26.60.5-full\\resource_pack\\textures';
const out = path.join(__dirname, 'piston_look');
fs.mkdirSync(out, { recursive: true });

function zoom(src, dst, s) {
    const img = png.decode(fs.readFileSync(src));
    const w = img.width * s, h = img.height * s;
    const d = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const si = (((y / s) | 0) * img.width + ((x / s) | 0)) * 4;
            const di = (y * w + x) * 4;
            d[di] = img.data[si]; d[di + 1] = img.data[si + 1];
            d[di + 2] = img.data[si + 2];
            d[di + 3] = img.data[si + 3] === 0 ? 0 : 255;
        }
    }
    fs.writeFileSync(dst, png.encode({ width: w, height: h, data: d }));
    console.log(`${path.basename(dst)}  ${img.width}x${img.height} -> ${w}x${h}`);
}

zoom(path.join(sb, 'blocks', 'piston_side.png'), path.join(out, 'side.png'), S);
zoom(path.join(sb, 'blocks', 'piston_bottom.png'), path.join(out, 'bottom.png'), S);
zoom(path.join(sb, 'blocks', 'piston_inner.png'), path.join(out, 'inner.png'), S);
zoom(path.join(sb, 'blocks', 'piston_top_normal.png'), path.join(out, 'top_normal.png'), S);
zoom(path.join(sb, 'blocks', 'piston_top_sticky.png'), path.join(out, 'top_sticky.png'), S);
zoom(path.join(sb, 'entity', 'pistonarm', 'pistonArm.png'), path.join(out, 'arm.png'), 10);
zoom(path.join(sb, 'entity', 'pistonarm', 'pistonArmSticky.png'), path.join(out, 'arm_sticky.png'), 10);
