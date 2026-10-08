// test.cjs — 규칙 테스트. Node 기본 모듈만 사용: `node test.cjs`
// RULES.md의 전이·예외·불변식·시나리오마다 하나씩.
'use strict';
const assert = require('node:assert/strict');
const Demo = require('./domain.js');
const { TIMING: T, ROUTES, geo } = Demo;

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
const HOME_MS = geo.travelMs(ROUTES.toHome);
const STORE_MS = geo.travelMs(ROUTES.toStore);

// 주문 → 픽업 직후(배달 중)까지
function toDelivering(sim) {
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms + T.cooking.ms);
  assert.equal(sim.state.order, 'delivering');
}

// ---- 전이 --------------------------------------------------------------------
test('정상 흐름: 접수 → 수락 → 조리 → 배차 → 픽업 → 배달 → 완료 → 리뷰 요청', () => {
  const sim = fresh();
  assert.equal(sim.placeOrder(), true);
  assert.equal(sim.state.order, 'placed');
  assert.equal(sim.state.view, 'track');
  sim.tick(T.storeResponse.ms);
  assert.equal(sim.state.order, 'accepted');
  sim.tick(T.prepStart.ms);
  assert.equal(sim.state.order, 'cooking');
  assert.equal(sim.state.dispatch, 'searching');
  sim.tick(T.dispatch.ms);
  assert.equal(sim.state.dispatch, 'assigned');
  sim.tick(STORE_MS);
  assert.equal(sim.state.dispatch, 'at_store');
  assert.equal(sim.state.order, 'cooking', '라이더가 먼저 도착해도 조리 완료 전엔 픽업 안 함');
  sim.tick(T.cooking.ms - T.dispatch.ms - STORE_MS);
  assert.equal(sim.state.order, 'delivering');
  sim.tick(HOME_MS);
  assert.equal(sim.state.order, 'delivered');
  assert.equal(sim.state.review, 'none');
  sim.tick(T.reviewPrompt.ms);
  assert.equal(sim.state.review, 'requested');
  assert.equal(sim.submitReview(5), true);
  assert.equal(sim.state.review, 'done');
  assert.equal(sim.submitReview(1), false, '리뷰는 한 번만');
});

test('정상 흐름 전체는 이야기 30~40분, 데모 1분 이내', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(60000);
  assert.equal(sim.state.order, 'delivered');
  const minutes = sim.state.deliveredAt / Demo.MIN;
  assert.ok(minutes >= 25 && minutes <= 40, '배달 완료까지 ' + minutes + '분');
  const a = sim.scenarios().A.steps.reduce((sum, s) => sum + s.duration, 0);
  assert.ok(a < 60000, '시나리오 A ' + a + 'ms');
});

test('조리 완료 시 라이더가 아직 없으면 ready로 대기, 라이더 도착 시 픽업', () => {
  const sim = fresh();
  sim.setRidersAvailable(false);
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms + T.cooking.ms);
  assert.equal(sim.state.order, 'ready');
  sim.setRidersAvailable(true);
  sim.tick(T.dispatchRetry.ms);
  assert.equal(sim.state.dispatch, 'assigned');
  sim.tick(STORE_MS);
  assert.equal(sim.state.order, 'delivering');
});

test('가게 자동 응답 끔: 발표자가 수락·조리 시작해야 진행', () => {
  const sim = fresh();
  sim.setAutoStore(false);
  sim.placeOrder();
  sim.tick(30000);
  assert.equal(sim.state.order, 'placed');
  assert.equal(sim.startCooking(), false, '수락 전 조리 불가');
  assert.equal(sim.storeAccept(), true);
  sim.tick(30000);
  assert.equal(sim.state.order, 'accepted');
  assert.equal(sim.startCooking(), true);
  assert.equal(sim.state.order, 'cooking');
});

test('자동 응답을 다시 켜면 대기 중인 단계가 이어진다', () => {
  const sim = fresh();
  sim.setAutoStore(false);
  sim.placeOrder();
  sim.setAutoStore(true);
  sim.tick(T.storeResponse.ms + T.prepStart.ms);
  assert.equal(sim.state.order, 'cooking');
});

