/**
 * Omni API Tracker for SillyTavern
 * 全量 API 调用审计与统计插件（正文 + 记忆插件 + 预设工具 + 向量检索 100% 全量捕获）
 * 
 * 核心原理：
 * 采用全局底层网络请求代理（Global Fetch Interceptor）与流管道旁路镜像（ReadableStream.tee()），
 * 在完全不影响酒馆原生打字机流式渲染与各插件业务逻辑的前提下，
 * 彻底捕获所有发往大模型或嵌入向量服务的请求，并基于调用栈（Call Stack）进行插件精确归因。
 * 
 * @author ymf2317-tech
 * @version 1.1.0
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXTENSION_NAME = 'st-omni-api-tracker';

// 默认存储结构
const defaultSettings = {
    enabled: true,
    showInTopBar: true, // 控制顶栏闪电徽章显示/隐藏
    totals: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        requests: 0,
    },
    today: {
        date: getTodayDateString(),
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        requests: 0,
    },
    session: {
        startTime: Date.now(),
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        requests: 0,
    },
    byCategory: {
        chat: { label: '正文主聊', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#38bdf8' },
        memory: { label: '记忆/总结/SP数据库', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#ec4899' },
        preset_tools: { label: '预设/小白盒工具', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#f59e0b' },
        vectors: { label: '向量检索', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#10b981' },
        other: { label: '其他扩展', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, color: '#8b5cf6' },
    },
    byModel: {},
    recentLogs: [], // 最大 100 条实时日志
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

    // 结构兜底
    for (const key of Object.keys(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = JSON.parse(JSON.stringify(defaultSettings[key]));
        }
    }

    // 检查日期跨天
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

/**
 * 启发式通用 Token 估算器（中英文混合自适应）
 */
function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.max(1, Math.round(chineseChars * 0.95 + (otherChars / 3.8)));
}

/**
 * 识别 API 目标
 */
function isTargetLLMApi(url) {
    if (!url) return false;
    let urlStr = '';
    if (typeof url === 'string') urlStr = url;
    else if (url instanceof URL) urlStr = url.href;
    else if (url && url.url) urlStr = url.url;

    if (!urlStr) return false;

    // 酒馆后端代理端点
    if (urlStr.includes('/api/backends/chat-completions') ||
        urlStr.includes('/api/backends/text-completions') ||
        urlStr.includes('/api/backends/embeddings')) {
        return true;
    }

    // 直连 OpenAI 格式端点
    if (urlStr.includes('/v1/chat/completions') ||
        urlStr.includes('/v1/completions') ||
        urlStr.includes('/v1/embeddings')) {
        return true;
    }

    return false;
}

/**
 * 智能归因识别器（核心重构）
 * 准确区分：经由小白盒拦截的正文主聊 vs 小白盒自身后台意图/总结 vs 记忆脚本(SP数据库/Smart-Context) vs 纯其他扩展
 */
