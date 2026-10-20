/**
 * Omni API Tracker for SillyTavern (v1.4.1 渠道指纹精准归因版)
 * 融合双层哨兵流量审计 + 黎吧啦活跃时长心跳与 RPG 冒险者陪伴手账
 * 
 * @author ymf2317-tech & @黎吧啦
 * @version 1.4.1
 */

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXTENSION_NAME = 'st-omni-api-tracker';
const LEGACY_USAGE_KEY = 'st_usage_tracker_local';
const HEARTBEAT_INTERVAL = 15000; // 15秒心跳检测

// --- 顶层状态机哨兵（捕获酒馆官方生成生命周期）---
let currentGenerationState = {
    isGenerating: false,
    type: null,
    startTime: 0,
};

if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
    try {
        eventSource.on(event_types.GENERATION_STARTED, (type, params, dryRun) => {
            if (dryRun) return;
            currentGenerationState.isGenerating = true;
            currentGenerationState.type = type || 'normal';
            currentGenerationState.startTime = Date.now();
        });

        eventSource.on(event_types.GENERATION_STOPPED, () => {
            currentGenerationState.isGenerating = false;
            currentGenerationState.type = null;
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, () => {
            currentGenerationState.isGenerating = false;
            currentGenerationState.type = null;
        });
    } catch (e) {
        console.warn('[OmniTracker] Event listener init warn:', e);
    }
}

// --- RPG 冒险者等级与成就配置 ---
const RPG_CONFIG = {
    titles: [
        { h: 0, t: "迷途旅人", desc: "初次踏入这间赛博酒馆，一切都是未知的。" },
        { h: 20, t: "酒馆常客", desc: "老板娘已经记住了你喜欢的饮品。" },
        { h: 50, t: "见习编剧", desc: "你开始试图掌控角色的命运走向。" },
        { h: 100, t: "角色塑造者", desc: "你的文字赋予了纸片人灵魂。" },
        { h: 200, t: "世界架构师", desc: "世界书的条目在你的脑海中构建成型。" },
        { h: 400, t: "提示词大师", desc: "你掌握了与机魂沟通的咒语。" },
        { h: 700, t: "破壁人", desc: "第四面墙对你来说形同虚设。" },
        { h: 1000, t: "时间领主", desc: "你可以随意回溯时间，修改因果。" },
        { h: 1500, t: "虚空行者", desc: "你游走在上下文的边缘，窥视代码的深渊。" },
        { h: 2000, t: "奇点见证者", desc: "你即是这片虚拟宇宙的终极主宰。" }
    ],
    achievements: [
        { id: 'first_step', name: '初次链接', desc: '累计活跃时长达到 10 小时', check: (d, total) => total >= 10 },
        { id: 'immersion', name: '沉浸体验', desc: '累计活跃时长达到 50 小时', check: (d, total) => total >= 50 },
        { id: 'addicted', name: '赛博依赖', desc: '累计活跃时长达到 200 小时', check: (d, total) => total >= 200 },
        { id: 'ascension', name: '数字飞升', desc: '累计活跃时长达到 1000 小时', check: (d, total) => total >= 1000 },
        { id: 'marathon', name: '马拉松选手', desc: '单日在线活跃超过 8 小时', check: (entries) => entries.some(e => e.hours >= 8) },
        { id: 'limit_break', name: '极限肝帝', desc: '单日在线活跃超过 16 小时', check: (entries) => entries.some(e => e.hours >= 16) },
        { id: 'weekend', name: '周末狂欢', desc: '周末总时长占比 > 40% (需总时长>50h)', check: (entries, total) => {
            const we = entries.filter(e => e.day === 0 || e.day === 6).reduce((s, i) => s + i.hours, 0);
            return total > 50 && (we / total > 0.4);
        }},
        { id: 'streak_5', name: '无限续杯', desc: '连续 5 天每天超过 2 小时', check: (entries) => {
            let streak = 0;
            for (let e of entries) {
                if (e.hours >= 2) streak++; else streak = 0;
                if (streak >= 5) return true;
            }
            return false;
        }},
        { id: 'streak_14', name: '命运羁绊', desc: '连续 14 天每天超过 1 小时', check: (entries) => {
            let streak = 0;
            for (let e of entries) {
                if (e.hours >= 1) streak++; else streak = 0;
                if (streak >= 14) return true;
            }
            return false;
        }},
        { id: 'long_term', name: '细水长流', desc: '活跃天数超过 30 天', check: (entries) => entries.length >= 30 }
    ]
};