// ---- 예외: 가게 거절 ------------------------------------------------------------
test('가게 거절 → 즉시 자동 환불 (주문당 1회)', () => {
  const sim = fresh();
  sim.setAutoStore(false);
  sim.placeOrder();
  assert.equal(sim.storeReject(), true);
  assert.equal(sim.state.order, 'rejected');
  assert.deepEqual(sim.state.refund, { amount: Demo.ORDER.total, reason: '가게 거절' });
  assert.equal(sim.storeReject(), false);
  assert.equal(sim.cancel(), false);
  assert.equal(sim.state.refund.reason, '가게 거절');
  sim.tick(60000);
  assert.equal(sim.state.order, 'rejected', '거절 후 아무것도 진행되지 않음');
});

test('가게 거절은 접수 상태에서만', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(T.storeResponse.ms);
  assert.equal(sim.storeReject(), false);
  assert.equal(sim.state.order, 'accepted');
  assert.equal(sim.state.refund, null);
});

// ---- 예외: 배차 지연 ------------------------------------------------------------
test('배차 5분 정책: 4:59엔 없음, 5:00 정확히 지연 안내 + 쿠폰', () => {
  const sim = fresh();
  sim.setRidersAvailable(false);
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms);
  assert.equal(sim.state.dispatch, 'searching');
  sim.tick(T.dispatchDelay.ms - 50);
  assert.equal(sim.state.delayNotice, false);
  assert.equal(sim.state.coupon, null);
  sim.tick(50);
  assert.equal(sim.state.delayNotice, true);
  assert.deepEqual(sim.state.coupon, { id: 'CPN-0001', amount: 3000 });
  assert.equal(T.dispatchDelay.kind, 'policy');
  assert.equal(T.dispatchDelay.min, 5);
});

test('지연 쿠폰은 주문당 한 번, 지연 시 예상 시간 +10분', () => {
  const sim = fresh();
  sim.setRidersAvailable(false);
  sim.placeOrder();
  const before = sim.eta();
  sim.tick(T.storeResponse.ms + T.prepStart.ms + T.dispatchDelay.ms);
  sim.dispatchDelayed();
  sim.setRidersAvailable(false);
  sim.tick(20000);
  assert.equal(sim.state.coupon.id, 'CPN-0001');
  assert.equal(sim.events.filter((e) => e.message.includes('쿠폰')).length, 1);
  assert.equal(sim.eta().from - before.from, 10 * Demo.MIN);
});

test('5분 안에 배차되면 쿠폰 없음', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(60000);
  assert.equal(sim.state.delayNotice, false);
  assert.equal(sim.state.coupon, null);
});

test('라이더 부족 → 회복 1분 뒤 배차', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms);
  sim.setRidersAvailable(false);
  sim.tick(T.dispatch.ms + 1000);
  assert.equal(sim.state.dispatch, 'searching');
  sim.setRidersAvailable(true);
  sim.tick(T.dispatchRetry.ms);
  assert.equal(sim.state.dispatch, 'assigned');
});

// ---- 예외: 고객 취소 ------------------------------------------------------------
test('접수 상태 취소 → 환불', () => {
  const sim = fresh();
  sim.placeOrder();
  assert.equal(sim.cancel(), true);
  assert.equal(sim.state.order, 'cancelled');
  assert.equal(sim.state.refund.reason, '고객 취소');
  sim.tick(60000);
  assert.equal(sim.state.order, 'cancelled', '취소 후 가게 수락 타이머가 남아 있으면 안 됨');
});

test('가게 수락 후 조리 전 취소 → 환불, 조리 시작 안 됨', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + 500);
  assert.equal(sim.cancel(), true);
  sim.tick(60000);
  assert.equal(sim.state.order, 'cancelled');
  assert.equal(sim.state.cookStartAt, null);
});