function classifyRequest(stack, url, reqBodyParsed, isStream) {
    const s = (stack || '').toLowerCase();
    const u = (url || '').toLowerCase();

    // 1. 向量嵌入检索
    if (u.includes('/embeddings') || s.includes('vectors') || s.includes('chroma') || s.includes('embedding')) {
        return { category: 'vectors', caller: 'Vectors/Embedding' };
    }

    // 2. 记忆与长程数据库类（包含 SP 数据库、酒馆助手、Smart Context、酒馆原生 Memory、Auto-Summary）
    const isMemoryRelated = s.includes('smart-context') ||
        s.includes('extensions/memory') ||
        s.includes('/memory/') ||
        s.includes('supermemory') ||
        s.includes('sp_database') ||
        s.includes('sp-database') ||
        s.includes('database') ||
        s.includes('sqlite') ||
        s.includes('assistant') ||
        s.includes('summarize');

    if (isMemoryRelated) {
        let caller = 'Memory/Summary';
        if (s.includes('smart-context')) caller = 'Smart-Context';
        else if (s.includes('sp') || s.includes('database')) caller = 'SP数据库/记忆库';
        else if (s.includes('extensions/memory')) caller = 'ST原生记忆';
        return { category: 'memory', caller };
    }

    // 3. 小白盒（LittlewhiteBox）精细化判定：
    // 如果堆栈来自小白盒拦截器，但请求体具备完整的对话上下文，且为流式生成，这本质上是“经小白盒代理的正文主聊”！
    if (s.includes('littlewhitebox') || s.includes('xiaobai')) {
        const messages = reqBodyParsed?.messages;
        const isMultiTurn = Array.isArray(messages) && messages.length > 1;

        // 如果是流式且多轮对话，或者在聊天队列中，归为“正文主聊”
        if (isStream || isMultiTurn) {
            return { category: 'chat', caller: '小白盒 (正文主聊)' };
        } else {
            // 只有单句探测、意图识别、独立小指令才算预设工具
            return { category: 'preset_tools', caller: '小白盒 (意图/工具)' };
        }
    }

    // 4. 其他预设、模板、命令扩展
    if (s.includes('st-prompt-template')) {
        return { category: 'preset_tools', caller: 'Prompt-Template' };
    }
    if (s.includes('js-slash-runner') || s.includes('slashcommand')) {
        return { category: 'preset_tools', caller: 'Slash-Runner' };
    }
    if (s.includes('translate')) {
        return { category: 'preset_tools', caller: 'Translate' };
    }
    if (s.includes('caption')) {
        return { category: 'preset_tools', caller: 'Caption' };
    }

    // 5. 正文主流程（script.js 核心）
    if (s.includes('script.js') || s.includes('sendgenerationrequest') || s.includes('getchatcompletion')) {
        return { category: 'chat', caller: '主聊正文' };
    }

    // 6. 提取第三方未知名扩展目录
    const match = s.match(/extensions\/third-party\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
        return { category: 'other', caller: match[1] };
    }

    // 兜底：如果是流式多轮，默认主聊；否则归其他
    if (isStream) {
        return { category: 'chat', caller: '主聊管道' };
    }

    return { category: 'other', caller: '外部/其他扩展' };
}

/**
 * 记录统计并持久化
 */
