class PositionConverter {
    
    worldToProjection(worldPos, projection) {
        const projPos = projection.position;
        const rotation = projection.rotation || 0;
        const mirrorX = projection.mirrorX || false;
        const mirrorZ = projection.mirrorZ || false;

        let x = worldPos.x - projPos.x;
        let y = worldPos.y - projPos.y;
        let z = worldPos.z - projPos.z;

        if (mirrorX) x = -x;
        if (mirrorZ) z = -z;

        switch (rotation) {
            case 90:
                [x, z] = [z, -x];
                break;
            case 180:
                [x, z] = [-x, -z];
                break;
            case 270:
                [x, z] = [-z, x];
                break;
        }

        return {
            x: Math.floor(x),
            y: Math.floor(y),
            z: Math.floor(z)
        };
    }

    projectionToWorld(projPos, projection) {
        const worldPos = projection.position;
        const rotation = projection.rotation || 0;
        const mirrorX = projection.mirrorX || false;
        const mirrorZ = projection.mirrorZ || false;

        let x = projPos.x;
        let z = projPos.z;

        switch (rotation) {
            case 90:
                [x, z] = [-z, x];
                break;
            case 180:
                [x, z] = [-x, -z];
                break;
            case 270:
                [x, z] = [z, -x];
                break;
        }

        if (mirrorX) x = -x;
        if (mirrorZ) z = -z;

        return {
            x: Math.floor(x + worldPos.x),
            y: Math.floor(projPos.y + worldPos.y),
            z: Math.floor(z + worldPos.z)
        };
    }
}

module.exports = { PositionConverter };
