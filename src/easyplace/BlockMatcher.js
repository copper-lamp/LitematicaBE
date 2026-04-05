class BlockMatcher {
    constructor() {
        this.variantMap = this.buildVariantMap();
        this.stateProperties = {
            direction: ['facing', 'direction'],
            axis: ['axis'],
            half: ['half'],
            type: ['type'],
            shape: ['shape']
        };
    }

    buildVariantMap() {
        const map = new Map();
        map.set('minecraft:stone', ['minecraft:stone', 'minecraft:stonebrick']);
        map.set('minecraft:oak_planks', ['minecraft:oak_planks', 'minecraft:planks']);
        map.set('minecraft:spruce_planks', ['minecraft:spruce_planks']);
        map.set('minecraft:birch_planks', ['minecraft:birch_planks']);
        map.set('minecraft:jungle_planks', ['minecraft:jungle_planks']);
        map.set('minecraft:acacia_planks', ['minecraft:acacia_planks']);
        map.set('minecraft:dark_oak_planks', ['minecraft:dark_oak_planks']);
        map.set('minecraft:cobblestone', ['minecraft:cobblestone', 'minecraft:cobblestone_wall']);
        return map;
    }

    match(actual, expected, actualState = null, expectedState = null) {
        if (!actual || !expected) return false;

        const normActual = this.normalize(actual);
        const normExpected = this.normalize(expected);

        if (normActual !== normExpected) {
            const variants = this.variantMap.get(normExpected);
            if (!variants || !variants.includes(normActual)) {
                return false;
            }
        }

        if (!expectedState) return true;
        if (!actualState) return false;

        return this.matchState(actualState, expectedState);
    }

    matchState(actualState, expectedState) {
        if (!expectedState || Object.keys(expectedState).length === 0) return true;
        if (!actualState) return false;

        for (const [key, expectedValue] of Object.entries(expectedState)) {
            const actualValue = this.getStateValue(actualState, key);
            
            if (actualValue === undefined || actualValue === null) {
                continue;
            }

            if (actualValue !== expectedValue) {
                return false;
            }
        }

        return true;
    }

    getStateValue(state, propertyName) {
        if (!state) return undefined;

        if (state[propertyName] !== undefined) {
            return state[propertyName];
        }

        const aliases = this.stateProperties[propertyName] || [];
        for (const alias of aliases) {
            if (state[alias] !== undefined) {
                return state[alias];
            }
        }

        return undefined;
    }

    normalize(name) {
        if (!name) return '';
        let n = name.toLowerCase().trim();
        if (!n.includes(':')) n = `minecraft:${n}`;
        return n;
    }

    getBlockStateFromNbt(nbt) {
        if (!nbt) return null;

        try {
            const state = {};
            
            if (nbt.has && nbt.has('Name')) {
                state.name = nbt.get('Name');
            }

            if (nbt.has && nbt.has('Properties')) {
                const props = nbt.get('Properties');
                if (props) {
                    for (const key of Object.keys(props)) {
                        state[key] = props[key];
                    }
                }
            }

            return Object.keys(state).length > 0 ? state : null;
        } catch (e) {
            return null;
        }
    }

    compareFacing(actualFacing, expectedFacing, playerFacing) {
        if (!expectedFacing) return true;
        if (!actualFacing) return false;

        if (actualFacing === expectedFacing) return true;

        return false;
    }

    getFacingFromPlayer(player) {
        if (!player || !player.direction) return null;

        const yaw = player.direction.yaw;
        
        if (yaw >= -45 && yaw < 45) return 'south';
        if (yaw >= 45 && yaw < 135) return 'west';
        if (yaw >= 135 || yaw < -135) return 'north';
        if (yaw >= -135 && yaw < -45) return 'east';

        return 'south';
    }
}

module.exports = { BlockMatcher };