// 默认存储结构
const defaultSettings = {
    enabled: true,
    showInTopBar: true,
    totals: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 },
    today: { date: getTodayDateString(), prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 },
    session: { startTime: Date.now(), prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 },
    byCategory: {
        chat: { label: '正文主聊', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#38bdf8' },
        memory: { label: '记忆/总结/SP', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#ec4899' },
        tts: { label: '语音朗读(TTS)', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#14b8a6' },
        preset_tools: { label: '预设/工具/脚本', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#f59e0b' },
        vectors: { label: '向量检索', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#10b981' },
        other: { label: '其他扩展', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#8b5cf6' },
    },
    byModel: {},
    recentLogs: [],
    // 活跃时长数据
    activeTime: {
        daily: {}, // { 'YYYY-MM-DD': milliseconds }
        totalMs: 0,
    }
};

let settings = null;

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

function loadSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = JSON.parse(JSON.stringify(defaultSettings));
    }
    settings = extension_settings[EXTENSION_NAME];

    for (const key of Object.keys(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = JSON.parse(JSON.stringify(defaultSettings[key]));
        }
    }

    if (!settings.byCategory.tts) {
        settings.byCategory.tts = { label: '语音朗读(TTS)', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#14b8a6' };
    }

    if (!settings.activeTime) {
        settings.activeTime = { daily: {}, totalMs: 0 };
    }

    // 自动兼容并迁移黎吧啦旧脚本 (st_usage_tracker_local) 的历史活跃时长
    migrateLegacyActiveTime();

    // 跨天检查
    const today = getTodayDateString();
    if (settings.today.date !== today) {
        settings.today = {
            date: today,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            requests: 0,
        };
        safeSaveSettings();
    }
}

function migrateLegacyActiveTime() {
    try {
        let legacy = localStorage.getItem(LEGACY_USAGE_KEY);
        if (!legacy && window.extension_settings && window.extension_settings[LEGACY_USAGE_KEY]) {
            legacy = JSON.stringify(window.extension_settings[LEGACY_USAGE_KEY]);
        }
        if (legacy) {
            const parsed = JSON.parse(legacy);
            if (typeof parsed === 'object') {
                let mergedAny = false;
                for (const [day, ms] of Object.entries(parsed)) {
                    if (typeof ms === 'number') {
                        if (!settings.activeTime.daily[day] || settings.activeTime.daily[day] < ms) {
                            settings.activeTime.daily[day] = ms;
                            mergedAny = true;
                        }
                    }
                }
                if (mergedAny) {
                    recalculateTotalActiveMs();
                    safeSaveSettings();
                    console.log('[OmniTracker] 已成功融合历史活跃时长数据！');
                }
            }
        }
    } catch (e) {
        console.warn('[OmniTracker] Legacy time migration check:', e);
    }
}

function recalculateTotalActiveMs() {
    let sum = 0;
    for (const ms of Object.values(settings.activeTime.daily)) {
        sum += (ms || 0);
    }
    settings.activeTime.totalMs = sum;
}

function safeSaveSettings() {
    try {
        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
        }
    } catch (_) {}
}

function formatTokens(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toLocaleString();
}

function msToHourMin(ms) {
    const totalMin = Math.floor((ms || 0) / 60000);
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    return { hours, minutes };
}

function formatDuration(ms) {
    const { hours, minutes } = msToHourMin(ms);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * 活跃时长心跳累加器
 */
let isWindowActive = true;
window.addEventListener('focus', () => { isWindowActive = true; });
window.addEventListener('blur', () => { isWindowActive = false; });
document.addEventListener('visibilitychange', () => { isWindowActive = !document.hidden; });

function addActiveDuration(ms) {
    if (!settings || !settings.activeTime) return;
    const today = getTodayDateString();
    if (!settings.activeTime.daily[today]) {
        settings.activeTime.daily[today] = 0;
    }
    settings.activeTime.daily[today] += ms;
    settings.activeTime.totalMs = (settings.activeTime.totalMs || 0) + ms;

    // 同步写入 localStorage 双重保险
    try {
        localStorage.setItem(LEGACY_USAGE_KEY, JSON.stringify(settings.activeTime.daily));
    } catch (_) {}

    safeSaveSettings();
    updateTopBarUI();
}

// 启动 15 秒心跳定时器
setInterval(() => {
    if (isWindowActive && !document.hidden) {
        addActiveDuration(HEARTBEAT_INTERVAL);
    }
}, HEARTBEAT_INTERVAL);

/**
 * 现代大模型高精度分词估算器（对齐 BPE / cl100k / DeepSeek 真实词元压缩比）
 */
function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/g) || []).length;
    const otherChars = text.length - chineseChars;
    const newlines = (text.match(/\n/g) || []).length;
    const estimated = Math.round(chineseChars * 1.05 + (otherChars / 3.2) + (newlines * 0.5));
    return Math.max(1, estimated);
}

/**
 * 识别大模型与 TTS API 目标
 */
/**
 * 多层模型探测器：从请求体的各个可能路径里挖出真实模型名
 * 预设脚本的请求结构五花八门，顶层没有 model 是常态
 */
function extractModelName(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const candidates = [
        obj.model,
        obj.generate_data && obj.generate_data.model,
        obj.api && obj.api.model,
        obj.overrides && obj.overrides.model,
        obj.settings && obj.settings.model,
        obj.request && obj.request.model,
        obj.payload && obj.payload.model,
        obj.body && obj.body.model,
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
}

/**
 * 统一 Token 用量解析：兼容 OpenAI / Claude / Gemini / 各类中转站的字段差异
 */
function applyUsageFrom(trackerItem, usageObj) {
    if (!usageObj || typeof usageObj !== 'object') return false;

    const pIn = usageObj.prompt_tokens ?? usageObj.input_tokens ?? usageObj.promptTokenCount ?? usageObj.prompt_token_count;
    const cOut = usageObj.completion_tokens ?? usageObj.output_tokens ?? usageObj.candidatesTokenCount ?? usageObj.candidates_token_count;

    let hit = false;
    if (typeof pIn === 'number' && pIn > 0) { trackerItem.prompt_tokens = pIn; hit = true; }
    if (typeof cOut === 'number' && cOut > 0) { trackerItem.completion_tokens = cOut; hit = true; }
    return hit;
}

/**
 * 统一输出文本提取：兼容 chat / text / claude / gemini / 裸字段
 */
function extractOutputText(data) {
    if (!data || typeof data !== 'object') return '';

    const candidates = [
        data?.choices?.[0]?.message?.content,
        data?.choices?.[0]?.text,
        data?.choices?.[0]?.delta?.content,
        data?.message?.content,
        data?.content?.[0]?.text,
        data?.content,
        data?.candidates?.[0]?.content?.parts?.[0]?.text,
        data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join(''),
        data?.output_text,
        data?.response,
        data?.text,
    ];

    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c;
        if (Array.isArray(c)) {
            const joined = c.map(x => (typeof x === 'string' ? x : '')).join('');
            if (joined.trim()) return joined;
        }
    }
    return '';
}

function isTargetLLMApi(url) {
    if (!url) return false;
    let urlStr = '';
    if (typeof url === 'string') urlStr = url;
    else if (url instanceof URL) urlStr = url.href;
    else if (url && url.url) urlStr = url.url;

    if (!urlStr) return false;

    if (urlStr.includes('/api/backends/chat-completions') ||
        urlStr.includes('/api/backends/text-completions') ||
        urlStr.includes('/api/backends/embeddings') ||
        urlStr.includes('/api/backends/tts') ||
        urlStr.includes('/api/plugins/')) {
        return true;
    }

    if (urlStr.includes('/v1/chat/completions') ||
        urlStr.includes('/v1/completions') ||
        urlStr.includes('/v1/embeddings') ||
        urlStr.includes('/v1/audio/speech') ||
        urlStr.includes('/audio/speech')) {
        return true;
    }

    return false;
}

/**
 * 双层哨兵归因算法
 */
function classifyRequest(stack, url, reqBodyParsed, isStream, modelName) {
    const s = (stack || '').toLowerCase();
    const u = (url || '').toLowerCase();
    const m = (modelName || '').toLowerCase();

    // 1. 优先级最高：TTS 语音朗读
    const isTTS = m.includes('tts') ||
        m.includes('mimo') ||
        m.includes('voice') ||
        m.includes('speech') ||
        u.includes('/audio/') ||
        u.includes('/tts') ||
        s.includes('tts') ||
        s.includes('mimo');

    if (isTTS) {
        let caller = 'TTS语音';
        if (m.includes('mimo') || s.includes('mimo')) caller = 'MiMo-TTS';
        else if (m.includes('edge')) caller = 'Edge-TTS';
        return { category: 'tts', caller };
    }

    // 2. 向量嵌入检索
    if (u.includes('/embeddings') || m.includes('embed') || s.includes('vectors') || s.includes('chroma')) {
        return { category: 'vectors', caller: '向量检索' };
    }

    // ============================================================
    // 3. 通道指纹判定（v1.4.1 核心修复）
    //    优先级远高于"是否处于生成周期"，彻底解决预设被误算进正文的问题
    //    - 官方生成通道会在请求体带 type：normal/regenerate/swipe/continue/impersonate → 真正文
    //                                              quiet → 后台静默
    //    - 第三方扩展直连 ChatCompletionService 时通常没有 type 字段
    // ============================================================
    const reqType = (typeof reqBodyParsed?.type === 'string') ? reqBodyParsed.type.toLowerCase() : '';

    const MAIN_CHAT_TYPES = ['normal', 'regenerate', 'swipe', 'continue', 'impersonate', 'first_message'];

    const isBackgroundBridge = s.includes('call-generate-service') ||
        s.includes('custom-request.js') ||
        s.includes('chatcompletionservice.sendrequest');

    const isMemoryStack = s.includes('smart-context') ||
        s.includes('extensions/memory') ||
        s.includes('/memory/') ||
        s.includes('sp_database') ||
        s.includes('sp-database') ||
        s.includes('sqlite') ||
        s.includes('supermemory') ||
        s.includes('summar');

    const isPresetStack = s.includes('st-prompt-template') ||
        s.includes('prompt-template') ||
        s.includes('ruby') ||
        s.includes('translate') ||
        s.includes('caption') ||
        s.includes('js-slash-runner') ||
        s.includes('slash-commands') ||
        s.includes('littlewhitebox') ||
        s.includes('xiaobai');

    // 3.1 官方主聊通道：请求体明确标注主聊 → 正文（即使被小白X/SlashRunner 套了马甲也算正文）
    if (MAIN_CHAT_TYPES.includes(reqType)) {
        let caller = '主聊正文';
        if (s.includes('littlewhitebox') || s.includes('xiaobai')) caller = '正文 (经小白X)';
        else if (s.includes('js-slash-runner')) caller = '正文 (经SlashRunner)';
        else if (s.includes('st-prompt-template') || s.includes('prompt-template')) caller = '正文 (经提示词模板)';
        return { category: 'chat', caller };
    }

    // 3.2 官方静默通道 quiet：先分辨是"预设脚本借用静默通道"还是"真正的记忆/总结"
    if (reqType === 'quiet' || isMemoryStack) {
        // 预设类扩展借用 quiet 通道时，仍归入预设，绝不污染记忆分类
        if (isPresetStack && !isMemoryStack) {
            let pCaller = '预设/工具(quiet)';
            if (s.includes('st-prompt-template') || s.includes('prompt-template')) pCaller = '提示词模板(quiet)';
            else if (s.includes('ruby')) pCaller = 'RUBY(quiet)';
            else if (s.includes('call-generate-service') || s.includes('littlewhitebox') || s.includes('xiaobai')) pCaller = '小白X(quiet)';
            else if (s.includes('js-slash-runner')) pCaller = 'Slash宏脚本(quiet)';
            return { category: 'preset_tools', caller: pCaller };
        }
        let caller = '后台静默(quiet)';
        if (s.includes('sp_database') || s.includes('sp-database') || s.includes('sqlite')) caller = 'SP数据库/助手';
        else if (s.includes('smart-context')) caller = 'Smart-Context';
        else if (s.includes('extensions/memory')) caller = 'ST原生记忆';
        else if (s.includes('summar')) caller = '自动总结';
        else if (isMemoryStack) caller = '记忆/总结';
        return { category: 'memory', caller };
    }

    // 3.3 第三方扩展桥接直连（小白X 后台生成 / 提示词模板 / RUBY / 斜杠脚本等）
    if (isBackgroundBridge || isPresetStack) {
        let caller = '预设/工具';
        if (s.includes('call-generate-service')) caller = '小白X(后台生成)';
        else if (s.includes('littlewhitebox') || s.includes('xiaobai')) caller = '小白X(工具/意图)';
        else if (s.includes('st-prompt-template') || s.includes('prompt-template')) caller = '提示词模板';
        else if (s.includes('ruby')) caller = 'RUBY';
        else if (s.includes('js-slash-runner')) caller = 'Slash宏脚本';
        else if (s.includes('slash-commands')) caller = 'Slash命令';
        else if (s.includes('translate')) caller = '翻译扩展';
        else if (s.includes('caption')) caller = '图像描述';
        return { category: 'preset_tools', caller };
    }

    // 3.4 无任何指纹的裸请求：才退回启发式判定
    const messages = reqBodyParsed?.messages;
    const isMultiTurn = Array.isArray(messages) && messages.length > 1;
    const promptLen = typeof reqBodyParsed?.prompt === 'string' ? reqBodyParsed.prompt.length : 0;

    if (isStream && isMultiTurn) {
        return { category: 'chat', caller: '主聊正文(启发式)' };
    }

    if (isMultiTurn || promptLen > 500) {
        return { category: 'preset_tools', caller: '未知扩展(长上下文)' };
    }

    // 3.5 兜底：若确实处于官方主聊周期内
    if (currentGenerationState.isGenerating &&
        (currentGenerationState.type === 'normal' || currentGenerationState.type === 'impersonate' || currentGenerationState.type === 'continue')) {
        return { category: 'chat', caller: '主聊正文(周期)' };
    }

    // 6. 提取未知名第三方扩展
    const match = s.match(/extensions\/third-party\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
        return { category: 'other', caller: match[1] };
    }

    return { category: 'other', caller: '未知来源' };
}

/**
 * 记录统计并持久化
 */
function recordApiUsage(item) {
    if (!settings || !settings.enabled) return;

    const pTokens = Math.max(0, parseInt(item.prompt_tokens) || 0);
    const cTokens = Math.max(0, parseInt(item.completion_tokens) || 0);
    const tTokens = pTokens + cTokens;

    const today = getTodayDateString();
    if (settings.today.date !== today) {
        settings.today = { date: today, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
    }

    settings.totals.prompt_tokens += pTokens;
    settings.totals.completion_tokens += cTokens;
    settings.totals.total_tokens += tTokens;
    settings.totals.requests += 1;

    settings.today.prompt_tokens += pTokens;
    settings.today.completion_tokens += cTokens;
    settings.today.total_tokens += tTokens;
    settings.today.requests += 1;

    settings.session.prompt_tokens += pTokens;
    settings.session.completion_tokens += cTokens;
    settings.session.total_tokens += tTokens;
    settings.session.requests += 1;

    const cat = settings.byCategory[item.category] || settings.byCategory.other;
    cat.prompt_tokens += pTokens;
    cat.completion_tokens += cTokens;
    cat.total_tokens += tTokens;
    cat.requests += 1;

    const mName = item.model || 'Unknown';
    if (!settings.byModel[mName]) {
        settings.byModel[mName] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
    }
    settings.byModel[mName].prompt_tokens += pTokens;
    settings.byModel[mName].completion_tokens += cTokens;
    settings.byModel[mName].total_tokens += tTokens;
    settings.byModel[mName].requests += 1;

    const logEntry = {
        id: Date.now() + Math.random().toString(36).substring(2, 6),
        time: new Date().toLocaleTimeString(),
        category: item.category,
        caller: item.caller,
        model: mName,
        prompt_tokens: pTokens,
        completion_tokens: cTokens,
        total_tokens: tTokens,
        duration_ms: item.duration_ms,
        is_stream: item.is_stream,
    };

    settings.recentLogs.unshift(logEntry);
    if (settings.recentLogs.length > 100) {
        settings.recentLogs.pop();
    }

    safeSaveSettings();
    updateTopBarUI();
    if (window.$ && $('#omni_tracker_modal').is(':visible')) {
        renderDashboardUI();
    }
}

/**
 * 安装底层 Fetch 代理
 */
function installFetchHook() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const url = args[0];
        const options = args[1] || {};

        if (!isTargetLLMApi(url)) {
            return originalFetch.apply(this, args);
        }

        let trackerItem = {
            url: typeof url === 'string' ? url : (url.url || ''),
            model: 'Unknown',
            prompt_tokens: 0,
            completion_tokens: 0,
            category: 'chat',
            caller: 'Main Chat',
            is_stream: false,
            duration_ms: 0,
        };

        const startTime = performance.now();

        try {
            let parsedReq = null;
            const reqBody = options.body;
            if (reqBody && typeof reqBody === 'string') {
                try {
                    parsedReq = JSON.parse(reqBody);
                    const detectedModel = extractModelName(parsedReq);
                    if (detectedModel) trackerItem.model = detectedModel;
                    trackerItem.req_type = (typeof parsedReq.type === 'string') ? parsedReq.type : '';
                    trackerItem.is_stream = !!parsedReq.stream;

                    if (Array.isArray(parsedReq.messages)) {
                        let combinedText = '';
                        for (const m of parsedReq.messages) {
                            if (typeof m.content === 'string') combinedText += m.content + '\n';
                        }
                        trackerItem.prompt_tokens = estimateTokens(combinedText);
                    } else if (typeof parsedReq.prompt === 'string') {
                        trackerItem.prompt_tokens = estimateTokens(parsedReq.prompt);
                    } else if (typeof parsedReq.input === 'string') {
                        trackerItem.prompt_tokens = estimateTokens(parsedReq.input);
                    }
                } catch (_) {}
            }

            const stack = (new Error()).stack || '';
            const classification = classifyRequest(stack, trackerItem.url, parsedReq, trackerItem.is_stream, trackerItem.model);
            trackerItem.category = classification.category;
            trackerItem.caller = classification.caller;
        } catch (prepErr) {
            console.warn('[OmniTracker] Trace error (ignorable):', prepErr);
        }

        triggerTopBarPulse();

        let response;
        try {
            response = await originalFetch.apply(this, args);
        } catch (fetchErr) {
            throw fetchErr;
        }

        try {
            if (response && response.ok) {
                if (trackerItem.is_stream && response.body && typeof response.body.tee === 'function') {
                    const [streamMain, streamTracker] = response.body.tee();
                    consumeStreamForMetrics(streamTracker, trackerItem, startTime);

                    return new Response(streamMain, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                    });
                } else {
                    trackerItem.duration_ms = Math.round(performance.now() - startTime);
                    const cloned = response.clone();

                    cloned.json().then(data => {
                        // 1) 从返回体补齐真实模型
                        if ((!trackerItem.model || trackerItem.model === 'Unknown') && data && typeof data.model === 'string' && data.model.trim()) {
                            trackerItem.model = data.model.trim();
                        }

                        // 2) 合并所有可能的 usage 位置
                        let usageHit = false;
                        if (data && typeof data === 'object') {
                            usageHit = applyUsageFrom(trackerItem, data.usage)
                                || applyUsageFrom(trackerItem, data.usageMetadata)
                                || applyUsageFrom(trackerItem, data.usage_metadata)
                                || applyUsageFrom(trackerItem, data.message && data.message.usage);
                        }

                        // 3) 没有官方 usage 就用文本兜底估算
                        if (!usageHit) {
                            const outText = extractOutputText(data);
                            if (outText) trackerItem.completion_tokens = estimateTokens(outText);
                        }
                        recordApiUsage(trackerItem);
                    }).catch(() => {
                        // 非 JSON 响应（音频/纯文本等）
                        recordApiUsage(trackerItem);
                    });
                }
            }
        } catch (resErr) {
            console.warn('[OmniTracker] Response intercept error:', resErr);
        }

        return response;
    };

    console.log('[OmniTracker] 流量审计与冒险者公会手账已就绪 (v1.4.1)');
}

