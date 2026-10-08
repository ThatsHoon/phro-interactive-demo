// test.cjs — 규칙 테스트 (RULES.md의 전이·예외·불변 조건·시나리오). `node test.cjs`
'use strict';
const assert = require('node:assert/strict');
const Demo = require('./domain.js');
const { TIMING, MERCHANT, BALANCE } = Demo;

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
const ROUND = TIMING.uplink.ms + TIMING.issuer.ms + TIMING.downlink.ms;

// 홈 → 스캔 → 금액 확인 → 지문 1초 → 취소 가능 시간 시작
function toWindow(sim = new Demo()) {
  sim.startScan();
  sim.tick(TIMING.scan.ms);
  sim.toAuth();
  sim.beginHold();
  sim.tick(TIMING.hold.ms);
  return sim;
}
// 취소 가능 시간이 끝나 승인 요청이 나간 직후
function toRequest(sim) {
  sim = toWindow(sim);
  sim.tick(TIMING.cancelWindow.ms);
  return sim;
}

// ---- 시간 정책 ----
test('policy times are the real product values', () => {
  assert.equal(TIMING.hold.ms, 1000);
  assert.equal(TIMING.cancelWindow.ms, 3000);
  assert.equal(TIMING.pendingLimit.ms, 10000);
  for (const key of ['hold', 'cancelWindow', 'pendingLimit']) assert.equal(TIMING[key].kind, 'policy');
});

// ---- 전이 ----
test('QR scan recognises the merchant after the scan time', () => {
  const sim = new Demo();
  assert.equal(sim.startScan(), true);
  sim.tick(TIMING.scan.ms - 1);
  assert.equal(sim.state.pay, 'scanning');
  sim.tick(1);
  assert.equal(sim.state.pay, 'confirm');
  assert.equal(sim.state.view, 'confirm');
});

test('back from scan / confirm / auth abandons without sending', () => {
  for (const stage of ['scanning', 'confirm', 'auth']) {
    const sim = new Demo();
    sim.startScan();
    if (stage !== 'scanning') sim.tick(TIMING.scan.ms);
    if (stage === 'auth') sim.toAuth();
    assert.equal(sim.state.pay, stage);
    assert.equal(sim.abandon(), true);
    sim.tick(20000);
    assert.equal(sim.state.pay, 'idle');
    assert.equal(sim.state.txId, null);
  }
});

test('fingerprint released before 1 s sends nothing', () => {
  const sim = new Demo();
  sim.startScan();
  sim.tick(TIMING.scan.ms);
  sim.toAuth();
  sim.beginHold();
  sim.tick(TIMING.hold.ms - 50);
  assert.equal(typeof sim.releaseHold(), 'string');
  sim.tick(20000);
  assert.equal(sim.state.pay, 'auth');
  assert.equal(sim.state.attempts, 0);
  assert.deepEqual(sim.state.ledger, {});
});

test('exact 1 s hold opens the 3 s window; nothing sent until it ends', () => {
  const sim = toWindow();
  assert.equal(sim.state.pay, 'cancel_window');
  sim.tick(TIMING.cancelWindow.ms - 1);
  assert.equal(sim.state.pay, 'cancel_window');
  assert.equal(sim.state.txId, null);
  assert.equal(sim.state.attempts, 0);
  sim.tick(1);
  assert.equal(sim.state.pay, 'requesting');
  assert.equal(sim.state.txId, 'TX-0001');
  assert.equal(sim.state.attempts, 1);
});

test('cancel inside the window: no tx id, no request, no charge', () => {
  const sim = toWindow();
  sim.tick(1500);
  assert.equal(sim.cancel(), true);
  sim.tick(30000);
  assert.equal(sim.state.pay, 'cancelled');
  assert.equal(sim.state.txId, null);
  assert.equal(sim.state.attempts, 0);
  assert.equal(sim.state.charges, 0);
});

test('happy path: approved after the round trip, charged once', () => {
  const sim = toRequest();
  sim.tick(ROUND - 1);
  assert.equal(sim.state.pay, 'requesting');
  sim.tick(1);
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.state.result.approvalNo, '30820001');
  assert.equal(sim.state.charges, 1);
  assert.equal(sim.balance(), BALANCE.normal - MERCHANT.amount);
});

// ---- 예외: 네트워크 ----
test('connection lost before the server got it: retry with same id, charged once', () => {
  const sim = toRequest();
  sim.tick(TIMING.uplink.ms - 100);
  sim.setNetwork(false);
  sim.tick(3000);
  assert.deepEqual(sim.state.ledger, {}, 'request was lost on the way');
  assert.equal(sim.state.pay, 'requesting');
  sim.setNetwork(true);
  sim.tick(TIMING.reconnect.ms + ROUND);
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.state.txId, 'TX-0001');
  assert.equal(sim.state.attempts, 2);
  assert.equal(sim.state.ledger['TX-0001'].received, 1);
  assert.equal(sim.state.charges, 1);
});

