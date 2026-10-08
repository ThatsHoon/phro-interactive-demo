// browser.test.cjs — real-browser verification and screenshots: `node browser.test.cjs`
// Needs Playwright resolvable from this folder or a parent (`npm i -D playwright`).
// Uses the bundled Chromium if installed, otherwise an installed Edge or Chrome.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { start } = require('./server.cjs');

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch { /* try next */ }
  }
  console.error('Playwright not found. Run: npm i -D playwright   (or verify with browser tools instead)');
  process.exit(2);
}

async function launch(chromium) {
  const attempts = [{}, { channel: 'msedge' }, { channel: 'chrome' }];
  for (const options of attempts) {
    try { return await chromium.launch({ headless: true, ...options }); } catch { /* try next */ }
  }
  throw new Error('No Chromium, Edge or Chrome available for Playwright');
}

const SHOTS = path.join(__dirname, 'screenshots');

(async () => {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await launch(chromium);
  const problems = [];
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console: ' + m.text()); });
    page.on('request', (r) => { if (!/^(http:\/\/127\.0\.0\.1|file:|data:|blob:)/.test(r.url())) problems.push('external request: ' + r.url()); });
    page.on('requestfailed', (r) => problems.push('failed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ': ' + r.url()); });
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const demo = (page, fn, arg) => page.evaluate(fn, arg);

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    watch(page);
    await page.goto(base);
    await page.waitForTimeout(300);
    await shot(page, 'desktop');

    // Every image loaded.
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
    assert.deepEqual(broken, [], 'broken images');

    // Pause freezes the clock.
    const keys = await demo(page, () => Object.keys(demo.scenarios()));
    await page.click(`[data-scenario="${keys[0]}"]`);
    await page.waitForTimeout(200);
    await page.click('#pause');
    const frozen = await demo(page, () => demo.time);
    await page.waitForTimeout(400);
    assert.equal(await demo(page, () => demo.time), frozen, 'pause must freeze time');

    // Every scenario: step through with the real "Next" button while paused, screenshot each step.
    for (const key of keys) {
      await page.click(`[data-scenario="${key}"]`);
      if (!(await demo(page, () => demo.paused))) await page.click('#pause');
      const steps = await demo(page, (k) => demo.scenarios()[k].steps.length, key);
      for (let i = 0; i < steps; i += 1) {
        await page.waitForTimeout(80);
        await shot(page, `scenario-${key}-${i + 1}`);
        await page.click('#next');
      }
      assert.equal(await demo(page, () => demo.scenario && demo.scenario.done), true, 'scenario ' + key + ' must finish');
      assert.equal(await demo(page, () => demo.paused), true, 'next must keep pause');
      await page.click('#pause');
    }
    await page.click('[data-play="reset"]');

    // Keyboard shortcuts drive the demo in presentation mode (console hidden).
    await page.click('#presentation');
    await page.keyboard.press('1');
    await page.keyboard.press('p');
    assert.equal(await demo(page, () => demo.paused), true, 'P pauses');
    await page.keyboard.press('p');
    await page.keyboard.press('o'); // a control's own key: ends autoplay, keeps state
    assert.equal(await demo(page, () => demo.scenario), null, 'manual control ends autoplay');
    assert.equal(await demo(page, () => demo.state.link), 'offline');
    await page.click('#presentation');
    await page.keyboard.press('r');

    // ---- domain checks: 페이링 결제 승인 플로우를 실제 입력으로 ----
    const T = await demo(page, () => Demo.TIMING);
    const state = () => demo(page, () => demo.state);
    const toFingerprint = async () => {
      await page.click('[data-action="scan"]');
      await page.waitForTimeout(T.scan.ms + 300);
      assert.equal((await state()).view, 'confirm', 'QR scan leads to amount confirmation');
      await page.click('[data-action="pay"]');
      const box = await page.locator('[data-hold="finger"]').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    };
    await toFingerprint();
    await page.mouse.down();
    await page.waitForTimeout(T.hold.ms / 3);
    await page.mouse.up();
    assert.equal((await state()).pay, 'auth', 'early release must abort the fingerprint');
    await page.mouse.down();
    await page.waitForTimeout(T.hold.ms / 2);
    await shot(page, 'fingerprint-holding');
    await page.waitForTimeout(T.hold.ms / 2 + 250);
    await page.mouse.up();
    assert.equal((await state()).pay, 'cancel_window');
    await shot(page, 'cancel-window');
    await page.click('[data-action="cancel"]');
    let s = await state();
    assert.equal(s.pay, 'cancelled');
    assert.equal(s.txId, null, 'cancel inside the window creates no transaction');
    await page.waitForTimeout(T.cancelWindow.ms + 500);
    assert.equal((await state()).attempts, 0, 'cancel must not send');

    // Full payment in real time, with a double tap on the button that starts it.
    await page.click('[data-action="home"]');
    await toFingerprint();
    await page.mouse.down();
    await page.waitForTimeout(T.hold.ms + 250);
    await page.mouse.up();
    await page.waitForTimeout(T.cancelWindow.ms + T.uplink.ms + T.issuer.ms + T.downlink.ms + 600);
    s = await state();
    assert.equal(s.pay, 'approved');
    assert.equal(s.txId, 'TX-0001');
    assert.equal(s.charges, 1);
    assert.equal(await page.locator('[data-action="cancel"]').count(), 0, 'no cancel after approval');
    await shot(page, 'approved');
    await page.click('[data-action="refund"]');
    assert.equal((await state()).pay, 'refund_requested');
    assert.equal(await page.locator('[data-action="refund"]').count(), 0, 'refund button gone after the request');
    assert.equal((await state()).refundId, 'RF-0001');

    // Late result while '확인 중': push banner on the home screen, tapping it opens the result.
    await page.keyboard.press('r');
    await demo(page, () => {
      const T = Demo.TIMING;
      demo.setIssuerDelay(true);
      demo.startScan(); demo.tick(T.scan.ms);
      demo.toAuth(); demo.beginHold(); demo.tick(T.hold.ms + T.cancelWindow.ms + T.pendingLimit.ms);
      demo.goHome(); demo.releaseHeld(); demo.tick(T.downlink.ms);
    });
    await page.waitForTimeout(150);
    await shot(page, 'notification');
    await page.click('.push');
    s = await state();
    assert.equal(s.view, 'status');
    assert.equal(s.pay, 'approved');
    assert.equal(s.notice, null);
    // ---------------------------------------------------------------------------

    // Opens straight from disk, no server.
    const filePage = await browser.newPage();
    watch(filePage);
    await filePage.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    await filePage.waitForTimeout(200);
    assert.ok(await filePage.evaluate(() => typeof demo === 'object'), 'file:// load');

    // Small screens: no horizontal scroll.
    const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
    watch(mobile);
    await mobile.goto(base);
    await mobile.waitForTimeout(200);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, 'horizontal scroll on 375px: ' + overflow + 'px');
    await mobile.screenshot({ path: path.join(SHOTS, 'mobile.png'), fullPage: true });

    assert.deepEqual(problems, [], 'errors or external requests');
    console.log('Browser checks passed. Screenshots: ' + SHOTS);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