async function consumeStreamForMetrics(stream, trackerItem, startTime) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let officialUsage = null;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(dataStr);

                    // 从流式分片里补齐真实模型名（最可靠的一手证据）
                    if ((!trackerItem.model || trackerItem.model === 'Unknown') && typeof parsed.model === 'string' && parsed.model.trim()) {
                        trackerItem.model = parsed.model.trim();
                    }

                    // 合并各类 usage 字段
                    if (parsed.usage) officialUsage = parsed.usage;
                    else if (parsed.usageMetadata) officialUsage = parsed.usageMetadata;
                    else if (parsed.usage_metadata) officialUsage = parsed.usage_metadata;

                    const chunk = parsed.choices?.[0]?.delta?.content
                        || parsed.choices?.[0]?.text
                        || parsed.delta
                        || parsed.candidates?.[0]?.content?.parts?.[0]?.text
                        || parsed.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('');
                    if (typeof chunk === 'string' && chunk) {
                        accumulatedText += chunk;
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
    } finally {
        trackerItem.duration_ms = Math.round(performance.now() - startTime);

        let usageHit = false;
        if (officialUsage) {
            usageHit = applyUsageFrom(trackerItem, officialUsage);
        }
        if (!usageHit) {
            trackerItem.completion_tokens = estimateTokens(accumulatedText);
        }

        recordApiUsage(trackerItem);
    }
}

