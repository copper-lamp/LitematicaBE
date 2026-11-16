// I18n - 接入 LSE（LeviLamina 脚本引擎）国际化
// LSE 暴露的 `i18n` 全局对象底层就是 LL 的 I18n 管理器（ll::i18n）。
// 它支持：i18n.load(path, defaultLocale, defaultData) / i18n.get(key, locale)
//         / i18n.tr(key, ...args) / i18n.trl(locale, key, ...args)
// 格式化遵循 fmt 语法：{} 位置参数、{0} 索引、{name} 命名参数、{:.2f} 等。
const path = require('path');

// 语言文件目录：随 src/ 一起进发布包（plugins/LitematicaBE/src/i18n/lang/）
const LANG_DIR = path.join(__dirname, 'lang');

// 找不到玩家语言（pl.langCode 为空/异常）时的回落语言
const DEFAULT_LOCALE = 'zh_CN';

// 本地 zh_CN 原文兜底：LSE 未暴露 i18n / 未初始化 / 加载失败 / 翻译抛错时，
// t/tell/tr 回落到这份原文而不是键名（也供模块在 steps 记录里保留中文原文）。
let ZH_FALLBACK = {};
try {
    ZH_FALLBACK = require('./lang/zh_CN.json');
} catch (e) {
    ZH_FALLBACK = {};
}

// 本地 en_US 译文兜底：按玩家语言（langCode）从本地表取译文，保证即使 LSE i18n
// 加载失败/未命中，英文玩家也能看到英文而不是回落到默认中文。
let EN_FALLBACK = {};
try {
    EN_FALLBACK = require('./lang/en_US.json');
} catch (e) {
    EN_FALLBACK = {};
}

// 语言 → 本地译文表（目前 en 系与 zh 系；zh_TW 暂无独立文件，回落 zh_CN）。
// 新增语言：在此映射 + lang/ 下加同名 .json。
function tableOfLocale(locale) {
    const lc = normalizeLocale(locale);
    if (lc && lc.toLowerCase().startsWith('en')) return EN_FALLBACK;
    return ZH_FALLBACK; // zh_CN / zh_TW / 未知语言默认中文
}

// 本地格式化：支持 {} 顺序参数与 {0} 索引参数（LSE 的 fmt 语法子集）。
// 与 LSE i18n 的 fmt 一致，但可在无 i18n 环境（测试）下工作。
function fmt(template, args) {
    if (typeof template !== 'string') return template;
    let auto = 0;
    return template.replace(/\{(\d*)\}/g, (m, idx) => {
        const a = idx === '' ? args[auto++] : args[Number(idx)];
        return a === undefined || a === null ? '' : String(a);
    });
}

/** 取本地 zh_CN 原文并格式化（不依赖 i18n 全局；语言缺失时返回 key 原文） */
function zh(key, ...args) {
    const tmpl = ZH_FALLBACK[key];
    return tmpl != null ? fmt(tmpl, args) : key;
}

// 默认语言数据：语言文件缺失时 LSE 用它补全/创建文件；这里只放最小兜底，主文案以 lang/*.json 为准
const DEFAULT_LANG_DATA = {
    zh_CN: {
        'selection.point1': '§a请使用 §e木剑右键 §a选择第 §e1 §a个坐标点',
        'selection.cancelled': '§c选区已取消',
    },
    en_US: {},
};

// 语言别名：把 Bedrock 可能的 langCode 变体归一到我们实际提供的语言文件。
// 玩家 pl.langCode 是 Bedrock 格式（en_US / zh_CN / ja_JP…），语言文件名必须与之匹配，
// 否则查不到 → LSE 回落到 defaultLocaleName(zh_CN) → 英文玩家反而看到中文。
const LOCALE_ALIAS = {
    en: 'en_US', en_GB: 'en_US', en_AU: 'en_US', en_CA: 'en_US', en_NZ: 'en_US',
    zh: 'zh_CN', zh_HK: 'zh_TW',
};

let initialized = false;

