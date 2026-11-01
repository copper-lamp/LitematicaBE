/**
 * check_plugin_commands.js — 命令注册静态体检
 *
 * 为什么需要它：LSE 的 Command.setup() 在枚举/重载组合非法时只返回 false，
 * 不抛异常、不写日志。这类故障在服务器上表现为"命令根本不存在"，
 * 而单元测试又跑不到 BDS 命令解析器。所以这里按 LSE 文档的规则做静态校验：
 *
 *   1. 每条命令至少一条 overload（LSE 文档：必须至少添加一条重载）
 *   2. 每条 overload 必须包含全部 mandatory 参数（按参数名或其枚举名匹配）
 *   3. overload 里的标识符必须能解析为已声明参数名或枚举名
 *   4. ParamType.RawText 只能出现在 overload 的最后一位
 *   5. 同一命令的 overload 不能出现参数类型序列完全相同的两条（BDS 无法区分）
 *   6. 枚举值必须有对应的 case 分支（否则静默落到 default；曾因 `/lit debug` 全落 default 排查很久）
 *      仅在该命令确实用 switch 分派时检查——像 GhostAction 走 dispatchGhost 内的 if 分派，段内没有 case，跳过。
 *
 * 用法：node tests/check_plugin_commands.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.js');
const src = fs.readFileSync(INDEX, 'utf8');

/** 从 mc.newCommand 起点把文件切成若干命令段，并记录所在 builder 函数名 */
function splitCommands(text) {
    const marks = [];
    const re = /mc\.newCommand\(\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        marks.push({ name: m[1], index: m.index });
    }
    return marks.map((mark, i) => ({
        name: mark.name,
        builder: builderNameBefore(text, mark.index),
        body: text.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : text.length),
    }));
}

/** 命令对象所在函数名（注册时按函数名交给 setupCommand） */
function builderNameBefore(text, index) {
    const before = text.slice(0, index);
    const re = /function\s+(\w+)\s*\(/g;
    let last = null;
    let m;
    while ((m = re.exec(before)) !== null) last = m[1];
    return last;
}

function parseParams(body) {
    const params = new Map();   // name -> { type, enumName, mandatory }
    const enums = new Map();    // enumName -> options[]

    let m;
    const enumRe = /\.setEnum\(\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/g;
    while ((m = enumRe.exec(body)) !== null) {
        const options = m[2].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        enums.set(m[1], options);
    }

    const mandRe = /\.mandatory\(\s*"([^"]+)"\s*,\s*ParamType\.(\w+)(?:\s*,\s*"([^"]+)")?/g;
    while ((m = mandRe.exec(body)) !== null) {
        params.set(m[1], { type: m[2], enumName: m[3] || null, mandatory: true });
    }

    const optRe = /\.optional\(\s*"([^"]+)"\s*,\s*ParamType\.(\w+)(?:\s*,\s*"([^"]+)")?/g;
    while ((m = optRe.exec(body)) !== null) {
        if (!params.has(m[1])) {
            params.set(m[1], { type: m[2], enumName: m[3] || null, mandatory: false });
        }
    }

    const overloads = [];
    const ovRe = /\.overload\(\s*\[([^\]]*)\]\s*\)/g;
    while ((m = ovRe.exec(body)) !== null) {
        overloads.push(m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
    }

    return { params, enums, overloads, hasSetup: /\.setup\(\)/.test(body) };
}

function check() {
    const problems = [];
    const commands = splitCommands(src);
    const report = [];

    for (const cmd of commands) {
        const { params, enums, overloads, hasSetup } = parseParams(cmd.body);

        // setup 既可能在段内直接调用，也可能由 setupCommand(label, builder) 统一代管
        const delegated = cmd.builder
            ? new RegExp(`setupCommand\\(\\s*['"][^'"]*['"]\\s*,\\s*${cmd.builder}\\s*\\)`).test(src)
            : false;
        if (!hasSetup && !delegated) {
            problems.push(`${cmd.name}: 既没有 setup()，也没有交给 setupCommand 注册（builder=${cmd.builder || '未知'}）`);
        }
        if (!overloads.length) problems.push(`${cmd.name}: 没有声明任何 overload（LSE 要求至少一条）`);

        const mandatoryEntries = Array.from(params.entries()).filter(([, v]) => v.mandatory);
        const seenSignatures = new Map();

        for (const ov of overloads) {
            const signature = [];

            for (let i = 0; i < ov.length; i++) {
                const token = ov[i];
                if (enums.has(token)) {
                    signature.push(`Enum:${token}`);
                    continue;
                }
                if (params.has(token)) {
                    const p = params.get(token);
                    signature.push(p.type);
                    if (p.type === 'RawText' && i !== ov.length - 1) {
                        problems.push(`${cmd.name}: overload [${ov.join(',')}] 的 RawText 参数 "${token}" 不在最后一位`);
                    }
                    continue;
                }
                problems.push(`${cmd.name}: overload [${ov.join(',')}] 引用了未声明的标识符 "${token}"`);
            }

            // 每条 overload 必须覆盖全部 mandatory 参数
            for (const [name, p] of mandatoryEntries) {
                const covered = ov.includes(name) || (p.enumName && ov.includes(p.enumName));
                if (!covered) {
                    problems.push(`${cmd.name}: overload [${ov.join(',')}] 缺少 mandatory 参数 "${name}"（枚举 ${p.enumName || '无'}）`);
                }
            }

            const sig = signature.join(' | ');
            if (seenSignatures.has(sig)) {
                problems.push(`${cmd.name}: overload [${ov.join(',')}] 与 [${seenSignatures.get(sig).join(',')}] 的参数类型序列相同，BDS 无法区分`);
            } else {
                seenSignatures.set(sig, ov);
            }
        }

        // 规则 6：枚举值必须有 case 分支（仅当该命令用 switch 分派时检查）
        const caseRe = /case\s+"([^"]+)"\s*:/g;
        const cases = new Set();
        let cm;
        while ((cm = caseRe.exec(cmd.body)) !== null) cases.add(cm[1]);
        let caseCount = cases.size;
        if (cases.size) {
            for (const [enumName, options] of enums) {
                for (const opt of options) {
                    if (!cases.has(opt)) {
                        problems.push(`${cmd.name}: 枚举 ${enumName} 的值 "${opt}" 没有 case 分支（会静默落到 default）`);
                    }
                }
            }
        }

        report.push({
            name: cmd.name,
            overloads: overloads.map(o => `[${o.join(',')}]`).join(' '),
            mandatory: mandatoryEntries.map(([n]) => n).join(','),
            enums: Array.from(enums.keys()).join(','),
            caseCount,
        });
    }

    console.log('=== 命令注册静态体检 ===\n');
    for (const r of report) {
        console.log(`/${r.name}`);
        console.log(`  重载: ${r.overloads || '(无)'}`);
        console.log(`  必填: ${r.mandatory || '(无)'}  枚举: ${r.enums || '(无)'}`);
        if (r.caseCount) console.log(`  case 分支: ${r.caseCount} 个`);
    }

    if (problems.length) {
        console.log(`\n结果: FAIL（${problems.length} 项）`);
        for (const p of problems) console.log(`  - ${p}`);
        process.exitCode = 1;
        return;
    }
    console.log(`\n结果: PASS（${report.length} 条命令，规则 1–6 全部通过）`);
}

check();
