// models.dev rates are USD per million tokens. Never guess a price by fuzzy matching.
export const PRICING_URL = 'https://models.dev/api.json?type=all';
export const PRICE_CACHE_KEY = 'st-omni-api-tracker-prices-v1';
export const PRICE_CACHE_TTL = 24 * 60 * 60 * 1000;

const finiteRate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const tokens = value => Math.max(0, Number(value) || 0);
const normalize = value => String(value || '').trim().toLowerCase().replace(/^models\//, '');
const sourceAliases = { claude: 'anthropic', makersuite: 'google', gemini: 'google', vertexai: 'google-vertex', ai21: 'ai21', cohere: 'cohere' };
const officialHosts = { 'api.openai.com': 'openai', 'api.anthropic.com': 'anthropic', 'generativelanguage.googleapis.com': 'google', 'openrouter.ai': 'openrouter' };

export function buildCatalog(data) {
    const entries = [];
    const hosts = { ...officialHosts };
    for (const [providerId, provider] of Object.entries(data || {})) {
        try { if (provider.api) hosts[new URL(provider.api).hostname] = providerId; } catch { /* Optional API URL. */ }
        for (const [modelId, model] of Object.entries(provider.models || {})) {
            // Character/second/image/request billing cannot be inferred from text token counts.
            if (model.type && !['chat', 'embedding'].includes(model.type)) continue;
            if (model.modalities?.output?.length && !model.modalities.output.includes('text')) continue;
            if (!model.cost || (!finiteRate(model.cost.input) && !finiteRate(model.cost.output))) continue;
            entries.push({ provider: providerId, model: modelId, cost: model.cost });
        }
    }
    return { entries, hosts };
}

export function inferProvider(body = {}, requestUrl = '', catalog) {
    // An explicit endpoint takes precedence over the protocol selected in SillyTavern.
    const endpoint = body.reverse_proxy || body.custom_url || body.api_server || body.server_url;
    const url = endpoint || requestUrl;
    try {
        const host = new URL(url, 'http://omni.local').hostname;
        if (catalog?.hosts?.[host]) return catalog.hosts[host];
        if (officialHosts[host]) return officialHosts[host];
        if (endpoint) return ''; // Unknown relay: use a clearly labelled reference price.
    } catch { /* Fall back to the declared provider. */ }
    const source = normalize(body.chat_completion_source || body.api_type || body.api);
    if (['custom', 'oai', 'openai-compatible'].includes(source)) return '';
    return sourceAliases[source] || source;
}

function canonicalProvider(model) {
    const id = normalize(model);
    const prefix = id.split('/')[0];
    if (id.includes('/')) return ({ 'meta-llama': 'meta', 'qwen': 'alibaba' })[prefix] || prefix;
    if (/^(gpt-|chatgpt-|o[1-9](?:-|$)|text-embedding-)/.test(id)) return 'openai';
    if (id.startsWith('claude-')) return 'anthropic';
    if (id.startsWith('gemini-')) return 'google';
    if (id.startsWith('deepseek-')) return 'deepseek';
    if (id.startsWith('grok-')) return 'xai';
    return '';
}

export function findPrice(catalog, model, provider = '') {
    if (!catalog) return null;
    const id = normalize(model);
    if (!id || id === 'unknown') return null;
    const bare = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
    const candidates = catalog.entries.filter(entry => {
        const candidate = normalize(entry.model);
        return candidate === id || candidate === bare || candidate === `${entry.provider}/${id}`;
    });
    if (provider) {
        const match = candidates.find(entry => entry.provider === provider && normalize(entry.model) === id)
            || candidates.find(entry => entry.provider === provider);
        return match ? { ...match, reference: false } : null;
    }
    const canonical = canonicalProvider(model);
    const match = candidates.find(entry => entry.provider === canonical);
    // A single exact match is safe; do not pick an arbitrary reseller when ambiguous.
    const unique = match || (candidates.length === 1 ? candidates[0] : null);
    return unique ? { ...unique, reference: true } : null;
}

export function ratesForContext(cost, promptTokens) {
    let rates = { ...cost };
    const tiers = [...(cost.tiers || [])].filter(t => t.tier?.type === 'context')
        .sort((a, b) => a.tier.size - b.tier.size);
    if (!tiers.length && cost.context_over_200k && promptTokens > 200000) rates = { ...rates, ...cost.context_over_200k };
    for (const tier of tiers) {
        if (promptTokens > tier.tier.size) rates = { ...rates, ...tier };
    }
    return Object.fromEntries(['input', 'output', 'cache_read', 'cache_write'].filter(key => finiteRate(rates[key])).map(key => [key, rates[key]]));
}

export function makeCostBucket(item, catalog) {
    const match = item.category === 'tts' ? null : findPrice(catalog, item.model, item.provider);
    return {
        model: item.model || 'Unknown', provider: item.provider || '', category: item.category || 'scripts',
        prompt_tokens: tokens(item.prompt_tokens), completion_tokens: tokens(item.completion_tokens),
        cached_tokens: tokens(item.cached_tokens), cache_write_tokens: tokens(item.cache_write_tokens),
        requests: 1,
        // Freeze known rates per request, including long-context tiers, across price refreshes.
        price: match ? { provider: match.provider, model: match.model, reference: match.reference,
            rates: ratesForContext(match.cost, tokens(item.prompt_tokens)) } : null,
    };
}

export function addCostBucket(stats, bucket) {
    stats.cost_buckets ||= {};
    const key = JSON.stringify([bucket.model, bucket.provider, bucket.category, bucket.price]);
    const target = stats.cost_buckets[key] ||= { ...bucket, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, requests: 0 };
    for (const field of ['prompt_tokens', 'completion_tokens', 'cached_tokens', 'cache_write_tokens', 'requests']) target[field] += tokens(bucket[field]);
}

export function estimateBucket(bucket, catalog) {
    if (bucket.category === 'tts') return { usd: null, reason: '语音费用不能按文本 Token 可靠计算' };
    const match = bucket.price || findPrice(catalog, bucket.model, bucket.provider);
    if (!match) return { usd: null, reason: '未匹配到 models.dev 价格' };
    const rates = match.rates || ratesForContext(match.cost, 0);
    const input = tokens(bucket.prompt_tokens);
    const output = tokens(bucket.completion_tokens);
    const read = Math.min(input, tokens(bucket.cached_tokens));
    const write = Math.min(input - read, tokens(bucket.cache_write_tokens));
    if ((input > 0 && !finiteRate(rates.input)) || (output > 0 && !finiteRate(rates.output))) {
        return { usd: null, reason: '缺少对应输入或输出单价' };
    }
    const inputUsd = ((input - read - write) * (rates.input || 0)
        + read * (rates.cache_read ?? rates.input ?? 0)
        + write * (rates.cache_write ?? rates.input ?? 0)) / 1000000;
    const outputUsd = output * (rates.output || 0) / 1000000;
    return { usd: inputUsd + outputUsd, inputUsd, outputUsd, provider: match.provider, reference: !!match.reference, rates };
}

export function summarizeCost(stats = {}, catalog, model = '', category = '') {
    const summary = { usd: 0, priced: 0, unpriced: 0, reference: false, legacy: false };
    let trackedInput = 0, trackedOutput = 0, trackedRequests = 0;
    for (const bucket of Object.values(stats.cost_buckets || {})) {
        trackedInput += tokens(bucket.prompt_tokens);
        trackedOutput += tokens(bucket.completion_tokens);
        trackedRequests += tokens(bucket.requests);
        const estimate = estimateBucket(bucket, catalog);
        if (estimate.usd === null) summary.unpriced += tokens(bucket.requests);
        else {
            summary.usd += estimate.usd;
            summary.priced += tokens(bucket.requests);
            summary.reference ||= estimate.reference;
        }
    }
    const legacy = {
        model, category,
        prompt_tokens: Math.max(0, tokens(stats.prompt_tokens) - trackedInput),
        completion_tokens: Math.max(0, tokens(stats.completion_tokens) - trackedOutput),
        requests: Math.max(0, tokens(stats.requests) - trackedRequests),
    };
    if (legacy.requests || legacy.prompt_tokens || legacy.completion_tokens) {
        summary.legacy = true;
        const estimate = estimateBucket(legacy, catalog);
        if (estimate.usd === null) summary.unpriced += legacy.requests || 1;
        else {
            summary.usd += estimate.usd;
            summary.priced += legacy.requests || 1;
            summary.reference = true;
        }
    }
    return summary;
}

export function formatUsd(value) {
    if (value === null || !Number.isFinite(value)) return '未计价';
    if (value === 0) return '$0.0000';
    if (value < 0.0001) return '<$0.0001';
    return '$' + value.toFixed(value < 1 ? 4 : 2);
}

export function formatCostSummary(summary, compact = false) {
    if (!summary.priced && summary.unpriced) return compact ? 'USD 未计价' : `未计价 ${summary.unpriced} 次`;
    return formatUsd(summary.usd) + (summary.unpriced ? (compact ? '+' : ` + ${summary.unpriced} 次未计价`) : '');
}
