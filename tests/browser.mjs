import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { providerData, legacySettings } from './fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = '/scripts/extensions/third-party/SillyTavern-OmniTracker/';
const outputPath = new URL('../test-results/', import.meta.url);
await mkdir(outputPath, { recursive: true });

const server = createServer(async (req, res) => {
    const send = (type, body) => { res.setHeader('Content-Type', type); res.end(body); };
    try {
        if (req.url === '/') {
            // Mirror the host's narrow menu_button and adversarial theme overrides.
            send('text/html; charset=utf-8', `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
                <title>OmniTracker integration fixture</title>
                <style>body{margin:0;background:#171b1f;color:#d1d5db;font:14px Arial}
                #extensions_settings{margin:24px 16px;width:calc(100% - 32px);max-width:840px}
                .inline-drawer-header{padding:12px;background:#252936}.inline-drawer-content{display:block}
                .menu_button{display:flex;flex-direction:column;width:min-content;word-break:break-all;background:#22252a;color:#ddd;border:1px solid #333;border-radius:5px}
                button{font:inherit}i{display:inline-block;width:14px}button{cursor:pointer}</style>
                <link rel="stylesheet" href="${extensionPath}style.css">
                <script src="/jquery.js"></script>
                <script>window.__listeners={};setTimeout(()=>{const el=document.createElement('div');el.id='extensions_settings';document.body.append(el)},350)</script>
                <script type="module" src="${extensionPath}index.js"></script>`);
        } else if (req.url === '/jquery.js') {
            send('text/javascript', await readFile(new URL('../node_modules/jquery/dist/jquery.min.js', import.meta.url)));
        } else if (req.url === '/script.js') {
            send('text/javascript', `export const event_types={GENERATION_STARTED:'start',GENERATION_STOPPED:'stop',MESSAGE_RECEIVED:'received',APP_READY:'ready'};
                export const eventSource={on:(event,fn)=>{window.__listeners[event]=fn}};
                export function saveSettingsDebounced(){localStorage.setItem('omni-test-settings',JSON.stringify(window.__testSettings))}`);
        } else if (req.url === '/scripts/extensions.js') {
            send('text/javascript', `export const extension_settings=JSON.parse(localStorage.getItem('omni-test-settings')||'{}');window.__testSettings=extension_settings;`);
        } else if (req.url?.startsWith(extensionPath)) {
            const file = req.url.slice(extensionPath.length);
            if (!['index.js', 'pricing.js', 'style.css'].includes(file)) { res.writeHead(404).end(); return; }
            send(file.endsWith('.css') ? 'text/css' : 'text/javascript', await readFile(root + file));
        } else if (req.url === '/api/backends/chat-completions/generate') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const body = JSON.parse(raw);
            if (body.stream) {
                const frames = body.fixtureAnthropic ? [
                    { type: 'message_start', message: { model: body.model, usage: { input_tokens: 600, cache_read_input_tokens: 300, cache_creation_input_tokens: 100, output_tokens: 0 } } },
                    { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } },
                    { type: 'message_delta', usage: { output_tokens: 200 } },
                ] : [
                    { model: body.model, choices: [{ delta: { content: '你好' } }] },
                    { usage: body.fixtureUsage || { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } } },
                ];
                // Final usage has no trailing newline, a regression case for the original reader.
                const sse = frames.map(frame => `data: ${JSON.stringify(frame)}`).join('\n\n');
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write(sse.slice(0, 23));
                res.end(sse.slice(23));
            } else {
                send('application/json', JSON.stringify({ model: body.model,
                    choices: [{ message: { content: 'Fixture response' } }],
                    usage: body.fixtureUsage || { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } },
                }));
            }
        } else { res.writeHead(404).end(); }
    } catch (error) { res.writeHead(500).end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.OMNI_BROWSER_CHANNEL || 'chrome', headless: true });
