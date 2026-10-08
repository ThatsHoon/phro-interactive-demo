// test.cjs — rule tests. Node built-ins only: `node test.cjs`.
// One test per transition, exception, invariant and scenario in the rules spec.
'use strict';
const assert = require('node:assert/strict');
const Demo = require('./domain.js');
const { TIMING } = Demo;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name);
    console.error(error);
    process.exitCode = 1;
  }
}
const fresh = () => new Demo();

test('releasing before the hold time sends nothing', () => {
  const sim = fresh();
  sim.beginHold();
  sim.tick(TIMING.hold.ms - 1);
  sim.releaseHold();
  sim.tick(10000);
  assert.equal(sim.state.request, 'idle');
  assert.equal(sim.state.attempts, 0);
});

test('exact hold opens the cancel window; window expiry sends once', () => {
  const sim = fresh();
  sim.beginHold();
  sim.tick(TIMING.hold.ms);
  assert.equal(sim.state.request, 'cancel_window');
  sim.tick(TIMING.cancelWindow.ms - 1);
  assert.equal(sim.state.request, 'cancel_window');
  sim.tick(1);
  assert.equal(sim.state.request, 'sending');
  assert.equal(sim.state.attempts, 1);
});

test('cancel inside the window never sends', () => {
  const sim = fresh();
  sim.beginHold();
  sim.tick(TIMING.hold.ms + 1000);
  sim.cancel();
  sim.tick(20000);
  assert.equal(sim.state.attempts, 0);
  assert.equal(sim.state.requestId, null);
});

test('offline request keeps one id and sends on recovery', () => {
  const sim = fresh();
  sim.setNetwork(false);
  sim.commit();
  const id = sim.state.requestId;
  sim.tick(5000);
  assert.equal(sim.state.request, 'queued');
  sim.setNetwork(true);
  sim.tick(TIMING.reconnect.ms);
  assert.equal(sim.state.request, 'sending');
  sim.tick(TIMING.response.ms);
  assert.equal(sim.state.request, 'accepted');
  assert.equal(sim.state.requestId, id);
  assert.equal(sim.state.attempts, 1);
});

test('losing the connection while sending re-queues the same request', () => {
  const sim = fresh();
  sim.commit();
  const id = sim.state.requestId;
  sim.setNetwork(false);
  sim.tick(5000);
  assert.equal(sim.state.request, 'queued');
  sim.setNetwork(true);
  sim.tick(10000);
  assert.equal(sim.state.request, 'accepted');
  assert.equal(sim.state.requestId, id);
});

test('repeated commits never create a second entity', () => {
  const sim = fresh();
  sim.commit();
  sim.commit();
  sim.commit();
  assert.equal(sim.state.requestId, 'REQ-0001');
  assert.equal(sim.state.attempts, 1);
});

test('accepted requests cannot be cancelled by the user', () => {
  const sim = fresh();
  sim.commit();
  sim.tick(TIMING.response.ms);
  assert.equal(sim.cancel(), false);
  assert.equal(sim.state.request, 'accepted');
});

test('manual counterpart: no auto response until respond()', () => {
  const sim = fresh();
  sim.setAutoRespond(false);
  sim.commit();
  sim.tick(20000);
  assert.equal(sim.state.request, 'sending');
  assert.equal(sim.respond(), true);
  assert.equal(sim.state.request, 'accepted');
});

test('pause freezes every clock; advance skips while staying paused', () => {
  const sim = fresh();
  sim.beginHold();
  sim.tick(500);
  sim.togglePause();
  const time = sim.time;
  const hold = sim.state.holdMs;
  sim.tick(10000);
  assert.equal(sim.time, time);
  assert.equal(sim.state.holdMs, hold);
  sim.state.request = 'idle'; // advance with no scenario jumps to the next job
  sim.commit();
  sim.advance();
  assert.equal(sim.paused, true);
  assert.equal(sim.state.request, 'accepted');
});

test('reset restarts ids so every run shows the same numbers', () => {
  const sim = fresh();
  sim.commit();
  sim.reset();
  sim.commit();
  assert.equal(sim.state.requestId, 'REQ-0001');
});

for (const key of Object.keys(fresh().scenarios())) {
  test('scenario ' + key + ' completes, can pause and step', () => {
    const sim = fresh();
    sim.runScenario(key);
    sim.tick(300);
    sim.togglePause();
    sim.advance();
    assert.equal(sim.paused, true);
    sim.togglePause();
    sim.tick(120000);
    assert.equal(sim.scenario.done, true);
    if (key === 'A') assert.equal(sim.state.request, 'completed');
    if (key === 'B') assert.equal(sim.state.request, 'accepted');
    assert.ok(sim.state.attempts <= 1, 'scenario must not resend');
  });
}

console.log(passed + ' tests passed');