/**
 * 挂载 UI 元素
 */
function tryMountUI() {
    if (!window.$) {
        setTimeout(tryMountUI, 300);
        return;
    }

    if (settings && settings.showInTopBar) {
        if ($('#omni_tracker_topbar_btn').length === 0) {
            const btnHtml = `
                <div id="omni_tracker_topbar_btn" title="Omni API Tracker: 点击查看看板 (长按可隐藏)">
                    <i class="fa-solid fa-bolt"></i>
                    <span id="omni_tracker_topbar_text">0</span>
                </div>
            `;

            if ($('#top-bar').length) {
                $('#top-bar').append(btnHtml);
            } else if ($('#chat_header').length) {
                $('#chat_header').append(btnHtml);
            }

            $('#omni_tracker_topbar_btn').on('click', showDashboardModal);

            $('#omni_tracker_topbar_btn').on('contextmenu', function (e) {
                e.preventDefault();
                if (confirm('是否隐藏顶栏快捷指示器？\n（可随时在右侧扩展列表中重新开启）')) {
                    settings.showInTopBar = false;
                    safeSaveSettings();
                    $('#omni_tracker_topbar_btn').remove();
                    syncDrawerCheckbox();
                }
            });
        }
    } else {
        $('#omni_tracker_topbar_btn').remove();
    }

    mountExtensionSettingsDrawer();
    updateTopBarUI();
}