/**
 * 初始化（幂等）：加载语言目录（所有 lang/*.json，文件名即语言代码）。
 * 不打印日志。失败不抛出——t/tell/tr 回落到本地 zh/en 表，插件照常工作。
 * 若调用时 LSE 的 `i18n` 全局尚未注入（模块顶层 require 阶段），静默跳过，
 * 后续 t/tell/tr 会通过 ensureInit() 自动重试。
 */
function init() {
    ensureInit();
}

/** 懒初始化：t/tell/tr 入口调用，保证 i18n 就绪后再翻译（覆盖延迟注入场景） */
function ensureInit() {
    if (initialized) return;
    if (typeof i18n === 'undefined') return; // LSE 未暴露 i18n：静默跳过，回落本地表
    try {
        // 目录加载要求路径以分隔符结尾（LSE 约定）
        i18n.load(LANG_DIR + path.sep, DEFAULT_LOCALE, DEFAULT_LANG_DATA);
        initialized = true;
    } catch (e) {
        // 语言文件缺失/损坏：静默，t/tell 回落本地 zh/en 表
    }
}

/** 语言代码归一化：把 Bedrock langCode 的常见变体归一到我们实际提供的语言文件名。
 *  覆盖大小写/连字符变体：en-us / en_us / enus / EN_US → en_US；zh_cn → zh_CN。
 *  别名：en/en_GB/en_AU/en_CA/en_NZ → en_US；zh → zh_CN；zh_HK → zh_TW。未命中返回原样。 */
function normalizeLocale(lc) {
    if (!lc) return DEFAULT_LOCALE;
    let s = String(lc).trim();
    if (!s) return DEFAULT_LOCALE;
    // 统一连字符/空格为下划线，再规范成 xx_YY（语言小写、地区大写）
    const parts = s.replace(/[- ]/g, '_').split('_').filter(Boolean);
    let norm;
    if (parts.length >= 2) {
        norm = parts[0].toLowerCase() + '_' + parts.slice(1).map(p => p.toUpperCase()).join('_');
    } else {
        norm = parts[0].toLowerCase();
    }
    return LOCALE_ALIAS[norm] || norm;
}

/** 取玩家语言代码（形如 en_US），异常时回落到默认语言 */
function localeOf(player) {
    const lc = player && player.langCode;
    return typeof lc === 'string' && lc ? normalizeLocale(lc) : DEFAULT_LOCALE;
}

/** 按玩家语言翻译并格式化。
 *  优先本地译文表（按玩家 langCode 选 en/zh），保证英文玩家一定看到英文；
 *  本地未命中时再走 LSE i18n.trl 兜底；LSE 不可用/抛错时回落到本地 zh 原文。 */
function t(player, key, ...args) {
    ensureInit();
    const loc = localeOf(player);
    const tbl = tableOfLocale(loc);
    const tmpl = tbl ? tbl[key] : undefined;
    if (tmpl != null) return fmt(tmpl, args);
    if (typeof i18n !== 'undefined' && initialized) {
        try {
            return i18n.trl(loc, key, ...args);
        } catch (e) {
            // 翻译抛错：回落本地 zh 原文
        }
    }
    return zh(key, ...args);
}

/** 按玩家语言翻译并发送给玩家（player.tell 的国际化版本） */
function tell(player, key, ...args) {
    if (player && typeof player.tell === 'function') {
        player.tell(t(player, key, ...args));
    }
}

/** 用默认语言（zh_CN）翻译（控制台/日志用），回落到本地 zh 原文 */
function tr(key, ...args) {
    ensureInit();
    const tmpl = ZH_FALLBACK[key];
    if (tmpl != null) return fmt(tmpl, args);
    if (typeof i18n !== 'undefined' && initialized) {
        try {
            return i18n.tr(key, ...args);
        } catch (e) {
            // 翻译抛错：回落本地 zh 原文
        }
    }
    return zh(key, ...args);
}

module.exports = { init, ensureInit, t, tell, tr, zh, fmt, localeOf, normalizeLocale, LANG_DIR, DEFAULT_LOCALE };