let checks = 0;
const check = label => { checks++; console.log(`PASS ${label}`); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    let priceRequests = 0;
    let failPrices = false;
    await context.route('https://models.dev/api.json**', async route => {
        priceRequests++;
        if (failPrices) return route.abort();
        await route.fulfill({ json: providerData, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await context.addInitScript(seed => {
        if (!localStorage.getItem('omni-test-settings')) localStorage.setItem('omni-test-settings', JSON.stringify({ 'st-omni-api-tracker': seed }));
    }, legacySettings());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const floating = page.locator('#omni_tracker_topbar_btn');
    const drawerButton = page.locator('#omni_open_dashboard_from_settings');
    await drawerButton.waitFor();
    assert.ok(await floating.isVisible());
    assert.equal(await page.locator('#top-bar, #chat_header').count(), 0);
    check('floating indicator and delayed settings drawer mount without a top bar');

    const layout = await drawerButton.evaluate(button => ({ width: button.offsetWidth, height: button.offsetHeight, direction: getComputedStyle(button).flexDirection }));
    assert.equal(layout.direction, 'row');
    assert.ok(layout.width > 140 && layout.height < 60, JSON.stringify(layout));
    check('screenshot button stays horizontal despite host menu_button constraints');
    await page.screenshot({ path: fileURLToPath(new URL('settings-desktop.png', outputPath)) });

    await floating.click();
    await page.locator('#omni_tracker_modal').waitFor({ state: 'visible' });
    assert.match(await page.locator('.omni-model-cost').innerText(), /\$0\.0200/);
    await page.locator('[data-tab="logs"]').click();
    assert.equal(await page.locator('.omni-tab-btn.active').getAttribute('data-tab'), 'logs');
    assert.match(await page.locator('.omni-log-table tbody').innerText(), /\$0\.0200/);
    check('legacy model overview and log rows show estimated USD');
    await page.locator('#omni_close_modal_btn').click();

    const start = await floating.boundingBox();
    await page.mouse.move(start.x + 20, start.y + 12);
    await page.mouse.down();
    await page.mouse.move(150, 210, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.locator('#omni_tracker_modal').isVisible(), false);
    const dragged = await floating.boundingBox();
    assert.ok(Math.abs(dragged.x - start.x) > 20);
    await page.reload();
    await floating.waitFor();
    const restored = await floating.boundingBox();
    assert.ok(Math.abs(restored.x - dragged.x) < 2 && Math.abs(restored.y - dragged.y) < 2);
    check('dragging does not open the panel; saved position survives reload');
    assert.equal(priceRequests, 1);
    check('fresh price cache prevents repeat network requests');

    const call = async body => {
        const before = await page.evaluate(() => window.__testSettings['st-omni-api-tracker'].totals.requests);
        const response = await page.evaluate(async body => {
            const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify(body) });
            return response.text();
        }, { type: 'normal', model: 'gpt-4o', chat_completion_source: 'openai', ...body });
        await page.waitForFunction(before => window.__testSettings['st-omni-api-tracker'].totals.requests === before + 1, before);
        return { response, log: await page.evaluate(() => window.__testSettings['st-omni-api-tracker'].recentLogs[0]) };
    };
    let result = await call({});
    assert.match(result.response, /Fixture response/);
    assert.equal(result.log.pricing.cached_tokens, 400);
    assert.equal(result.log.pricing.price.provider, 'openai');
    const { estimateBucket } = await import('../pricing.js');
    near(estimateBucket(result.log.pricing).usd, 0.004);
    check('non-stream usage and cache-read costs are captured without changing the response');

    result = await call({ stream: true });
    assert.match(result.response, /你好/);
    assert.equal(result.log.prompt_tokens, 1000);
    assert.equal(result.log.completion_tokens, 200);
    near(estimateBucket(result.log.pricing).usd, 0.004);
    check('SSE usage with fragmented chunks and no final newline is accounted once');

    result = await call({ model: 'claude-test', chat_completion_source: 'claude', stream: true, fixtureAnthropic: true });
    assert.equal(result.log.prompt_tokens, 1000);
    assert.equal(result.log.completion_tokens, 200);
    near(estimateBucket(result.log.pricing).usd, (600 * 3 + 300 * 0.3 + 100 * 3.75 + 200 * 15) / 1e6);
    check('Anthropic split input/output and cache counts are combined correctly');

    result = await call({ model: 'gemini-test', chat_completion_source: 'makersuite', fixtureUsage: { promptTokenCount: 250000, candidatesTokenCount: 200, thoughtsTokenCount: 100, cachedContentTokenCount: 50000 } });
    assert.equal(result.log.completion_tokens, 300);
    near(estimateBucket(result.log.pricing).usd, (200000 * 2 + 50000 * 0.2 + 300 * 8) / 1e6);
    check('Gemini reasoning, cache usage and long-context tier use the right rate');

    result = await call({ model: 'gpt-4o', chat_completion_source: 'openai', fixtureUsage: { prompt_tokens: 0, completion_tokens: 0 } });
    assert.equal(result.log.prompt_tokens, 0);
    assert.equal(result.log.completion_tokens, 0);
    result = await call({ model: '<img src=x onerror="window.fixtureXss=1">', chat_completion_source: 'custom' });
    assert.equal(estimateBucket(result.log.pricing).usd, null);
    check('official zero usage is respected and unknown models stay unpriced');

    await floating.click();
    await page.locator('[data-tab="models"]').click();
    assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
    assert.equal(await page.locator('#omni_tab_content img').count(), 0);
    assert.match(await page.locator('#omni_tracker_topbar_text').innerText(), /\$.*\+/);
    await page.screenshot({ path: fileURLToPath(new URL('models-desktop.png', outputPath)) });
    await page.locator('[data-tab="logs"]').click();
    assert.equal(await page.locator('.omni-tab-btn.active').getAttribute('data-tab'), 'logs');
    assert.match(await page.locator('.omni-log-table tbody').innerText(), /未计价/);
    await page.screenshot({ path: fileURLToPath(new URL('logs-desktop.png', outputPath)) });
    check('model names render safely and partial USD totals disclose unpriced calls');

    await page.locator('[data-tab="settings"]').click();
    failPrices = true;
    await page.locator('#omni_btn_refresh_prices').click();
    await page.getByText(/更新失败，沿用缓存/).waitFor();
    check('manual price refresh failures retain usable cached prices');
    const floatingSwitch = page.locator('.omni-switch').filter({ has: page.locator('#omni_modal_toggle_topbar') });
    await floatingSwitch.click();
    assert.equal(await page.locator('#omni_modal_toggle_topbar').isChecked(), false);
    assert.equal(await floating.count(), 0);
    await floatingSwitch.click();
    assert.equal(await page.locator('#omni_modal_toggle_topbar').isChecked(), true);
    assert.ok(await floating.isVisible());
    await page.locator('#omni_btn_reset_position').click();
    await page.locator('#omni_close_modal_btn').click();
    await floating.focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('#omni_tracker_modal').isVisible());
    check('show/hide controls, reset position and keyboard opening work');
    await page.locator('#omni_close_modal_btn').click();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForFunction(() => {
        const rect = document.getElementById('omni_tracker_topbar_btn').getBoundingClientRect();
        return rect.x >= 0 && rect.right <= innerWidth;
    });
    const mobilePosition = await floating.boundingBox();
    assert.ok(mobilePosition.x >= 0 && mobilePosition.x + mobilePosition.width <= 320);
    await drawerButton.waitFor();
    const mobileLayout = await drawerButton.boundingBox();
    assert.ok(mobileLayout.height < 60 && mobileLayout.x + mobileLayout.width <= 320);
    await page.screenshot({ path: fileURLToPath(new URL('settings-mobile.png', outputPath)) });
    await floating.click();
    await page.locator('[data-tab="models"]').click();
    await page.screenshot({ path: fileURLToPath(new URL('models-mobile.png', outputPath)) });
    await page.locator('#omni_tab_content').evaluate(panel => { panel.scrollTop = 600; });
    await page.screenshot({ path: fileURLToPath(new URL('model-details-mobile.png', outputPath)) });
    check('320px viewport keeps floating control and drawer buttons within the screen');
    assert.deepEqual(errors, []);
    check('no uncaught JavaScript errors during integration scenarios');
    await context.close();

    const offline = await browser.newContext();
    await offline.route('https://models.dev/api.json**', route => route.abort());
    const offlinePage = await offline.newPage();
    await offlinePage.goto(origin);
    await offlinePage.locator('#omni_tracker_topbar_btn').click();
    await offlinePage.getByText(/价格暂不可用/).waitFor();
    assert.ok(await offlinePage.locator('#omni_tracker_modal').isVisible());
    check('first-run offline pricing does not prevent loading or opening the extension');
    await offline.close();

    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await touchContext.route('https://models.dev/api.json**', route => route.fulfill({ json: providerData }));
    const touchPage = await touchContext.newPage();
    await touchPage.goto(origin);
    const touchButton = touchPage.locator('#omni_tracker_topbar_btn');
    await touchButton.waitFor();
    const touchStart = await touchButton.boundingBox();
    const cdp = await touchContext.newCDPSession(touchPage);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStart.x + 20, y: touchStart.y + 15 }] });
    for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchStart.x + 20 - step * 8, y: touchStart.y + 15 + step * 12 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await touchPage.locator('#omni_tracker_modal').count(), 0);
    const touchEnd = await touchButton.boundingBox();
    assert.ok(touchEnd.y > touchStart.y + 50);
    await touchPage.touchscreen.tap(touchEnd.x + 20, touchEnd.y + 15);
    await touchPage.locator('#omni_tracker_modal').waitFor({ state: 'visible', timeout: 3000 });
    check('real emulated touch drag moves the indicator; a subsequent tap opens the panel');

    await touchPage.locator('[data-tab="settings"]').click();
    const backup = legacySettings();
    backup.showInTopBar = false;
    backup.activeTime = { daily: { '2026-10-20': 3600000 }, totalMs: 0 };
    await touchPage.locator('#omni_file_input').setInputFiles({ name: 'legacy-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await touchPage.waitForFunction(() => window.__testSettings['st-omni-api-tracker'].activeTime.totalMs === 3600000);
    assert.equal(await touchButton.count(), 0);
    const imported = await touchPage.evaluate(() => window.__testSettings['st-omni-api-tracker']);
    assert.equal(imported.byModel['gpt-4o'].total_tokens, 5000);
    assert.equal(imported.activeTime.totalMs, 3600000);
    check('legacy backup import preserves tokens, restores visibility and recomputes active time');

    await touchPage.locator('#omni_btn_reset_today').click();
    await touchPage.locator('.omni-switch').filter({ has: touchPage.locator('#omni_modal_toggle_topbar') }).click();
    assert.match(await touchPage.locator('#omni_tracker_topbar_text').innerText(), /0 \| \$0\.0000/);
    check('resetting today resets its fee estimate together with token usage');

    const cleaningBackup = legacySettings();
    const inflated = { prompt_tokens: 200000, completion_tokens: 1000, total_tokens: 201000, requests: 2 };
    const embedding = { prompt_tokens: 20000, completion_tokens: 0, total_tokens: 20000, requests: 1 };
    cleaningBackup.byModel = {
        'gpt-4o': { ...inflated, byCategory: { chat: { ...inflated } } },
        'text-embedding-3-small': { ...embedding, byCategory: { vectors: { ...embedding } } },
    };
    cleaningBackup.totals = { prompt_tokens: 220000, completion_tokens: 1000, total_tokens: 221000, requests: 3 };
    cleaningBackup.today = { ...cleaningBackup.totals, date: new Date().toISOString().slice(0, 10) };
    cleaningBackup.recentLogs.push({ ...embedding, category: 'vectors', model: 'text-embedding-3-small' });
    await touchPage.locator('#omni_file_input').setInputFiles({ name: 'cleanup-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(cleaningBackup)) });
    await touchPage.waitForFunction(() => window.__testSettings['st-omni-api-tracker'].totals.total_tokens === 221000);
    touchPage.once('dialog', dialog => dialog.accept());
    await touchPage.locator('#omni_btn_clean_water').click();
    const cleaned = await touchPage.evaluate(() => window.__testSettings['st-omni-api-tracker']);
    assert.equal(cleaned.byModel['gpt-4o'].prompt_tokens, 25000);
    assert.equal(cleaned.byModel['text-embedding-3-small'].prompt_tokens, 20000);
    assert.equal(cleaned.byCategory.vectors.total_tokens, 20000);
    assert.equal(cleaned.recentLogs.some(log => log.category === 'vectors'), true);
    check('historical cleanup still works and preserves legitimate input-only embedding calls');
    await touchContext.close();
    console.log(`Browser integration: ${checks} checks passed. Screenshots: test-results/`);
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