test('response lost after approval: retry returns the stored result, no second charge', () => {
  const sim = toRequest();
  sim.tick(TIMING.uplink.ms + TIMING.issuer.ms + 100); // 카드사 승인됨, 응답은 오는 중
  assert.equal(sim.state.ledger['TX-0001'].status, 'approved');
  sim.setNetwork(false);
  sim.tick(3000);
  assert.equal(sim.state.pay, 'requesting', 'app never saw the result');
  sim.setNetwork(true);
  sim.tick(TIMING.reconnect.ms + TIMING.uplink.ms + TIMING.downlink.ms);
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.state.txId, 'TX-0001');
  assert.equal(sim.state.attempts, 2);
  assert.equal(sim.state.ledger['TX-0001'].received, 2);
  assert.equal(sim.state.charges, 1);
  assert.equal(sim.balance(), BALANCE.normal - MERCHANT.amount);
});

test('retry while the issuer is still deciding is not processed twice', () => {
  const sim = toRequest();
  sim.tick(TIMING.uplink.ms + 100); // 서버 수신, 카드사 처리 중
  sim.setNetwork(false);
  sim.setNetwork(true);
  sim.tick(TIMING.reconnect.ms + ROUND + 1000);
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.state.ledger['TX-0001'].received, 2);
  assert.equal(sim.state.charges, 1);
});

test('offline when the window ends: id created, sent on recovery with the same id', () => {
  const sim = toWindow();
  sim.setNetwork(false);
  sim.tick(TIMING.cancelWindow.ms + 2000);
  assert.equal(sim.state.pay, 'requesting');
  assert.equal(sim.state.txId, 'TX-0001');
  assert.equal(sim.state.attempts, 0);
  sim.setNetwork(true);
  sim.tick(TIMING.reconnect.ms + ROUND);
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.state.attempts, 1);
});

test('repeated commit / send never creates a second id or request', () => {
  const sim = toRequest();
  assert.equal(sim.commit(), false);
  assert.equal(sim.send(), false);
  sim.tick(ROUND);
  assert.equal(sim.state.txId, 'TX-0001');
  assert.equal(sim.state.attempts, 1);
  assert.equal(sim.state.charges, 1);
});

// ---- 예외: 지연 · 확인 중 ----
test('waiting 10 s switches to checking, exactly at the limit', () => {
  const sim = new Demo();
  sim.setIssuerDelay(true);
  toRequest(sim);
  sim.tick(TIMING.pendingLimit.ms - 1);
  assert.equal(sim.state.pay, 'requesting');
  sim.tick(1);
  assert.equal(sim.state.pay, 'checking');
});

test('checking: late result arrives as a notification, app can go home meanwhile', () => {
  const sim = new Demo();
  sim.setIssuerDelay(true);
  toRequest(sim);
  sim.tick(TIMING.pendingLimit.ms);
  assert.equal(sim.goHome(), true);
  assert.equal(typeof sim.startScan(), 'string', 'no new payment while checking');
  assert.equal(sim.releaseHeld(), true);
  sim.tick(TIMING.downlink.ms);
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.state.view, 'home');
  assert.equal(sim.state.notice.title, '결제 승인 완료');
  sim.tick(TIMING.notice.ms);
  assert.equal(sim.state.notice, null);
});

test('checking + network loss: result reaches the app after reconnect, once', () => {
  const sim = new Demo();
  sim.setIssuerDelay(true);
  toRequest(sim);
  sim.tick(TIMING.pendingLimit.ms);
  sim.setNetwork(false);
  sim.releaseHeld();
  sim.tick(5000);
  assert.equal(sim.state.pay, 'checking');
  sim.setNetwork(true);
  sim.tick(TIMING.reconnect.ms + TIMING.uplink.ms + TIMING.downlink.ms);
  assert.equal(sim.state.pay, 'approved');
  assert.ok(sim.state.notice);
  assert.equal(sim.state.charges, 1);
});

test('turning the delay off releases the held response at normal speed', () => {
  const sim = new Demo();
  sim.setIssuerDelay(true);
  toRequest(sim);
  sim.tick(3000);
  assert.equal(sim.state.ledger['TX-0001'].status, 'held');
  sim.setIssuerDelay(false);
  sim.tick(TIMING.issuer.ms + TIMING.downlink.ms);
  assert.equal(sim.state.pay, 'approved');
});