function mountExtensionSettingsDrawer() {
    if ($('#extensions_settings').length === 0 || $('#omni_tracker_extension_settings').length) {
        syncDrawerCheckbox();
        return;
    }

    const drawerHtml = `
        <div id="omni_tracker_extension_settings" class="extension_container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-bolt" style="color:#34d399;"></i> Omni 审计与冒险者公会手账</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 12px; background: rgba(0,0,0,0.25); border-radius: 6px;">
                    <p style="font-size:12px; color:#cbd5e1; margin-bottom: 12px; line-height: 1.5;">
                        双层哨兵全量监听（正文/记忆/TTS/预设）；内置冒险者公会活跃时长、RPG等级与成就图鉴。
                    </p>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:8px 10px; background:rgba(255,255,255,0.05); border-radius:6px;">
                        <span style="font-size:12px; font-weight:700; color:#fff;">显示顶栏快捷指示器</span>
                        <label class="omni-switch">
                            <input type="checkbox" id="omni_drawer_toggle_topbar" ${settings?.showInTopBar ? 'checked' : ''}>
                            <span class="omni-slider"></span>
                        </label>
                    </div>

                    <div style="display:flex; gap:10px;">
                        <button class="menu_button" id="omni_open_dashboard_from_settings">
                            <i class="fa-solid fa-chart-pie"></i> 打开审计与公会看板
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#extensions_settings').append(drawerHtml);
    $('#omni_open_dashboard_from_settings').on('click', showDashboardModal);

    $('#omni_drawer_toggle_topbar').on('change', function () {
        const isChecked = $(this).prop('checked');
        settings.showInTopBar = isChecked;
        safeSaveSettings();
        tryMountUI();
    });
}

function syncDrawerCheckbox() {
    if (!settings) return;
    $('#omni_drawer_toggle_topbar').prop('checked', !!settings.showInTopBar);
    $('#omni_modal_toggle_topbar').prop('checked', !!settings.showInTopBar);
}

function triggerTopBarPulse() {
    if (!window.$) return;
    const $btn = $('#omni_tracker_topbar_btn');
    if ($btn.length) {
        $btn.addClass('pulse-active');
        setTimeout(() => $btn.removeClass('pulse-active'), 800);
    }
}

function updateTopBarUI() {
    if (!settings || !window.$) return;
    const tokenStr = formatTokens(settings.today?.total_tokens || 0);
    const today = getTodayDateString();
    const todayMs = settings.activeTime?.daily?.[today] || 0;
    const timeStr = formatDuration(todayMs);

    // 胶囊显示：Token + 时长
    $('#omni_tracker_topbar_text').text(`${tokenStr} | ${timeStr}`);
}

function showDashboardModal() {
    if ($('#omni_tracker_modal').length) {
        $('#omni_tracker_modal').show();
        renderDashboardUI();
        return;
    }

    const modalHtml = `
        <div id="omni_tracker_modal" class="omni-modal-overlay">
            <div class="omni-modal-content">
                <div class="omni-modal-header">
                    <h3><i class="fa-solid fa-shield-halved" style="color:#34d399;"></i> Omni 流量审计与冒险者公会</h3>
                    <button class="omni-close-btn" id="omni_close_modal_btn" title="关闭看板"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="omni-tabs">
                    <button class="omni-tab-btn active" data-tab="overview">📊 用量概览</button>
                    <button class="omni-tab-btn" data-tab="rpg">🏰 陪伴手账</button>
                    <button class="omni-tab-btn" data-tab="logs">📜 实时流水</button>
                    <button class="omni-tab-btn" data-tab="models">🤖 模型分布</button>
                    <button class="omni-tab-btn" data-tab="settings">⚙️ 设置维护</button>
                </div>
                <div class="omni-tab-panel" id="omni_tab_content">
                    <!-- 动态渲染 -->
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    $('#omni_close_modal_btn').on('click', () => $('#omni_tracker_modal').hide());
    $('#omni_tracker_modal').on('click', function (e) {
        if ($(e.target).hasClass('omni-modal-overlay')) {
            $(this).hide();
        }
    });

    $('.omni-tab-btn').on('click', function () {
        $('.omni-tab-btn').removeClass('active');
        $(this).addClass('active');
        renderDashboardUI($(this).data('tab'));
    });

    renderDashboardUI('overview');
}

