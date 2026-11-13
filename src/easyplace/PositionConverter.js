/**
 * 世界坐标 ↔ 投影内相对坐标。
 *
 * **必须与 `GhostRenderer.transformPosition` 严格互逆**：
 *   正向 = origin + R(M(rel))
 *     M（镜像）用 `dims - 1 - v` 翻转，R（旋转）用 `dims.x / dims.z - 1` 平移。
 *
 */
const { transformPosition } = require('../ghost/GhostRenderer');

class PositionConverter {

    /**
     * 世界坐标 → 投影内相对坐标（旋转/镜像/原点全部反解）
     * @param {{x:number,y:number,z:number}} worldPos
     * @param {object} projection 需要 position / dimensions / rotation / mirrorX / mirrorZ
     * @returns {{x:number,y:number,z:number}} 投影内相对坐标（向下取整）
     */
    worldToProjection(worldPos, projection) {
        const proj = projection || {};
        const origin = proj.position || { x: 0, y: 0, z: 0 };
        const dims = proj.dimensions || { x: 0, y: 0, z: 0 };
        const p = worldPos || { x: 0, y: 0, z: 0 };

        // 相对原点（尚未反镜像/反旋转）
        const nx = Number(p.x) - origin.x;
        const ny = Number(p.y) - origin.y;
        const nz = Number(p.z) - origin.z;

        // 1) 反旋转：把 transformPosition 的 R 反解回去
        let x, z;
        switch (proj.rotation) {
            case 90:  // 正向 nx = z', nz = dims.x - 1 - x'
                x = (dims.x - 1) - nz;
                z = nx;
                break;
            case 180: // 正向 nx = dims.x - 1 - x', nz = dims.z - 1 - z'
                x = (dims.x - 1) - nx;
                z = (dims.z - 1) - nz;
                break;
            case 270: // 正向 nx = dims.z - 1 - z', nz = x'
                x = nz;
                z = (dims.z - 1) - nx;
                break;
            default:
                x = nx;
                z = nz;
                break;
        }

        // 2) 反镜像：正向前是"先镜像再旋转"，所以逆变换里镜像放在最后
        if (proj.mirrorX) x = (dims.x - 1) - x;
        if (proj.mirrorZ) z = (dims.z - 1) - z;

        return {
            x: Math.floor(x),
            y: Math.floor(ny),
            z: Math.floor(z),
        };
    }

    /**
     * 投影内相对坐标 → 世界坐标（唯一实现：GhostRenderer.transformPosition）
     * @param {{x:number,y:number,z:number}} projPos
     * @param {object} projection
     */
    projectionToWorld(projPos, projection) {
        const p = projPos || { x: 0, y: 0, z: 0 };
        return transformPosition([p.x, p.y, p.z], projection || {});
    }
}

module.exports = { PositionConverter };