test('releaseHeld refuses when nothing is held', () => {
  assert.equal(new Demo().releaseHeld(), false);
});

// ---- 예외: 거절 ----
test('insufficient balance is declined, nothing charged', () => {
  const sim = new Demo();
  sim.setLowBalance(true);
  toRequest(sim);
  sim.tick(ROUND);
  assert.equal(sim.state.pay, 'declined');
  assert.equal(sim.state.result.reason, '잔액 부족');
  assert.equal(sim.state.charges, 0);
  assert.equal(sim.balance(), BALANCE.low);
});

test('issuer decline: declined, nothing charged; a new attempt gets a new id', () => {
  const sim = new Demo();
  sim.setDecline(true);
  toRequest(sim);
  sim.tick(ROUND);
  assert.equal(sim.state.pay, 'declined');
  assert.equal(sim.state.result.reason, '카드사 거절');
  assert.equal(sim.state.charges, 0);
  sim.setDecline(false);
  toRequest(sim);
  assert.equal(sim.state.txId, 'TX-0002');
});

// ---- 승인 후: 취소 불가, 환불만 ----
test('after approval cancel is refused; refund once, balance restored', () => {
  const sim = toRequest();
  assert.equal(typeof sim.cancel(), 'string', 'cannot cancel once sent');
  sim.tick(ROUND);
  assert.equal(typeof sim.cancel(), 'string');
  assert.equal(sim.state.pay, 'approved');
  assert.equal(sim.requestRefund(), true);
  assert.equal(sim.state.refundId, 'RF-0001');
  assert.equal(sim.requestRefund(), false, 'refund only once');
  sim.tick(TIMING.refund.ms);
  assert.equal(sim.state.pay, 'refunded');
  assert.equal(sim.balance(), BALANCE.normal);
  assert.equal(sim.state.notice.title, '환불 완료');
});

test('refund while offline is refused', () => {
  const sim = toRequest();
  sim.tick(ROUND);
  sim.setNetwork(false);
  assert.equal(typeof sim.requestRefund(), 'string');
  assert.equal(sim.state.refundId, null);
});

// ---- 시뮬레이터 동작 ----
test('pause freezes every clock; Next skips while staying paused', () => {
  const sim = toWindow();
  sim.togglePause();
  const before = sim.state.windowMs;
  sim.tick(10000);
  assert.equal(sim.state.windowMs, before);
  sim.advance(); // 남은 취소 시간 건너뛰기 -> 요청 전송
  assert.equal(sim.paused, true);
  assert.equal(sim.state.pay, 'requesting');
});

test('reset restarts ids so every rehearsal shows TX-0001', () => {
  const sim = toRequest();
  sim.reset();
  toRequest(sim);
  assert.equal(sim.state.txId, 'TX-0001');
});

const expected = {
  A: { pay: 'approved', charges: 1 },
  B: { pay: 'cancelled', charges: 0 },
  C: { pay: 'approved', charges: 1, attempts: 2 },
  D: { pay: 'approved', charges: 1, view: 'status' },
  E: { pay: 'declined', charges: 0 },
  F: { pay: 'declined', charges: 0 },
  G: { pay: 'refunded', charges: 1 },
};
for (const key of Object.keys(new Demo().scenarios())) {
  test('scenario ' + key + ' completes with the expected result, can pause and step', () => {
    const sim = new Demo();
    sim.runScenario(key);
    sim.tick(300);
    sim.togglePause();
    sim.advance();
    assert.equal(sim.paused, true);
    sim.togglePause();
    sim.tick(120000);
    assert.equal(sim.scenario.done, true);
    for (const [field, value] of Object.entries(expected[key])) assert.equal(sim.state[field], value, key + '.' + field);
    if (key !== 'B') assert.equal(sim.state.txId, 'TX-0001');
  });
}

test('scenario C really loses the response (server approved before the cut)', () => {
  const sim = new Demo();
  sim.runScenario('C');
  while (sim.scenario.index < 7) sim.tick(50); // '응답 도착 직전 네트워크 끊김' 단계
  assert.equal(sim.state.link, 'offline');
  assert.equal(sim.state.ledger['TX-0001'].status, 'approved');
  assert.equal(sim.state.pay, 'requesting');
});

test('scenario D passes through checking', () => {
  const sim = new Demo();
  sim.runScenario('D');
  let sawChecking = false;
  while (!sim.scenario.done) { sim.tick(50); if (sim.state.pay === 'checking') sawChecking = true; }
  assert.ok(sawChecking);
});

console.log(passed + ' tests passed');