function recordApiUsage(item) {
    if (!settings || !settings.enabled) return;

    const pTokens = Math.max(0, parseInt(item.prompt_tokens) || 0);
    const cTokens = Math.max(0, parseInt(item.completion_tokens) || 0);
    const tTokens = pTokens + cTokens;

    // 跨天检查
    const today = getTodayDateString();
    if (settings.today.date !== today) {
        settings.today = { date: today, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
    }

    // 1. 全局累计
    settings.totals.prompt_tokens += pTokens;
    settings.totals.completion_tokens += cTokens;
    settings.totals.total_tokens += tTokens;
    settings.totals.requests += 1;

    // 2. 今日
    settings.today.prompt_tokens += pTokens;
    settings.today.completion_tokens += cTokens;
    settings.today.total_tokens += tTokens;
    settings.today.requests += 1;

    // 3. 本次 Session
    settings.session.prompt_tokens += pTokens;
    settings.session.completion_tokens += cTokens;
    settings.session.total_tokens += tTokens;
    settings.session.requests += 1;

    // 4. 分类统计
    const cat = settings.byCategory[item.category] || settings.byCategory.other;
    cat.prompt_tokens += pTokens;
    cat.completion_tokens += cTokens;
    cat.total_tokens += tTokens;
    cat.requests += 1;

    // 5. 模型统计
    const mName = item.model || 'Unknown';
    if (!settings.byModel[mName]) {
        settings.byModel[mName] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
    }
    settings.byModel[mName].prompt_tokens += pTokens;
    settings.byModel[mName].completion_tokens += cTokens;
    settings.byModel[mName].total_tokens += tTokens;
    settings.byModel[mName].requests += 1;

    // 6. 实时流水日志
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

    // 持久化存储
    safeSaveSettings();

    // 更新 UI 视图
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

        // 如果不是目标大模型 API，直接透传放行
        if (!isTargetLLMApi(url)) {
            return originalFetch.apply(this, args);
        }

        // 构造跟踪项
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
            // 解析请求体
            let parsedReq = null;
            const reqBody = options.body;
            if (reqBody && typeof reqBody === 'string') {
                try {
                    parsedReq = JSON.parse(reqBody);
                    trackerItem.model = parsedReq.model || trackerItem.model;
                    trackerItem.is_stream = !!parsedReq.stream;

                    // 估算输入 Token 兜底
                    if (Array.isArray(parsedReq.messages)) {
                        let combinedText = '';
                        for (const m of parsedReq.messages) {
                            if (typeof m.content === 'string') combinedText += m.content + '\n';
                        }
                        trackerItem.prompt_tokens = estimateTokens(combinedText);
                    } else if (typeof parsedReq.prompt === 'string') {
                        trackerItem.prompt_tokens = estimateTokens(parsedReq.prompt);
                    }
                } catch (_) {}
            }

            // 抓取堆栈回溯，精准归因识别
            const stack = (new Error()).stack || '';
            const classification = classifyRequest(stack, trackerItem.url, parsedReq, trackerItem.is_stream);
            trackerItem.category = classification.category;
            trackerItem.caller = classification.caller;
        } catch (prepErr) {
            console.warn('[OmniTracker] Trace error (ignorable):', prepErr);
        }

        // 触发顶栏微动效提示
        triggerTopBarPulse();

        // 执行真实网络请求
        let response;
        try {
            response = await originalFetch.apply(this, args);
        } catch (fetchErr) {
            throw fetchErr;
        }

        // 分析响应
        try {
            if (response && response.ok) {
                // 流式响应 (SSE)：利用 body.tee() 进行无损旁路镜像
                if (trackerItem.is_stream && response.body && typeof response.body.tee === 'function') {
                    const [streamMain, streamTracker] = response.body.tee();

                    // 异步后台消费 streamTracker，完全不阻塞主渲染
                    consumeStreamForMetrics(streamTracker, trackerItem, startTime);

                    return new Response(streamMain, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                    });
                } else {
                    // 非流式响应：克隆 JSON
                    const cloned = response.clone();
                    cloned.json().then(data => {
                        trackerItem.duration_ms = Math.round(performance.now() - startTime);
                        if (data && data.usage) {
                            trackerItem.prompt_tokens = data.usage.prompt_tokens ?? trackerItem.prompt_tokens;
                            trackerItem.completion_tokens = data.usage.completion_tokens ?? 0;
                        } else {
                            const outText = data?.choices?.[0]?.message?.content || data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                            trackerItem.completion_tokens = estimateTokens(outText);
                        }
                        recordApiUsage(trackerItem);
                    }).catch(() => {
                        trackerItem.duration_ms = Math.round(performance.now() - startTime);
                        recordApiUsage(trackerItem);
                    });
                }
            }
        } catch (resErr) {
            console.warn('[OmniTracker] Response intercept error:', resErr);
        }

        return response;
    };

    console.log('[OmniTracker] 全局底层网络拦截器已就绪 (v1.1.0, loading_order: 1)');
}

/**
 * 旁路静默解析 SSE 流，读取官方 Usage 或累积字符
 */
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
                    if (parsed.usage) {
                        officialUsage = parsed.usage;
                    }
                    const chunk = parsed.choices?.[0]?.delta?.content || parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (chunk) {
                        accumulatedText += chunk;
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
    } finally {
        trackerItem.duration_ms = Math.round(performance.now() - startTime);

        if (officialUsage) {
            if (officialUsage.prompt_tokens !== undefined) trackerItem.prompt_tokens = officialUsage.prompt_tokens;
            if (officialUsage.completion_tokens !== undefined) trackerItem.completion_tokens = officialUsage.completion_tokens;
        } else {
            trackerItem.completion_tokens = estimateTokens(accumulatedText);
        }

        recordApiUsage(trackerItem);
    }
}

/**
 * 挂载 UI 元素（包含自愈重试与顶栏开关检查）
 */