test('조리 시작 후 취소 불가 (조리 중·조리 완료·배달 중)', () => {
  const sim = fresh();
  sim.setRidersAvailable(false);
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms);
  assert.equal(sim.cancel(), false);
  assert.equal(sim.state.order, 'cooking');
  assert.match(sim.state.flash.text, /조리가 시작되어/);
  sim.tick(T.cooking.ms);
  assert.equal(sim.state.order, 'ready');
  assert.equal(sim.cancel(), false);
  sim.setRidersAvailable(true);
  sim.tick(T.dispatchRetry.ms + STORE_MS);
  assert.equal(sim.state.order, 'delivering');
  assert.equal(sim.cancel(), false);
  assert.equal(sim.state.refund, null);
});

test('안내 문구는 3분(데모 3초) 동안만 유효', () => {
  const sim = fresh();
  sim.cancel();
  assert.equal(sim.state.flash.until - sim.time, T.flash.ms);
});

test('경합: 가게 수락과 같은 순간의 취소는 먼저 처리된 쪽 상태를 따른다', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms); // 조리 시작 시각 정확히
  assert.equal(sim.cancel(), false);
  assert.equal(sim.state.order, 'cooking');
});

// ---- 예외: 주소 변경 ------------------------------------------------------------
test('주소 변경 요청은 배달 중에만', () => {
  const sim = fresh();
  sim.placeOrder();
  assert.equal(sim.requestAddressChange(), false);
  sim.tick(T.storeResponse.ms + T.prepStart.ms + 1000);
  assert.equal(sim.requestAddressChange(), false);
  assert.equal(sim.state.addressChange, null);
});

test('승인 전에는 주소가 바뀌지 않고 라이더는 기존 경로로 계속 이동', () => {
  const sim = fresh();
  toDelivering(sim);
  assert.equal(sim.requestAddressChange(), true);
  assert.equal(sim.requestAddressChange(), false, '대기 중 중복 요청 불가');
  const leg = sim.state.leg;
  sim.tick(2000);
  assert.equal(sim.state.address, 'home');
  assert.equal(sim.state.leg, leg);
  assert.equal(sim.state.addressChange.status, 'pending');
});

test('라이더 승인 → 현재 위치에서 회사로 재경로, 회사에서 완료', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.requestAddressChange();
  sim.tick(3000);
  const pos = sim.riderPos();
  assert.equal(sim.riderRespond(true), true);
  assert.equal(sim.state.address, 'office');
  assert.deepEqual(sim.state.leg.path[0], pos, '경로는 현재 위치에서 시작');
  assert.deepEqual(sim.state.leg.path.at(-1), Demo.PLACES.office.at);
  assert.equal(sim.eta().exact, sim.time + sim.state.leg.ms);
  sim.tick(sim.state.leg.ms);
  assert.equal(sim.state.order, 'delivered');
  assert.deepEqual(sim.riderPos(), Demo.PLACES.office.at);
  assert.equal(sim.requestAddressChange(), false);
});

test('라이더 거절 → 기존 주소로 배달, 재요청 불가', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.requestAddressChange();
  assert.equal(sim.riderRespond(false), true);
  assert.equal(sim.state.addressChange.status, 'declined');
  assert.equal(sim.requestAddressChange(), false);
  sim.tick(HOME_MS);
  assert.equal(sim.state.order, 'delivered');
  assert.equal(sim.state.address, 'home');
});

test('응답 없이 기존 주소 도착 → 요청 만료', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.requestAddressChange();
  sim.tick(HOME_MS);
  assert.equal(sim.state.order, 'delivered');
  assert.equal(sim.state.addressChange.status, 'expired');
  assert.equal(sim.riderRespond(true), false);
  assert.equal(sim.state.address, 'home');
});

test('통신 끊긴 라이더는 주소 변경에 응답할 수 없다', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.requestAddressChange();
  sim.setRiderLink(false);
  assert.equal(sim.riderRespond(true), false);
  assert.equal(sim.state.addressChange.status, 'pending');
  sim.setRiderLink(true);
  assert.equal(sim.riderRespond(true), true);
});