function renderDashboardUI(activeTab) {
    if (!activeTab) {
        activeTab = $('.omni-tab-btn.active').data('tab') || 'overview';
    }

    const $panel = $('#omni_tab_content');
    if (!settings) return;

    if (activeTab === 'overview') {
        const today = settings.today;
        const session = settings.session;
        const total = settings.totals;
        const todayDate = getTodayDateString();
        const todayActiveMs = settings.activeTime?.daily?.[todayDate] || 0;
        const totalActiveMs = settings.activeTime?.totalMs || 0;

        const catTotal = Math.max(1, Object.values(settings.byCategory).reduce((acc, c) => acc + (c.total_tokens || 0), 0));

        let activeCatsHtml = '';
        let zeroCatsHtml = '';

        for (const [key, cat] of Object.entries(settings.byCategory)) {
            const hasUsage = (cat.requests > 0 || cat.total_tokens > 0);
            const pct = hasUsage ? ((cat.total_tokens / catTotal) * 100).toFixed(1) : '0.0';

            const cardHtml = `
                <div class="omni-category-card ${hasUsage ? '' : 'is-zero'}">
                    <div class="omni-category-info">
                        <div class="omni-category-name">
                            <span>${cat.label}</span>
                            <span class="omni-category-calls">(${cat.requests}次调用)</span>
                        </div>
                        <div class="omni-category-stats">
                            <span>${formatTokens(cat.total_tokens)}</span>
                            <span class="omni-category-pct">(${pct}%)</span>
                        </div>
                    </div>
                    <div class="omni-progress-bg">
                        <div class="omni-progress-bar" style="width: ${hasUsage ? pct : 0}%; background: ${cat.color};"></div>
                    </div>
                </div>
            `;

            if (hasUsage) {
                activeCatsHtml += cardHtml;
            } else {
                zeroCatsHtml += cardHtml;
            }
        }

        $panel.html(`
            <div class="omni-stat-grid">
                <div class="omni-stat-card">
                    <div class="omni-stat-title">今日总消耗</div>
                    <div class="omni-stat-value">${formatTokens(today.total_tokens)}</div>
                    <div class="omni-stat-sub">入: ${formatTokens(today.prompt_tokens)} | 出: ${formatTokens(today.completion_tokens)}</div>
                </div>
                <div class="omni-stat-card">
                    <div class="omni-stat-title">今日活跃时长</div>
                    <div class="omni-stat-value" style="color:#fbbf24 !important;">${formatDuration(todayActiveMs)}</div>
                    <div class="omni-stat-sub">累计投入: ${formatDuration(totalActiveMs)}</div>
                </div>
                <div class="omni-stat-card">
                    <div class="omni-stat-title">本次会话</div>
                    <div class="omni-stat-value" style="color:#60a5fa !important;">${formatTokens(session.total_tokens)}</div>
                    <div class="omni-stat-sub">${session.requests} 次 API 调用</div>
                </div>
            </div>

            <div class="omni-section-title"><i class="fa-solid fa-layer-group" style="color:#38bdf8;"></i> 产生消耗的模块</div>
            <div>
                ${activeCatsHtml || '<div style="color:#94a3b8; font-size:12px; padding:10px 0;">暂无活跃模块消耗记录</div>'}
            </div>

            ${zeroCatsHtml ? `
                <div class="omni-section-title" style="margin-top:20px; font-size:12px; color:#94a3b8 !important;">
                    <i class="fa-solid fa-minus"></i> 未产生调用的模块 (未开启或无请求)
                </div>
                <div>${zeroCatsHtml}</div>
            ` : ''}
        `);
    } else if (activeTab === 'rpg') {
        // --- 🏰 陪伴手账（RPG冒险者公会）---
        const daily = settings.activeTime?.daily || {};
        const entries = Object.keys(daily).map(d => ({
            date: d,
            hours: (daily[d] || 0) / 3600000,
            day: new Date(d).getDay(),
        })).sort((a, b) => a.date.localeCompare(b.date));

        const totalHours = (settings.activeTime?.totalMs || 0) / 3600000;
        const level = Math.floor(totalHours / 10) + 1;
        const currentExp = totalHours % 10;
        const expPct = Math.min(100, (currentExp / 10) * 100).toFixed(1);

        let myTitle = RPG_CONFIG.titles[0];
        for (let t of RPG_CONFIG.titles) {
            if (totalHours >= t.h) myTitle = t;
        }

        let achieveHtml = '';
        RPG_CONFIG.achievements.forEach(ach => {
            const unlocked = ach.check(entries, totalHours);
            achieveHtml += `
                <div class="omni-achieve-card ${unlocked ? 'unlocked' : ''}">
                    <div class="omni-achieve-name">
                        <span>${ach.name}</span>
                        <span>${unlocked ? '🏆' : '🔒'}</span>
                    </div>
                    <div class="omni-achieve-desc">${ach.desc}</div>
                </div>
            `;
        });

        const top5 = [...entries].sort((a, b) => b.hours - a.hours).slice(0, 5);
        const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        let top5Rows = '';
        top5.forEach(e => {
            top5Rows += `
                <tr>
                    <td style="color:#ffffff;">${e.date}</td>
                    <td style="color:#94a3b8;">${weekMap[e.day]}</td>
                    <td style="font-weight:700; color:#fbbf24;">${e.hours.toFixed(1)} 小时</td>
                </tr>
            `;
        });

        const recent7 = entries.slice(-7);
        let maxH = Math.max(1, ...recent7.map(e => e.hours));
        let svgBars = '';
        recent7.forEach((e, idx) => {
            const h = (e.hours / maxH) * 80;
            const x = idx * 42 + 20;
            const y = 95 - h;
            svgBars += `
                <rect x="${x}" y="${y}" width="24" height="${h}" rx="3" fill="#34d399" opacity="0.85"></rect>
                <text x="${x + 12}" y="${y - 4}" fill="#fbbf24" font-size="9" text-anchor="middle">${e.hours.toFixed(1)}h</text>
                <text x="${x + 12}" y="112" fill="#94a3b8" font-size="9" text-anchor="middle">${e.date.slice(5)}</text>
            `;
        });

        $panel.html(`
            <div class="omni-rpg-hero">
                <div class="omni-rpg-header">
                    <div>
                        <div style="font-size:11px; color:#fbbf24; font-weight:700; text-transform:uppercase;">当前称号</div>
                        <div class="omni-rpg-title-text">${myTitle.t}</div>
                    </div>
                    <div class="omni-rpg-level-badge">
                        <span style="font-size:9px; opacity:0.8;">LV</span>
                        <span style="font-size:16px;">${level}</span>
                    </div>
                </div>
                <div style="font-size:12px; color:#94a3b8; font-style:italic; margin-bottom:8px;">"${myTitle.desc}"</div>
                
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-top:10px;">
                    <span style="color:#ffffff;">总潜行时长: ${totalHours.toFixed(1)} Hours</span>
                    <span style="color:#fbbf24;">进度: ${currentExp.toFixed(1)} / 10 h (${expPct}%)</span>
                </div>
                <div class="omni-rpg-exp-bar">
                    <div class="omni-rpg-exp-fill" style="width: ${expPct}%;"></div>
                </div>
            </div>

            <div class="omni-section-title"><i class="fa-solid fa-chart-column" style="color:#34d399;"></i> 最近活跃趋势 (7 Days)</div>
            <div class="omni-chart-box">
                ${recent7.length ? `
                    <svg viewBox="0 0 320 120" style="width:100%; height:130px; display:block;">
                        ${svgBars}
                    </svg>
                ` : '<div style="text-align:center; padding:30px; color:#94a3b8; font-size:12px;">暂无历史活跃天数记录</div>'}
            </div>

            <div class="omni-section-title"><i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> 成就图鉴</div>
            <div class="omni-achieve-grid">
                ${achieveHtml}
            </div>

            <div class="omni-section-title"><i class="fa-solid fa-crown" style="color:#f59e0b;"></i> 肝帝时刻 Top 5</div>
            <div class="omni-table-wrap" style="background:#1b1b28; border-radius:8px; border:1px solid #28283c;">
                <table class="omni-log-table">
                    <thead>
                        <tr><th>日期</th><th>星期</th><th>单日活跃时长</th></tr>
                    </thead>
                    <tbody>
                        ${top5Rows || '<tr><td colspan="3" style="text-align:center; color:#94a3b8;">暂无数据</td></tr>'}
                    </tbody>
                </table>
            </div>
        `);
    } else if (activeTab === 'logs') {
        const logs = settings.recentLogs || [];
        if (logs.length === 0) {
            $panel.html('<div style="text-align:center; padding: 50px 20px; color:#94a3b8; font-size:13px;">暂无调用记录。与酒馆对话、或触发记忆/TTS后台脚本时将在此实时显示。</div>');
            return;
        }

        let rowsHtml = '';
        for (const log of logs) {
            const badgeClass = `omni-badge-${log.category || 'other'}`;
            const catLabel = settings.byCategory[log.category]?.label?.split('/')[0] || log.category;
            rowsHtml += `
                <tr>
                    <td style="color:#94a3b8;">${log.time}</td>
                    <td><span class="omni-badge ${badgeClass}">${catLabel}</span></td>
                    <td style="color:#f8fafc; font-weight:600; max-width:130px; overflow:hidden; text-overflow:ellipsis;">${log.caller || '-'}</td>
                    <td style="color:#38bdf8; max-width:140px; overflow:hidden; text-overflow:ellipsis;">${log.model || '-'}</td>
                    <td>${formatTokens(log.prompt_tokens)}</td>
                    <td>${formatTokens(log.completion_tokens)}</td>
                    <td style="font-weight:700; color:#34d399;">${formatTokens(log.total_tokens)}</td>
                    <td style="color:#94a3b8;">${log.duration_ms ? log.duration_ms + 'ms' : '-'}</td>
                </tr>
            `;
        }

        $panel.html(`
            <div class="omni-table-wrap">
                <table class="omni-log-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>归属</th>
                            <th>发起来源</th>
                            <th>模型</th>
                            <th>Prompt</th>
                            <th>Completion</th>
                            <th>Total</th>
                            <th>耗时</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `);
    } else if (activeTab === 'models') {
        const models = settings.byModel || {};
        const mKeys = Object.keys(models);
        if (mKeys.length === 0) {
            $panel.html('<div style="text-align:center; padding: 50px 20px; color:#94a3b8; font-size:13px;">暂无模型调用数据。</div>');
            return;
        }

        let rows = '';
        for (const m of mKeys) {
            const data = models[m];
            rows += `
                <tr>
                    <td style="font-weight:700; color:#38bdf8;">${m}</td>
                    <td>${data.requests} 次</td>
                    <td>${formatTokens(data.prompt_tokens)}</td>
                    <td>${formatTokens(data.completion_tokens)}</td>
                    <td style="font-weight:700; color:#34d399;">${formatTokens(data.total_tokens)}</td>
                </tr>
            `;
        }

        $panel.html(`
            <div class="omni-table-wrap">
                <table class="omni-log-table">
                    <thead>
                        <tr>
                            <th>模型标识</th>
                            <th>调用次数</th>
                            <th>输入 Token</th>
                            <th>输出 Token</th>
                            <th>总计 Token</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `);
    } else if (activeTab === 'settings') {
        $panel.html(`
            <div style="font-size: 13px; line-height: 1.8;">
                <div class="omni-setting-row">
                    <div>
                        <div class="omni-setting-label">显示顶栏快捷指示器</div>
                        <div class="omni-setting-desc">在酒馆顶栏显示 ⚡ 今日消耗与活跃时长（关闭后界面更清爽，可随时在扩展列表中打开看板）</div>
                    </div>
                    <label class="omni-switch">
                        <input type="checkbox" id="omni_modal_toggle_topbar" ${settings.showInTopBar ? 'checked' : ''}>
                        <span class="omni-slider"></span>
                    </label>
                </div>

                <div class="omni-actions" style="margin-top:20px;">
                    <button class="menu_button" id="omni_btn_reset_session"><i class="fa-solid fa-arrows-rotate"></i> 重置本次会话</button>
                    <button class="menu_button" id="omni_btn_reset_today"><i class="fa-solid fa-calendar-xmark"></i> 清空今日统计</button>
                    <button class="menu_button" id="omni_btn_export_json"><i class="fa-solid fa-file-export"></i> 导出完整数据 (JSON)</button>
                    <button class="menu_button" id="omni_btn_import_trigger"><i class="fa-solid fa-file-import"></i> 导入数据 (支持旧时长文件)</button>
                    <input type="file" id="omni_file_input" accept=".json" style="display:none;">
                    <button class="menu_button" id="omni_btn_clear_all" style="background:#7f1d1d !important; color:#fca5a5 !important;"><i class="fa-solid fa-trash"></i> 清空全部历史数据</button>
                </div>
            </div>
        `);

        $('#omni_modal_toggle_topbar').on('change', function () {
            const isChecked = $(this).prop('checked');
            settings.showInTopBar = isChecked;
            safeSaveSettings();
            syncDrawerCheckbox();

            if (isChecked) {
                tryMountUI();
                if (window.toastr) toastr.success('已开启顶栏指示器');
            } else {
                $('#omni_tracker_topbar_btn').remove();
                if (window.toastr) toastr.info('已隐藏顶栏指示器（可随时从右侧扩展设置中重新打开）');
            }
        });

        $('#omni_btn_reset_session').on('click', () => {
            settings.session = { startTime: Date.now(), prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
            safeSaveSettings();
            renderDashboardUI('settings');
            updateTopBarUI();
            if (window.toastr) toastr.success('本次会话统计已重置');
        });

        $('#omni_btn_reset_today').on('click', () => {
            settings.today = { date: getTodayDateString(), prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
            safeSaveSettings();
            renderDashboardUI('settings');
            updateTopBarUI();
            if (window.toastr) toastr.success('今日用量统计已重置');
        });

        // 导出 JSON
        $('#omni_btn_export_json').on('click', () => {
            const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settings, null, 2));
            const dlAnchor = document.createElement('a');
            dlAnchor.setAttribute('href', dataStr);
            dlAnchor.setAttribute('download', `omni-tracker-backup-${getTodayDateString()}.json`);
            dlAnchor.click();
        });

        // 导入 JSON（兼容 Omni 完整备份与黎吧啦活跃时长 JSON）
        $('#omni_btn_import_trigger').on('click', () => $('#omni_file_input').click());
        $('#omni_file_input').on('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (evt) {
                try {
                    const data = JSON.parse(evt.target.result);
                    if (data && typeof data === 'object') {
                        const isDailyTimeFormat = Object.keys(data).some(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof data[k] === 'number');

                        if (isDailyTimeFormat) {
                            for (const [day, ms] of Object.entries(data)) {
                                if (typeof ms === 'number') {
                                    settings.activeTime.daily[day] = Math.max(settings.activeTime.daily[day] || 0, ms);
                                }
                            }
                            recalculateTotalActiveMs();
                            if (window.toastr) toastr.success('成功合并历史活跃时长数据！');
                        } else if (data.totals || data.activeTime) {
                            Object.assign(settings, data);
                            recalculateTotalActiveMs();
                            if (window.toastr) toastr.success('成功恢复 OmniTracker 完整数据！');
                        }
                        safeSaveSettings();
                        renderDashboardUI('settings');
                        updateTopBarUI();
                    }
                } catch (err) {
                    if (window.toastr) toastr.error('导入失败：无效的 JSON 格式');
                } finally {
                    e.target.value = '';
                }
            };
            reader.readAsText(file);
        });

        $('#omni_btn_clear_all').on('click', () => {
            if (confirm('确定要清空全部 API 调用审计与活跃时长记录吗？该操作不可撤销。')) {
                extension_settings[EXTENSION_NAME] = JSON.parse(JSON.stringify(defaultSettings));
                settings = extension_settings[EXTENSION_NAME];
                localStorage.removeItem(LEGACY_USAGE_KEY);
                safeSaveSettings();
                renderDashboardUI('settings');
                updateTopBarUI();
                if (window.toastr) toastr.success('所有统计与时长数据已清空');
            }
        });
    }
}

// 扩展初始化入口
(function () {
    loadSettings();
    installFetchHook();

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(tryMountUI, 100);
    } else {
        document.addEventListener('DOMContentLoaded', tryMountUI);
    }
})();
