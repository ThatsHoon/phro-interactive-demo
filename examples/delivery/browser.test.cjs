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
    await page.keyboard.press('d'); // a control's own key: ends autoplay, keeps state
    assert.equal(await demo(page, () => demo.scenario), null, 'manual control ends autoplay');
    assert.equal(await demo(page, () => demo.state.ridersAvailable), false);
    await page.click('#presentation');
    await page.keyboard.press('r');

    // ---- domain checks: 데모배달 core interactions ----------------------------
    const state = (key) => demo(page, (k) => demo.state[k], key);
    const nextUntil = async (pred, label) => {
      for (let i = 0; i < 10 && !(await demo(page, pred)); i += 1) await page.click('#next');
      assert.ok(await demo(page, pred), 'Next must reach: ' + label);
    };
    const riderAt = () => page.getAttribute('[data-bind="rider"]', 'transform');

    // Order once; a second tap from the menu creates nothing.
    await page.click('[data-action="place-order"]');
    assert.equal(await state('order'), 'placed');
    assert.equal(await state('view'), 'track');
    await page.click('[data-action="menu"]');
    await page.click('[data-action="place-order"]');
    assert.match(await page.textContent('#toast'), /이미 진행 중인 주문/);
    assert.equal(await state('orderId'), 'ORD-0001');
    assert.equal(await demo(page, () => demo.serial), 1, 'one order id issued');
    await page.click('[data-action="track"]');

    // Real clock drives the store's auto-accept (2 story minutes = 2 s).
    await page.waitForTimeout(2300);
    assert.equal(await state('order'), 'accepted');
    await shot(page, 'accepted');

    // Cancel before cooking -> refund.
    await page.click('[data-action="cancel-order"]');
    assert.equal(await state('order'), 'cancelled');
    assert.equal((await state('refund')).amount, 21000);
    await shot(page, 'cancelled-refund');

    // New order via console key; cancel during cooking is refused on screen.
    await page.keyboard.press('o');
    assert.equal(await state('orderId'), 'ORD-0002');
    await page.click('#pause');
    await nextUntil(() => demo.state.order === 'cooking', 'cooking');
    await page.click('[data-action="cancel-order"]');
    assert.equal(await state('order'), 'cooking');
    assert.ok(await page.isVisible('.flash'), 'refusal message visible');
    assert.match(await page.textContent('.flash'), /조리가 시작되어/);
    await shot(page, 'cancel-refused');

    // To delivery; address change waits for the rider, then reroutes.
    await nextUntil(() => demo.state.order === 'delivering', 'delivering');
    await page.click('#pause');
    await page.click('[data-action="request-address"]');
    assert.equal((await state('addressChange')).status, 'pending');
    assert.equal(await state('address'), 'home', 'no change before rider approval');
    await page.waitForTimeout(600);
    await page.keyboard.press('y');
    assert.equal(await state('address'), 'office');
    const a = await riderAt();
    await page.waitForTimeout(700);
    assert.notEqual(await riderAt(), a, 'rider marker moves on the map');
    await shot(page, 'address-approved');

    // Rider link lost: marker frozen at last position; restored: jumps to live position.
    await page.keyboard.press('l');
    assert.equal(await state('riderLink'), 'lost');
    const lastFix = await riderAt();
    await page.waitForTimeout(900);
    assert.equal(await riderAt(), lastFix, 'last known position stays');
    assert.match(await page.textContent('.map-warn'), /통신이 끊겼어요/);
    await shot(page, 'rider-lost');
    await page.keyboard.press('l');
    assert.notEqual(await riderAt(), lastFix, 'position refreshed on reconnect');

    // Pause freezes the rider on the map too.
    await page.click('#pause');
    const paused = await riderAt();
    await page.waitForTimeout(500);
    assert.equal(await riderAt(), paused, 'pause freezes the map');
    await nextUntil(() => demo.state.review === 'requested', 'review request');
    await page.click('#pause');
    await page.click('[data-action="rate"][data-rating="5"]');
    assert.equal(await state('review'), 'done');
    assert.equal(await state('rating'), 5);
    await shot(page, 'review-done');
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