test('응답 없는 요청이 없으면 승인/거절 불가', () => {
  const sim = fresh();
  toDelivering(sim);
  assert.equal(sim.riderRespond(true), false);
  assert.equal(sim.riderRespond(false), false);
});

// ---- 예외: 라이더 통신 끊김 -----------------------------------------------------
test('통신 끊김: 화면 위치는 마지막 위치에 고정, 실제 위치는 계속 이동', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.tick(3000);
  const at = sim.riderPos();
  assert.equal(sim.setRiderLink(false), true);
  sim.tick(4000);
  assert.deepEqual(sim.displayPos(), at);
  assert.notDeepEqual(sim.riderPos(), at);
  assert.equal(sim.state.lastFix.at, sim.time - 4000);
  assert.equal(sim.setRiderLink(true), true);
  assert.deepEqual(sim.displayPos(), sim.riderPos());
});

test('통신 끊긴 채 도착 → 배달 중 유지, 복구 시 완료', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.setRiderLink(false);
  sim.tick(HOME_MS + 5000);
  assert.equal(sim.state.order, 'delivering');
  assert.equal(sim.state.pendingArrival, 'to_customer');
  sim.setRiderLink(true);
  assert.equal(sim.state.order, 'delivered');
  assert.equal(sim.state.pendingArrival, null);
});

test('통신 끊긴 채 가게 도착 → 복구 시 픽업 반영', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms + T.dispatch.ms + 1000);
  sim.setRiderLink(false);
  sim.tick(T.cooking.ms);
  assert.equal(sim.state.order, 'ready');
  sim.setRiderLink(true);
  assert.equal(sim.state.order, 'delivering');
});

test('배차된 라이더가 없으면 통신 끊김 불가', () => {
  const sim = fresh();
  assert.equal(sim.setRiderLink(false), false);
  sim.placeOrder();
  sim.tick(T.storeResponse.ms + T.prepStart.ms + 1000);
  assert.equal(sim.setRiderLink(false), false);
  assert.equal(sim.state.riderLink, 'online');
  assert.equal(sim.setRiderLink(true), false);
});

// ---- 불변식 -------------------------------------------------------------------
test('주문하기 연타 → 주문 하나', () => {
  const sim = fresh();
  assert.equal(sim.placeOrder(), true);
  assert.equal(sim.placeOrder(), false);
  assert.equal(sim.placeOrder(), false);
  assert.equal(sim.state.orderId, 'ORD-0001');
  assert.equal(sim.events.filter((e) => e.message.includes('주문 접수')).length, 1);
});

test('주문 id는 통신 끊김·주소 변경·화면 이동에도 그대로', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.state.view = 'menu';
  sim.placeOrder();
  sim.requestAddressChange();
  sim.setRiderLink(false);
  sim.tick(1000);
  sim.setRiderLink(true);
  sim.riderRespond(true);
  sim.tick(30000);
  assert.equal(sim.state.orderId, 'ORD-0001');
  assert.equal(sim.state.order, 'delivered');
});

test('종료 후 새 주문은 새 id, 이전 주문 정보는 비워진다', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.cancel();
  assert.equal(sim.placeOrder(), true);
  assert.equal(sim.state.orderId, 'ORD-0002');
  assert.equal(sim.state.refund, null);
  assert.equal(sim.state.order, 'placed');
});

test('일시정지는 모든 시계를 멈추고, 다음(N)은 일시정지를 유지한 채 다음 이벤트로', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.togglePause();
  sim.tick(60000);
  assert.equal(sim.time, 0);
  assert.equal(sim.state.order, 'placed');
  sim.advance();
  assert.equal(sim.paused, true);
  assert.equal(sim.state.order, 'accepted');
  sim.advance();
  assert.equal(sim.state.order, 'cooking');
});

test('다음(N)만으로 배달 중 이동을 건너뛸 수 있다', () => {
  const sim = fresh();
  toDelivering(sim);
  sim.advance();
  assert.equal(sim.state.order, 'delivered');
});

