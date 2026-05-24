/**
 * BidirectionalBlockConverter.js
 * Main bidirectional conversion engine combining registry + state converters
 * Supports Java -> BE and BE -> Java with validation
 */
const { BlockMappingRegistry } = require('./BlockMappingRegistry');
const { BlockStateConverters } = require('./BlockStateConverters');

class BidirectionalBlockConverter {
    constructor() {
        this.registry = new BlockMappingRegistry();
        this.states = new BlockStateConverters();
        this.logger = null; // injectable logger
        this.stats = {
            javaToBe: { total: 0, success: 0, fallback: 0 },
            beToJava: { total: 0, success: 0, fallback: 0 }
        };
    }

    setLogger(logger) {
        this.logger = logger;
    }

    _warn(msg) {
        if (this.logger) this.logger.warn(msg);
    }

    /**
     * Java Edition block -> Bedrock Edition block
     * @param {{name: string, states: object, nbt: object}} javaBlock
     * @returns {{name: string, states: object}} bedrock block
     */
    javaToBedrock(javaBlock) {
        this.stats.javaToBe.total++;
        const javaName = javaBlock.name || '';
        const javaStates = javaBlock.states || {};

        if (!javaName || !this.registry.hasJava(javaName)) {
            this.stats.javaToBe.fallback++;
            this._warn(`[Converter] Unknown Java block: ${javaName}, passing through`);
            return { name: javaName, states: { ...javaStates } };
        }

        const bedrockName = this.registry.getBedrockName(javaName);
        const bedrockStates = this.states.convertJavaToBedrock(javaName, javaStates);

        this.stats.javaToBe.success++;
        return {
            name: bedrockName,
            states: bedrockStates,
            _originalJava: javaName,
            _nbt: javaBlock.nbt || null
        };
    }

    /**
     * Bedrock Edition block -> Java Edition block
     * @param {{name: string, states: object}} beBlock
     * @returns {{name: string, states: object}} java block
     */
    bedrockToJava(beBlock) {
        this.stats.beToJava.total++;
        const beName = beBlock.name || '';
        const beStates = beBlock.states || {};

        if (!beName) {
            this.stats.beToJava.fallback++;
            this._warn(`[Converter] Empty BE block name`);
            return { name: 'minecraft:stone', states: {} };
        }

        // Use _originalJava hint for many-to-one reverse fidelity
        const hintJava = beBlock._originalJava || null;
        const javaNames = this.registry.getJavaNames(beName);

        if (javaNames.length === 0) {
            this.stats.beToJava.fallback++;
            this._warn(`[Converter] Unknown BE block: ${beName}, passing through`);
            return { name: beName, states: { ...beStates }, _warn: 'unknown_be_block' };
        }

        // Prefer hinted Java name if it maps to this BE name
        let javaName = javaNames[0];
        if (hintJava && javaNames.includes(hintJava)) {
            javaName = hintJava;
        }
        const javaStates = this.states.convertBedrockToJava(beName, beStates, javaName);

        this.stats.beToJava.success++;
        return {
            name: javaName,
            states: javaStates,
            _originalBedrock: beName
        };
    }

    /**
     * Round-trip test: Java -> BE -> Java, verify lossless
     * @param {{name: string, states: object}} javaBlock
     * @returns {{lossless: boolean, original: object, roundtrip: object, diff: object}}
     */
    testRoundTrip(javaBlock) {
        const be = this.javaToBedrock(javaBlock);
        const back = this.bedrockToJava(be);

        const diff = {};
        let lossless = true;

        if (back.name !== javaBlock.name) {
            diff.name = { expected: javaBlock.name, actual: back.name };
            lossless = false;
        }

        // Compare states (ignore order, only check keys present in original)
        if (javaBlock.states) {
            for (const [k, v] of Object.entries(javaBlock.states)) {
                if (back.states[k] === undefined) {
                    diff[k] = { expected: v, actual: 'missing' };
                    lossless = false;
                } else if (String(back.states[k]) !== String(v)) {
                    diff[k] = { expected: v, actual: back.states[k] };
                    lossless = false;
                }
            }
        }

        return {
            lossless,
            original: javaBlock,
            roundtrip: back,
            bedrock: be,
            diff
        };
    }

    /**
     * Verify mapping table coverage for a list of block names
     * @param {string[]} javaNames
     * @returns {{covered: int, uncovered: string[], total: int, coverage: string}}
     */
    verifyCoverage(javaNames) {
        let covered = 0;
        const uncovered = [];

        for (const name of javaNames) {
            if (this.registry.hasJava(name)) {
                covered++;
            } else {
                uncovered.push(name);
            }
        }

        return {
            covered,
            uncovered,
            total: javaNames.length,
            coverage: ((covered / javaNames.length) * 100).toFixed(1) + '%'
        };
    }

    /**
     * 构建方块NBT对象（兼容旧版 API：mc.setBlock / mc.spawnParticle）
     * @param {string} javaBlockName - Java版方块名称
     * @param {object} javaStates - Java版方块状态
     * @returns {{name: string, states: object, _originalJava: string}}
     */
    buildBlockData(javaBlockName, javaStates) {
        return this.javaToBedrock({ name: javaBlockName, states: javaStates || {} });
    }

    /**
     * 构建 mc.setBlock 兼容的NBT对象
     * @param {string} javaBlockName
     * @param {object} javaStates
     * @returns {object} NBT-lite 对象
     */
    buildBlockNbt(javaBlockName, javaStates) {
        const bedrock = this.javaToBedrock({ name: javaBlockName, states: javaStates || {} });
        try {
            if (typeof NbtCompound !== 'undefined') {
                const blockNbt = new NbtCompound();
                blockNbt.setString("name", bedrock.name);
                const statesNbt = new NbtCompound();
                for (const [k, v] of Object.entries(bedrock.states)) {
                    if (typeof v === 'boolean') statesNbt.setByte(k, v ? 1 : 0);
                    else if (typeof v === 'number') statesNbt.setInt(k, v);
                    else statesNbt.setString(k, String(v));
                }
                blockNbt.setTag("states", statesNbt);
                blockNbt.setInt("version", 17959425);
                return blockNbt;
            }
        } catch (e) {}
        return { name: bedrock.name, states: bedrock.states, version: 17959425 };
    }

    getStats() {
        return {
            ...this.stats,
            registry: this.registry.getStats()
        };
    }
}

const bidirectionalConverter = new BidirectionalBlockConverter();

module.exports = { BidirectionalBlockConverter, bidirectionalConverter };
