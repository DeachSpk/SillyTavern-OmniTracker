// Synthetic deterministic prices; tests never depend on current market prices.
export const providerData = {
    openai: { models: {
        'gpt-4o': { cost: { input: 2.5, output: 10, cache_read: 1.25 } },
        'gpt-free': { cost: { input: 0, output: 0 } },
        'text-embedding-3-small': { type: 'embedding', cost: { input: 0.02, output: 0 } },
        'tts-1': { type: 'speech', cost: { input: 15, output: 0 } },
        'no-price': {},
    } },
    anthropic: { models: {
        'claude-test': { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } },
    } },
    google: { models: {
        'gemini-test': { cost: { input: 1, output: 4, cache_read: 0.1,
            tiers: [{ tier: { type: 'context', size: 200000 }, input: 2, output: 8, cache_read: 0.2 }] } },
    } },
    openrouter: { api: 'https://openrouter.ai/api/v1', models: {
        'openai/gpt-4o': { cost: { input: 3, output: 11 } },
    } },
    resellerA: { models: { 'ambiguous-model': { cost: { input: 1, output: 2 } } } },
    resellerB: { models: { 'ambiguous-model': { cost: { input: 5, output: 9 } } } },
};

export function legacySettings() {
    const stats = { prompt_tokens: 4000, completion_tokens: 1000, total_tokens: 5000, requests: 2 };
    return {
        enabled: true, showInTopBar: true,
        totals: { ...stats }, today: { ...stats, date: new Date().toISOString().slice(0, 10) },
        session: { ...stats, startTime: Date.now() },
        byCategory: { chat: { ...stats } },
        byModel: { 'gpt-4o': { ...stats, byCategory: { chat: { ...stats } } } },
        recentLogs: [{ ...stats, id: 'legacy', time: '12:00:00', model: 'gpt-4o', category: 'chat', caller: '主聊对话', duration_ms: 250 }],
        activeTime: { totalMs: 60000, daily: { [new Date().toISOString().slice(0, 10)]: 60000 } },
    };
}