test('초기화하면 주문번호가 다시 ORD-0001', () => {
  const sim = fresh();
  sim.placeOrder();
  sim.cancel();
  sim.placeOrder();
  sim.reset();
  sim.placeOrder();
  assert.equal(sim.state.orderId, 'ORD-0001');
});

test('같은 입력 → 같은 결과 (결정적)', () => {
  const run = () => {
    const sim = fresh();
    sim.runScenario('E');
    sim.tick(60000);
    return JSON.stringify([sim.state, sim.events.map((e) => [e.at, e.message])]);
  };
  assert.equal(run(), run());
});

// ---- 시나리오 -----------------------------------------------------------------
const expectEnd = {
  A: (s) => { assert.equal(s.order, 'delivered'); assert.equal(s.review, 'requested'); assert.equal(s.coupon, null); },
  B: (s) => { assert.equal(s.order, 'rejected'); assert.equal(s.refund.reason, '가게 거절'); },
  C: (s) => { assert.equal(s.order, 'delivering'); assert.equal(s.coupon.id, 'CPN-0001'); },
  D: (s) => { assert.equal(s.orderId, 'ORD-0002'); assert.equal(s.order, 'cooking'); assert.equal(s.refund, null); },
  E: (s) => { assert.equal(s.order, 'delivered'); assert.equal(s.address, 'office'); assert.equal(s.review, 'requested'); },
  F: (s) => { assert.equal(s.order, 'delivered'); assert.equal(s.riderLink, 'online'); assert.equal(s.review, 'requested'); },
};

test('시나리오는 6개, 모두 종료 상태가 정의됨', () => {
  assert.deepEqual(Object.keys(fresh().scenarios()), Object.keys(expectEnd));
});

for (const key of Object.keys(expectEnd)) {
  test('시나리오 ' + key + ': 끝까지 재생 시 기대 상태, 1분 이내', () => {
    const sim = fresh();
    const def = sim.scenarios()[key];
    const total = def.steps.reduce((sum, s) => sum + s.duration, 0);
    assert.ok(total < 60000, key + ' 길이 ' + total);
    sim.runScenario(key);
    sim.tick(total + 50 * def.steps.length); // 단계 경계는 50ms 단위로 끊긴다
    assert.equal(sim.scenario.done, true);
    expectEnd[key](sim.state);
  });

  test('시나리오 ' + key + ': 일시정지 + 다음(N)만으로도 같은 결과', () => {
    const sim = fresh();
    sim.runScenario(key);
    sim.togglePause();
    let guard = 0;
    while (!sim.scenario.done && guard++ < 50) sim.advance();
    assert.equal(sim.paused, true);
    assert.equal(sim.scenario.done, true);
    expectEnd[key](sim.state);
  });
}

test('시나리오 D: 첫 주문은 취소·환불, 두 번째 주문 취소 시도는 거부 안내', () => {
  const sim = fresh();
  sim.runScenario('D');
  sim.tick(1500 + T.storeResponse.ms + 1500 + 100);
  assert.equal(sim.state.order, 'cancelled');
  assert.equal(sim.state.refund.amount, Demo.ORDER.total);
  sim.tick(60000);
  assert.match(sim.state.flash.text, /취소할 수 없어요/);
});

test('시나리오 F: 끊긴 동안 화면 위치가 고정된다', () => {
  const sim = fresh();
  sim.runScenario('F');
  sim.tick(3000 + 100);
  const fix = sim.displayPos();
  sim.tick(3000);
  assert.equal(sim.state.riderLink, 'lost');
  assert.deepEqual(sim.displayPos(), fix);
});

test('수동 개입은 자동 재생을 끝내지만 상태는 유지', () => {
  const sim = fresh();
  sim.runScenario('A');
  sim.tick(5000);
  const order = sim.state.orderId;
  sim.stopScenario();
  sim.storeReject();
  assert.equal(sim.scenario, null);
  assert.equal(sim.state.orderId, order);
});

console.log(passed + ' tests passed');
