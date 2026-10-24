import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, inferProvider, findPrice, ratesForContext, makeCostBucket, addCostBucket,
    estimateBucket, summarizeCost, formatUsd, formatCostSummary } from '../pricing.js';
import { providerData } from './fixtures.mjs';

const catalog = buildCatalog(providerData);
const request = (overrides = {}) => ({ model: 'gpt-4o', provider: 'openai', category: 'chat', prompt_tokens: 1000000, completion_tokens: 100000, ...overrides });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('matches exact model and provider; unknown relays use canonical reference, never fuzzy prices', () => {
    assert.equal(findPrice(catalog, 'gpt-4o', 'openai').cost.input, 2.5);
    assert.equal(findPrice(catalog, 'openai/gpt-4o', 'openrouter').cost.input, 3);
    assert.equal(findPrice(catalog, 'gpt-4o').provider, 'openai');
    assert.equal(findPrice(catalog, 'gpt-4o').reference, true);
    assert.equal(findPrice(catalog, 'models/gemini-test', 'google').cost.input, 1);
    assert.equal(findPrice(catalog, 'gpt-4o-custom'), null);
    assert.equal(findPrice(catalog, 'ambiguous-model'), null);
    assert.equal(findPrice(catalog, 'gpt-4o', 'ollama'), null);
});

test('provider detection respects explicit endpoints and SillyTavern source aliases', () => {
    assert.equal(inferProvider({ chat_completion_source: 'claude' }, '', catalog), 'anthropic');
    assert.equal(inferProvider({ chat_completion_source: 'makersuite' }, '', catalog), 'google');
    assert.equal(inferProvider({ chat_completion_source: 'openai', reverse_proxy: 'https://relay.example/v1' }, '', catalog), '');
    assert.equal(inferProvider({ custom_url: 'https://openrouter.ai/api/v1' }, '', catalog), 'openrouter');
    assert.equal(inferProvider({}, 'https://api.openai.com/v1/chat/completions', catalog), 'openai');
});

test('calculates USD per million tokens and separates input/output', () => {
    const cost = estimateBucket(makeCostBucket(request(), catalog), catalog);
    near(cost.inputUsd, 2.5);
    near(cost.outputUsd, 1);
    near(cost.usd, 3.5);
});

test('accounts for cache reads and writes without double charging input', () => {
    const cost = estimateBucket(makeCostBucket(request({ model: 'claude-test', provider: 'anthropic', cached_tokens: 400000, cache_write_tokens: 200000 }), catalog), catalog);
    near(cost.usd, 400000 * 3 / 1e6 + 400000 * 0.3 / 1e6 + 200000 * 3.75 / 1e6 + 100000 * 15 / 1e6);
});

test('long-context rates are selected per request and retained across catalog refreshes', () => {
    const short = makeCostBucket(request({ model: 'gemini-test', provider: 'google', prompt_tokens: 100000 }), catalog);
    const long = makeCostBucket(request({ model: 'gemini-test', provider: 'google', prompt_tokens: 250000 }), catalog);
    assert.equal(short.price.rates.input, 1);
    assert.equal(long.price.rates.input, 2);
    const stats = { prompt_tokens: 350000, completion_tokens: 200000, requests: 2 };
    addCostBucket(stats, short);
    addCostBucket(stats, long);
    near(summarizeCost(stats, null).usd, 0.1 + 0.4 + 0.5 + 0.8);
    assert.equal(Object.keys(stats.cost_buckets).length, 2);
    assert.equal(ratesForContext({ input: 1, context_over_200k: { input: 2 } }, 200001).input, 2);
});

test('unknown, missing and non-token prices remain unpriced, while genuine zero rates stay zero', () => {
    for (const overrides of [{ model: 'unknown' }, { model: 'no-price' }, { category: 'tts' }, { model: 'tts-1' }]) {
        assert.equal(estimateBucket(makeCostBucket(request(overrides), catalog), catalog).usd, null);
    }
    assert.equal(estimateBucket(makeCostBucket(request({ model: 'gpt-free' }), catalog), catalog).usd, 0);
    assert.equal(formatUsd(0), '$0.0000');
    assert.equal(formatUsd(null), '未计价');
    assert.equal(formatUsd(0.000001), '<$0.0001');
});

test('embedding input-only calls are priced', () => {
    const bucket = makeCostBucket(request({ model: 'text-embedding-3-small', category: 'vectors', completion_tokens: 0 }), catalog);
    near(estimateBucket(bucket, catalog).usd, 0.02);
});

test('legacy data is re-estimated without modifying or double counting existing tokens', () => {
    const stats = { prompt_tokens: 1000000, completion_tokens: 100000, requests: 2 };
    const original = structuredClone(stats);
    near(summarizeCost(stats, catalog, 'gpt-4o').usd, 3.5);
    assert.deepEqual(stats, original);
    const newCall = request();
    stats.prompt_tokens += newCall.prompt_tokens;
    stats.completion_tokens += newCall.completion_tokens;
    stats.requests++;
    addCostBucket(stats, makeCostBucket(newCall, catalog));
    const summary = summarizeCost(stats, catalog, 'gpt-4o');
    near(summary.usd, 7);
    assert.equal(summary.priced, 3);
    assert.equal(summary.legacy, true);
});

test('partial totals disclose unpriced requests; catalogs can resolve initially missing rates', () => {
    const stats = { prompt_tokens: 2000000, completion_tokens: 200000, requests: 2 };
    addCostBucket(stats, makeCostBucket(request(), catalog));
    addCostBucket(stats, makeCostBucket(request({ model: 'missing' }), catalog));
    const summary = summarizeCost(stats, catalog);
    near(summary.usd, 3.5);
    assert.equal(summary.unpriced, 1);
    assert.match(formatCostSummary(summary), /1 次未计价/);
    const pending = makeCostBucket(request(), null);
    assert.equal(pending.price, null);
    near(estimateBucket(pending, catalog).usd, 3.5);
});