function tryMountUI() {
    if (!window.$) {
        setTimeout(tryMountUI, 300);
        return;
    }

    // 1. 顶栏指示器（根据 showInTopBar 开关决定是否挂载）
    if (settings && settings.showInTopBar) {
        if ($('#omni_tracker_topbar_btn').length === 0) {
            const btnHtml = `
                <div id="omni_tracker_topbar_btn" title="Omni API Tracker: 点击查看全量调用看板">
                    <i class="fa-solid fa-bolt"></i>
                    <span id="omni_tracker_topbar_text">0</span>
                </div>
            `;

            if ($('#top-bar').length) {
                $('#top-bar').append(btnHtml);
                $('#omni_tracker_topbar_btn').on('click', showDashboardModal);
            } else if ($('#chat_header').length) {
                $('#chat_header').append(btnHtml);
                $('#omni_tracker_topbar_btn').on('click', showDashboardModal);
            }
        }
    } else {
        // 如果用户关闭了开关，彻底移除顶栏元素
        $('#omni_tracker_topbar_btn').remove();
    }

    // 2. 挂载设置面板抽屉（即使顶栏关闭，这里也永远提供打开入口）
    mountExtensionSettingsDrawer();
    updateTopBarUI();
}

function mountExtensionSettingsDrawer() {
    if ($('#extensions_settings').length === 0 || $('#omni_tracker_extension_settings').length) return;

    const drawerHtml = `
        <div id="omni_tracker_extension_settings" class="extension_container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-bolt" style="color:#4ade80;"></i> Omni API 全量调用审计</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                    <p style="font-size:12px; color:#cbd5e1; margin-bottom: 10px; line-height: 1.5;">
                        底层透明监听：正文主聊、记忆插件（SP数据库/Smart-Context/Memory）、小白盒意图与工具、向量检索等全部 API 消耗。
                    </p>
                    <div style="display:flex; gap:10px;">
                        <button class="menu_button" id="omni_open_dashboard_from_settings">
                            <i class="fa-solid fa-chart-pie"></i> 打开审计看板
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#extensions_settings').append(drawerHtml);
    $('#omni_open_dashboard_from_settings').on('click', showDashboardModal);
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
    const count = settings.today?.total_tokens || 0;
    $('#omni_tracker_topbar_text').text(formatTokens(count));
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
                    <h3><i class="fa-solid fa-chart-pie" style="color:#34d399;"></i> Omni API 全量调用审计看板</h3>
                    <button class="omni-close-btn" id="omni_close_modal_btn" title="关闭看板"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="omni-tabs">
                    <button class="omni-tab-btn active" data-tab="overview">📊 用量概览</button>
                    <button class="omni-tab-btn" data-tab="logs">📜 实时调用流水</button>
                    <button class="omni-tab-btn" data-tab="models">🤖 模型分布</button>
                    <button class="omni-tab-btn" data-tab="settings">⚙️ 设置与维护</button>
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

        // 计算分类百分比
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
                    <div class="omni-stat-title">本次会话</div>
                    <div class="omni-stat-value" style="color:#60a5fa !important;">${formatTokens(session.total_tokens)}</div>
                    <div class="omni-stat-sub">${session.requests} 次 API 调用</div>
                </div>
                <div class="omni-stat-card">
                    <div class="omni-stat-title">历史累计调用</div>
                    <div class="omni-stat-value" style="color:#c084fc !important;">${formatTokens(total.total_tokens)}</div>
                    <div class="omni-stat-sub">共 ${total.requests} 次交互</div>
                </div>
            </div>

            <div class="omni-section-title"><i class="fa-solid fa-layer-group" style="color:#38bdf8;"></i> 产生消耗的模块</div>
            <div>
                ${activeCatsHtml || '<div style="color:#94a3b8; font-size:12px; padding:10px 0;">暂无活跃模块消耗记录</div>'}
            </div>

            ${zeroCatsHtml ? `
                <div class="omni-section-title" style="margin-top:22px; font-size:12px; color:#94a3b8 !important;">
                    <i class="fa-solid fa-minus"></i> 未产生调用的模块 (未开启或无请求)
                </div>
                <div>${zeroCatsHtml}</div>
            ` : ''}
        `);
    } else if (activeTab === 'logs') {
        const logs = settings.recentLogs || [];
        if (logs.length === 0) {
            $panel.html('<div style="text-align:center; padding: 50px 20px; color:#94a3b8; font-size:13px;">暂无调用记录。与酒馆对话、或触发记忆/小白盒后台脚本时将在此实时显示。</div>');
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
                    <td style="color:#f8fafc; font-weight:600; max-width:140px; overflow:hidden; text-overflow:ellipsis;">${log.caller || '-'}</td>
                    <td style="color:#38bdf8;">${log.model || '-'}</td>
                    <td>${formatTokens(log.prompt_tokens)}</td>
                    <td>${formatTokens(log.completion_tokens)}</td>
                    <td style="font-weight:700; color:#34d399;">${formatTokens(log.total_tokens)}</td>
                    <td style="color:#94a3b8;">${log.duration_ms ? log.duration_ms + 'ms' : '-'}</td>
                </tr>
            `;
        }

        $panel.html(`
            <div style="overflow-x:auto;">
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
            <div style="overflow-x:auto;">
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
                        <div class="omni-setting-desc">在酒馆顶栏显示 ⚡ 今日消耗徽章（关闭后顶部更清爽，可随时从侧边栏扩展列表打开看板）</div>
                    </div>
                    <label class="omni-switch">
                        <input type="checkbox" id="omni_toggle_topbar" ${settings.showInTopBar ? 'checked' : ''}>
                        <span class="omni-slider"></span>
                    </label>
                </div>

                <div class="omni-actions" style="margin-top:24px;">
                    <button class="menu_button" id="omni_btn_reset_session"><i class="fa-solid fa-arrows-rotate"></i> 重置本次会话</button>
                    <button class="menu_button" id="omni_btn_reset_today"><i class="fa-solid fa-calendar-xmark"></i> 清空今日统计</button>
                    <button class="menu_button" id="omni_btn_export_json"><i class="fa-solid fa-file-export"></i> 导出审计记录 (JSON)</button>
                    <button class="menu_button" id="omni_btn_clear_all" style="background:#7f1d1d !important; color:#fca5a5 !important;"><i class="fa-solid fa-trash"></i> 清空全部历史数据</button>
                </div>
            </div>
        `);

        // 顶栏开关事件
        $('#omni_toggle_topbar').on('change', function () {
            const isChecked = $(this).prop('checked');
            settings.showInTopBar = isChecked;
            safeSaveSettings();

            if (isChecked) {
                tryMountUI();
                if (window.toastr) toastr.success('已开启顶栏指示器');
            } else {
                $('#omni_tracker_topbar_btn').remove();
                if (window.toastr) toastr.info('已隐藏顶栏指示器（可随时从扩展抽屉打开看板）');
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

        $('#omni_btn_export_json').on('click', () => {
            const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settings, null, 2));
            const dlAnchor = document.createElement('a');
            dlAnchor.setAttribute('href', dataStr);
            dlAnchor.setAttribute('download', `omni-api-tracker-export-${getTodayDateString()}.json`);
            dlAnchor.click();
        });

        $('#omni_btn_clear_all').on('click', () => {
            if (confirm('确定要清空全部 API 调用审计记录吗？该操作不可撤销。')) {
                extension_settings[EXTENSION_NAME] = JSON.parse(JSON.stringify(defaultSettings));
                settings = extension_settings[EXTENSION_NAME];
                safeSaveSettings();
                renderDashboardUI('settings');
                updateTopBarUI();
                if (window.toastr) toastr.success('所有统计数据已清空');
            }
        });
    }
}

// 扩展初始化入口（页面加载时立即执行）
(function () {
    loadSettings();
    installFetchHook();

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(tryMountUI, 100);
    } else {
        document.addEventListener('DOMContentLoaded', tryMountUI);
    }
})();
