// domain.js — 데모배달 주문 추적 규칙 (RULES.md 참고).
// 시간 압축: 이야기 1분 = 데모 1초. 모든 규칙은 이 이야기 시계로 정확히 적용된다.
// 라이더 위치는 상태에 저장하지 않고 이동 구간(leg)과 현재 시각에서 계산한다.
(function (root) {
  'use strict';
  const Simulator = typeof module !== 'undefined' && module.exports ? require('./sim.js') : root.Simulator;

  const MIN = 1000; // 이야기 1분 = 데모 1000ms

  // policy = 제품 규칙(정확히 유지), staged = 연출용 대기(압축). 단위: 이야기 분.
  const TIMING = {
    dispatchDelay: { min: 5, kind: 'policy', note: '배차 5분 초과 시 지연 안내 + 쿠폰' },
    storeResponse: { min: 2, kind: 'staged', note: '가게 자동 수락' },
    prepStart: { min: 2, kind: 'staged', note: '수락 후 조리 시작' },
    cooking: { min: 12, kind: 'staged', note: '조리' },
    dispatch: { min: 3, kind: 'staged', note: '조리 시작 후 배차' },
    dispatchRetry: { min: 1, kind: 'staged', note: '라이더 수급 회복 후 배차' },
    reviewPrompt: { min: 1, kind: 'staged', note: '배달 완료 후 리뷰 요청' },
    flash: { min: 3, kind: 'staged', note: '화면 안내 문구 표시' },
  };
  for (const t of Object.values(TIMING)) t.ms = t.min * MIN;

  // ---- 가상 동네 지도 (SVG 좌표) ----------------------------------------------
  const SPEED = 30; // 지도 단위 / 이야기 분
  const PLACES = {
    store: { label: '한입분식', at: [60, 60] },
    home: { label: '집', line: '데모구 샘플로 12, 101동 1001호', at: [290, 230] },
    office: { label: '회사', line: '데모구 시연대로 88, 7층', at: [290, 90] },
  };
  const ROUTE_TO_STORE = [[20, 250], [60, 250], [60, 60]];
  const ROUTE_TO_HOME = [[60, 60], [60, 150], [200, 150], [200, 230], [290, 230]];
  // 승인 시점 위치에서 회사로: 세로로 회사 앞 길까지, 그다음 가로로.
  const rerouteToOffice = (pos) => [pos, [pos[0], PLACES.office.at[1]], PLACES.office.at];

  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pathLength = (path) => path.slice(1).reduce((sum, p, i) => sum + dist(path[i], p), 0);
  function pointAlong(path, d) {
    let left = d;
    for (let i = 1; i < path.length; i += 1) {
      const seg = dist(path[i - 1], path[i]);
      if (seg === 0) continue;
      if (left <= seg) {
        const f = left / seg;
        return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
      }
      left -= seg;
    }
    return path[path.length - 1].slice();
  }
  const travelMs = (path) => Math.max(1, Math.round((pathLength(path) / SPEED) * MIN));

  const ORDER = {
    store: '한입분식 (가상 매장)',
    items: [{ name: '국물떡볶이 세트', qty: 1, price: 15000 }, { name: '김말이 튀김', qty: 1, price: 3000 }],
    tip: 3000,
  };
  ORDER.total = ORDER.items.reduce((sum, i) => sum + i.qty * i.price, 0) + ORDER.tip;
  const RIDER = { name: '김바람', vehicle: '오토바이' };
  const COUPON_AMOUNT = 3000;
  const DELAY_EXTRA_MIN = 10;
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  class Demo extends Simulator {
    static TEXT = {
      ...Simulator.TEXT_KO,
      studioTag: '투자자 데모 · 시뮬레이션',
      caption: '시뮬레이션 전용 · 실제 주문·결제·위치 없음 · 이야기 1분 = 데모 1초 · P 일시정지 · N 다음 · R 초기화 · 1–6 시나리오 · 제어 키는 버튼 옆',
    };

    initialState() {
      return { view: 'menu', autoStore: true, ridersAvailable: true, riderLink: 'online', ...this.blankOrder() };
    }

    blankOrder() {
      return {
        order: 'none', orderId: null, placedAt: null, cookStartAt: null, pickedUpAt: null, deliveredAt: null,
        dispatch: 'idle', searchStartAt: null, rider: null, leg: null, pendingArrival: null, lastFix: null,
        delayNotice: false, coupon: null,
        address: 'home', addressChange: null,
        refund: null, review: 'none', rating: 0, flash: null,
      };
    }

    active() {
      return ['placed', 'accepted', 'cooking', 'ready', 'delivering'].includes(this.state.order);
    }

    // 앱 안내 문구. 표시 여부는 시간으로 판단하므로 타이머가 필요 없다.
    say(text) {
      this.state.flash = { text, until: this.time + TIMING.flash.ms };
    }

    // 자동 재생 첫 단계용 "빨리 감기": 같은 규칙을 가상 시계로 즉시 돌린다.
    fastForward(ms) {
      const sc = this.scenario;
      this.scenario = null;
      this.tick(ms);
      this.scenario = sc;
    }

    // ---- 라이더 위치 (시간에서 계산) ----------------------------------------------
    riderPos() {
      const leg = this.state.leg;
      if (!leg) return null;
      const f = Math.min(1, Math.max(0, (this.time - leg.startAt) / leg.ms));
      return pointAlong(leg.path, f * pathLength(leg.path));
    }

    // 앱이 보여주는 위치: 통신이 끊기면 마지막 위치에 고정.
    displayPos() {
      const s = this.state;
      return s.riderLink === 'lost' && s.lastFix ? s.lastFix.pos : this.riderPos();
    }

    // ---- 고객 ------------------------------------------------------------------
    // 주문 생성은 여기 한 곳. 진행 중 주문이 있으면 아무것도 만들지 않는다.
    placeOrder() {
      const s = this.state;
      if (this.active()) return false;
      Object.assign(s, this.blankOrder());
      s.orderId = this.nextId('ORD');
      s.order = 'placed';
      s.placedAt = this.time;
      s.view = 'track';
      this.log(s.orderId + ' 주문 접수 · 결제 ' + won(ORDER.total) + ' (가짜)');
      if (s.autoStore) this.schedule('store', TIMING.storeResponse.ms, () => this.storeAccept());
      return true;
    }

    cancel() {
      const s = this.state;
      if (['placed', 'accepted'].includes(s.order)) {
        this.unschedule('store');
        this.unschedule('prep');
        s.order = 'cancelled';
        this.log(s.orderId + ' 고객 취소 (조리 전)');
        this.refund('고객 취소');
        return true;
      }
      if (this.active()) {
        this.say('조리가 시작되어 취소할 수 없어요. 가게에 문의해 주세요.');
        this.log(s.orderId + ' 취소 요청 거부: 조리 시작 후');
      } else {
        this.say('취소할 수 있는 주문이 없어요.');
      }
      return false;
    }

    requestAddressChange() {
      const s = this.state;
      if (s.order !== 'delivering' || s.addressChange) return false;
      s.addressChange = { to: 'office', status: 'pending', at: this.time };
      this.log(s.orderId + ' 주소 변경 요청 → 회사 (라이더 확인 대기)');
      return true;
    }

    submitReview(rating) {
      const s = this.state;
      if (s.review !== 'requested' || !(rating >= 1 && rating <= 5)) return false;
      s.rating = rating;
      s.review = 'done';
      this.log(s.orderId + ' 리뷰 별점 ' + rating + '점');
      return true;
    }

    // ---- 가게 ------------------------------------------------------------------
    storeAccept() {
      const s = this.state;
      if (s.order !== 'placed') return false;
      this.unschedule('store');
      s.order = 'accepted';
      this.log(s.orderId + ' 가게 수락');
      if (s.autoStore) this.schedule('prep', TIMING.prepStart.ms, () => this.startCooking());
      return true;
    }

    storeReject() {
      const s = this.state;
      if (s.order !== 'placed') return false;
      this.unschedule('store');
      s.order = 'rejected';
      this.log(s.orderId + ' 가게 거절 (재료 소진)');
      this.refund('가게 거절');
      return true;
    }

    refund(reason) {
      const s = this.state;
      if (s.refund) return;
      s.refund = { amount: ORDER.total, reason };
      this.log(s.orderId + ' 자동 환불 ' + won(ORDER.total) + ' (' + reason + ')');
    }

    startCooking() {
      const s = this.state;
      if (s.order !== 'accepted') return false;
      this.unschedule('prep');
      s.order = 'cooking';
      s.cookStartAt = this.time;
      this.log(s.orderId + ' 조리 시작');
      this.schedule('cookDone', TIMING.cooking.ms, () => this.cookDone());
      this.startDispatch();
      return true;
    }

    cookDone() {
      const s = this.state;
      if (s.order !== 'cooking') return;
      this.log(s.orderId + ' 조리 완료');
      if (s.dispatch === 'at_store') this.pickup();
      else s.order = 'ready';
    }

    // ---- 배차 ------------------------------------------------------------------
    startDispatch() {
      const s = this.state;
      s.dispatch = 'searching';
      s.searchStartAt = this.time;
      this.log('라이더 배차 탐색 시작');
      this.schedule('dispatchDelay', TIMING.dispatchDelay.ms, () => this.dispatchDelayed());
      if (s.ridersAvailable) this.schedule('dispatch', TIMING.dispatch.ms, () => this.assignRider());
    }

    dispatchDelayed() {
      const s = this.state;
      if (s.dispatch !== 'searching' || s.delayNotice) return;
      s.delayNotice = true;
      s.coupon = { id: 'CPN-' + s.orderId.slice(4), amount: COUPON_AMOUNT };
      this.log('배차 5분 초과 → 지연 안내 + 쿠폰 ' + s.coupon.id + ' (' + won(COUPON_AMOUNT) + ')');
    }

    assignRider() {
      const s = this.state;
      if (s.dispatch !== 'searching') return false;
      this.unschedule('dispatch');
      this.unschedule('dispatchDelay');
      s.dispatch = 'assigned';
      s.rider = { ...RIDER };
      this.log('라이더 배차: ' + RIDER.name + ' → 가게로 이동');
      this.startLeg('to_store', ROUTE_TO_STORE);
      return true;
    }

    startLeg(kind, path) {
      const ms = travelMs(path);
      this.state.leg = { kind, path, startAt: this.time, ms };
      this.schedule('arrive', ms, () => this.arrive(kind));
    }

    arrive(kind) {
      const s = this.state;
      if (s.riderLink === 'lost') {
        s.pendingArrival = kind;
        this.log('라이더 ' + (kind === 'to_store' ? '가게' : '목적지') + ' 도착 (통신 끊김: 복구 시 반영)');
        return;
      }
      if (kind === 'to_store') this.arrivedStore();
      else this.arrivedCustomer();
    }

    arrivedStore() {
      const s = this.state;
      s.dispatch = 'at_store';
      this.log('라이더 가게 도착');
      if (s.order === 'ready') this.pickup();
    }

    pickup() {
      const s = this.state;
      s.order = 'delivering';
      s.dispatch = 'done';
      s.pickedUpAt = this.time;
      this.log(s.orderId + ' 픽업 → 배달 출발');
      this.startLeg('to_customer', ROUTE_TO_HOME);
    }

    arrivedCustomer() {
      const s = this.state;
      s.order = 'delivered';
      s.deliveredAt = this.time;
      if (s.addressChange && s.addressChange.status === 'pending') {
        s.addressChange.status = 'expired';
        this.log('주소 변경 요청 만료: 기존 주소에 이미 도착');
      }
      this.log(s.orderId + ' 배달 완료 (' + PLACES[s.address].label + ')');
      this.schedule('review', TIMING.reviewPrompt.ms, () => {
        if (s.review === 'none') {
          s.review = 'requested';
          this.log('리뷰 요청');
        }
      });
    }

    // ---- 라이더 응답 (콘솔) ---------------------------------------------------
    riderRespond(approve) {
      const s = this.state;
      const req = s.addressChange;
      if (!req || req.status !== 'pending' || s.order !== 'delivering' || s.riderLink !== 'online') return false;
      if (!approve) {
        req.status = 'declined';
        this.log('라이더 주소 변경 거절 → 기존 주소로 배달');
        return true;
      }
      req.status = 'approved';
      s.address = req.to;
      this.startLeg('to_customer', rerouteToOffice(this.riderPos()));
      this.log('라이더 주소 변경 승인 → 회사로 경로 변경');
      return true;
    }

    // ---- 환경 (콘솔) ------------------------------------------------------------
    setRiderLink(online) {
      const s = this.state;
      if (!online) {
        if (s.riderLink === 'lost' || !s.rider || !['cooking', 'ready', 'delivering'].includes(s.order)) return false;
        s.riderLink = 'lost';
        s.lastFix = { pos: this.riderPos(), at: this.time };
        this.log('라이더 통신 끊김 → 마지막 위치 표시');
        return true;
      }
      if (s.riderLink !== 'lost') return false;
      s.riderLink = 'online';
      s.lastFix = null;
      this.log('라이더 통신 복구 → 현재 위치로 갱신');
      const pending = s.pendingArrival;
      s.pendingArrival = null;
      if (pending === 'to_store') this.arrivedStore();
      else if (pending === 'to_customer') this.arrivedCustomer();
      return true;
    }

    setRidersAvailable(on) {
      const s = this.state;
      s.ridersAvailable = on;
      this.log(on ? '라이더 수급 회복' : '주변 라이더 부족');
      if (s.dispatch !== 'searching') return true;
      if (on) this.schedule('dispatch', TIMING.dispatchRetry.ms, () => this.assignRider());
      else this.unschedule('dispatch');
      return true;
    }

    setAutoStore(on) {
      const s = this.state;
      s.autoStore = on;
      this.log(on ? '가게 자동 응답 켬' : '가게 자동 응답 끔 (발표자가 수락·거절)');
      if (!on) {
        this.unschedule('store');
        this.unschedule('prep');
      } else if (s.order === 'placed') {
        this.schedule('store', TIMING.storeResponse.ms, () => this.storeAccept());
      } else if (s.order === 'accepted') {
        this.schedule('prep', TIMING.prepStart.ms, () => this.startCooking());
      }
      return true;
    }

    // ---- 화면용 계산값 -----------------------------------------------------------
    // 도착 예정: 배달 중이면 이동 구간 종료 시각, 그 전에는 주문 시 안내한 30~40분(+지연).
    eta() {
      const s = this.state;
      if (s.placedAt === null) return null;
      if (s.order === 'delivering' && s.leg && s.leg.kind === 'to_customer') return { exact: s.leg.startAt + s.leg.ms };
      const extra = s.delayNotice ? DELAY_EXTRA_MIN * MIN : 0;
      return { from: s.placedAt + 30 * MIN + extra, to: s.placedAt + 40 * MIN + extra };
    }

    // ---- 자동 재생 시나리오 -------------------------------------------------------
    scenarios() {
      const T = TIMING;
      const step = (label, duration, run = () => {}) => ({ label, duration, run });
      const homeMs = travelMs(ROUTE_TO_HOME);
      const storeMs = travelMs(ROUTE_TO_STORE);
      const toPickup = T.storeResponse.ms + T.prepStart.ms + T.cooking.ms; // 라이더가 먼저 도착하는 정상 흐름
      const intoDelivery = (sim) => { sim.placeOrder(); sim.fastForward(toPickup); };
      // E: 배달 시작 + 3s(보기) + 2.5s(요청 대기) 시점에 승인 → 그 위치에서 회사까지
      const approveAt = 3000 + 2500;
      const officeMs = travelMs(rerouteToOffice(pointAlong(ROUTE_TO_HOME, (approveAt / MIN) * SPEED)));
      return {
        A: {
          title: '정상 배달',
          summary: '주문부터 리뷰 요청까지 약 35초',
          steps: [
            step('앱 홈 · 장바구니', 2000),
            step('주문 접수', T.storeResponse.ms, (sim) => sim.placeOrder()),
            step('가게 수락', T.prepStart.ms),
            step('조리 시작 · 라이더 탐색', T.dispatch.ms),
            step('라이더 배차 · 가게로 이동', T.cooking.ms - T.dispatch.ms),
            step('픽업 · 배달 중 (지도)', homeMs),
            step('배달 완료', T.reviewPrompt.ms),
            step('리뷰 요청', 2500),
          ],
        },
        B: {
          title: '가게 거절 → 자동 환불',
          summary: '거절 즉시 21,000원 환불',
          steps: [
            step('앱 홈 · 장바구니', 1500, (sim) => sim.setAutoStore(false)),
            step('주문 접수 · 가게 확인 중', 2500, (sim) => sim.placeOrder()),
            step('가게 거절 → 자동 환불', 4000, (sim) => sim.storeReject()),
          ],
        },
        C: {
          title: '배차 지연 → 안내 + 쿠폰',
          summary: '배차 5분 초과 시 쿠폰 자동 지급',
          steps: [
            step('주변 라이더 부족', 1500, (sim) => sim.setRidersAvailable(false)),
            step('주문 접수', T.storeResponse.ms, (sim) => sim.placeOrder()),
            step('가게 수락', T.prepStart.ms),
            step('조리 시작 · 배차 탐색 5분', T.dispatchDelay.ms),
            step('배차 지연 안내 + 쿠폰', 3000),
            step('라이더 수급 회복 → 배차', T.dispatchRetry.ms, (sim) => sim.setRidersAvailable(true)),
            step('라이더 가게로 이동', storeMs),
            step('픽업 · 배달 출발', 3000),
          ],
        },
        D: {
          title: '고객 취소: 조리 전만 가능',
          summary: '수락 후 취소 → 환불, 조리 중 → 불가',
          steps: [
            step('앱 홈 · 장바구니', 1500),
            step('주문 접수', T.storeResponse.ms, (sim) => sim.placeOrder()),
            step('가게 수락 (조리 전)', 1500),
            step('고객 취소 → 자동 환불', 3500, (sim) => sim.cancel()),
            step('다시 주문 → 조리 시작', T.storeResponse.ms + T.prepStart.ms + 500, (sim) => sim.placeOrder()),
            step('조리 중 취소 시도 → 불가', 3500, (sim) => sim.cancel()),
          ],
        },
        E: {
          title: '배달 중 주소 변경',
          summary: '라이더 승인 후에만 경로 변경',
          steps: [
            step('배달 중까지 빨리 감기', 3000, intoDelivery),
            step('고객: 회사로 주소 변경 요청', 2500, (sim) => sim.requestAddressChange()),
            step('라이더 승인 → 경로 재탐색', officeMs, (sim) => sim.riderRespond(true)),
            step('회사 도착 · 리뷰 요청', T.reviewPrompt.ms + 1500),
          ],
        },
        F: {
          title: '라이더 통신 끊김',
          summary: '마지막 위치 표시, 복구 시 갱신',
          steps: [
            step('배달 중까지 빨리 감기', 3000, intoDelivery),
            step('라이더 통신 끊김 → 마지막 위치', 5000, (sim) => sim.setRiderLink(false)),
            step('통신 복구 → 현재 위치로 갱신', 3000, (sim) => sim.setRiderLink(true)),
            step('배달 계속 → 완료', homeMs - 11000 + 1500),
          ],
        },
      };
    }
  }

  Demo.TIMING = TIMING;
  Demo.MIN = MIN;
  Demo.SPEED = SPEED;
  Demo.PLACES = PLACES;
  Demo.ORDER = ORDER;
  Demo.ROUTES = { toStore: ROUTE_TO_STORE, toHome: ROUTE_TO_HOME };
  Demo.geo = { pathLength, pointAlong, travelMs, rerouteToOffice };
  Demo.won = won;

  if (typeof module !== 'undefined' && module.exports) module.exports = Demo;
  else root.Demo = Demo;
})(typeof window !== 'undefined' ? window : globalThis);
