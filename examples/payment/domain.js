// domain.js — 페이링 결제 승인 규칙 (RULES.md 기준).
// 앱(단말)과 모의 서버/카드사가 같은 시뮬레이터 안에 있다. 서버는 거래번호를 멱등 키로 써서
// 같은 번호가 몇 번 와도 출금은 한 번만 한다. 네트워크는 앱↔서버 구간만 끊긴다.
(function (root) {
  'use strict';
  const Simulator = typeof module !== 'undefined' && module.exports ? require('./sim.js') : root.Simulator;

  // policy = 실제 제품 규칙(압축 금지), staged = 발표용으로 압축한 연출 시간
  const TIMING = {
    hold: { ms: 1000, kind: 'policy', note: '지문 센서 1초 길게 누르기' },
    cancelWindow: { ms: 3000, kind: 'policy', note: '승인 요청 전 취소 가능 시간' },
    pendingLimit: { ms: 10000, kind: 'policy', note: '승인 대기 한도, 넘으면 확인 중' },
    scan: { ms: 1500, kind: 'staged', note: 'QR 인식' },
    uplink: { ms: 400, kind: 'staged', note: '앱 → 서버' },
    issuer: { ms: 1200, kind: 'staged', note: '카드사 승인 처리' },
    downlink: { ms: 400, kind: 'staged', note: '서버 → 앱' },
    reconnect: { ms: 1200, kind: 'staged', note: '네트워크 재연결' },
    notice: { ms: 5000, kind: 'staged', note: '알림 배너 표시' },
    refund: { ms: 2500, kind: 'staged', note: '환불 처리' },
  };

  // 가상 데이터 (실존 가맹점·카드 아님)
  const MERCHANT = { name: '브루잉랩 성수점', id: 'M-20417', items: '아메리카노 외 2건', amount: 12800 };
  const CARD = '가온 체크카드 ****1234';
  const BALANCE = { normal: 85400, low: 5200 };

  const AWAITING = ['requesting', 'checking'];
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  class Demo extends Simulator {
    static TEXT = { ...Simulator.TEXT_KO, studioTag: '결제 승인 시연' };

    initialState() {
      return {
        view: 'home',
        pay: 'idle',
        txId: null,
        refundId: null,
        holdMs: 0,
        windowMs: 0,
        requestedAt: null,
        attempts: 0,       // 이 거래번호로 앱이 보낸 요청 수
        inflight: false,   // 전송했고 응답을 기다리는 요청이 있는지
        result: null,      // { status, reason, approvalNo }
        notice: null,      // 푸시 알림 배너 { title, body }
        network: 'online', // 발표자가 정한 환경
        link: 'online',    // 앱이 실제로 가진 연결: online | reconnecting | offline
        issuerDelay: false,
        declineMode: false,
        lowBalance: false,
        spent: 0,          // 순 출금액 (환불 시 복원)
        charges: 0,        // 실제 출금 횟수
        ledger: {},        // 모의 서버 원장: txId -> { status, received, reason, approvalNo }
      };
    }

    balance() {
      return this.state.lowBalance ? BALANCE.low : BALANCE.normal - this.state.spent;
    }

    entry() {
      return this.state.txId ? this.state.ledger[this.state.txId] : null;
    }

    onStep(dt) {
      const s = this.state;
      if (s.pay === 'holding') {
        s.holdMs += dt;
        if (s.holdMs >= TIMING.hold.ms) {
          s.pay = 'cancel_window';
          s.windowMs = TIMING.cancelWindow.ms;
          this.log('지문 인증 완료 · 3초 취소 가능');
        }
      } else if (s.pay === 'cancel_window') {
        s.windowMs = Math.max(0, s.windowMs - dt);
        if (s.windowMs === 0) this.commit();
      }
    }

    // 지문·취소 시간은 onStep으로 흐르므로 '다음 단계'가 건너뛸 수 있게 남은 시간을 알려준다.
    nextEventIn() {
      const s = this.state;
      if (s.pay === 'holding') return Math.max(1, TIMING.hold.ms - s.holdMs);
      if (s.pay === 'cancel_window') return Math.max(1, s.windowMs);
      return super.nextEventIn();
    }

    // ---- 사용자 동작 (실패 시 false 또는 안내 문구를 돌려준다) -------------------
    startScan() {
      const s = this.state;
      if (AWAITING.includes(s.pay)) return '확인 중인 결제가 있어요. 결과 알림 후 다시 시도해 주세요.';
      if (!['idle', 'approved', 'declined', 'cancelled', 'refund_requested', 'refunded'].includes(s.pay)) return '이미 결제를 진행하고 있어요.';
      Object.assign(s, { pay: 'scanning', view: 'scan', txId: null, refundId: null, result: null, attempts: 0, holdMs: 0, windowMs: 0, requestedAt: null });
      this.log('QR 스캔 시작 (모의 카메라)');
      this.schedule('scan', TIMING.scan.ms, () => {
        s.pay = 'confirm';
        s.view = 'confirm';
        this.log('가맹점 QR 인식: ' + MERCHANT.name + ' · ' + won(MERCHANT.amount));
      });
      return true;
    }

    // 스캔·금액 확인·지문 단계에서 뒤로 가기: 아무것도 보내지 않았으므로 그냥 버린다.
    abandon() {
      const s = this.state;
      if (!['scanning', 'confirm', 'auth', 'holding'].includes(s.pay)) return false;
      this.unschedule('scan');
      Object.assign(s, { pay: 'idle', view: 'home', holdMs: 0 });
      this.log('결제 진행 중단 (전송된 것 없음)');
      return true;
    }

    toAuth() {
      const s = this.state;
      if (s.pay !== 'confirm') return false;
      Object.assign(s, { pay: 'auth', view: 'auth', holdMs: 0 });
      return true;
    }

    beginHold() {
      const s = this.state;
      if (s.pay !== 'auth') return false;
      s.pay = 'holding';
      s.holdMs = 0;
      return true;
    }

    releaseHold() {
      const s = this.state;
      if (s.pay !== 'holding') return;
      s.pay = 'auth';
      s.holdMs = 0;
      this.log('지문 인증 중단 (1초 미만)');
      return '지문 인증이 완료되지 않았어요. 1초간 눌러주세요.';
    }

    cancel() {
      const s = this.state;
      if (s.pay === 'cancel_window') {
        Object.assign(s, { pay: 'cancelled', view: 'status', windowMs: 0 });
        this.log('결제 취소 · 승인 요청 보내지 않음');
        return true;
      }
      if (['requesting', 'checking', 'approved'].includes(s.pay)) {
        return '승인 요청이 이미 전송되어 취소할 수 없어요. 승인 후에는 환불 요청만 가능해요.';
      }
      return false;
    }

    // 거래번호를 만드는 유일한 곳. 진행 중 거래가 있으면 아무것도 하지 않는다.
    commit() {
      const s = this.state;
      if (s.pay !== 'cancel_window' || s.txId) return false;
      s.txId = this.nextId('TX');
      Object.assign(s, { pay: 'requesting', view: 'status', requestedAt: this.time, attempts: 0 });
      this.log(s.txId + ' 생성 · 승인 요청 시작');
      this.schedule('pendingLimit', TIMING.pendingLimit.ms, () => this.toChecking());
      this.send();
      return true;
    }

    // 같은 거래번호로 전송. 첫 요청과 재시도가 모두 이 경로를 탄다.
    send() {
      const s = this.state;
      if (!AWAITING.includes(s.pay) || s.inflight) return false;
      if (s.link !== 'online') {
        this.log(s.txId + ' 오프라인 · 연결되면 같은 번호로 재시도');
        return false;
      }
      s.attempts += 1;
      s.inflight = true;
      const id = s.txId;
      this.log(id + ' 승인 요청 전송 (' + s.attempts + '번째 시도)');
      this.schedule('uplink', TIMING.uplink.ms, () => this.serverReceive(id));
      return true;
    }

    toChecking() {
      const s = this.state;
      if (s.pay !== 'requesting') return;
      s.pay = 'checking';
      this.log(s.txId + ' 대기 10초 초과 → 확인 중 · 결과는 알림으로');
    }

    goHome() {
      const s = this.state;
      if (['scanning', 'confirm', 'auth', 'holding'].includes(s.pay)) return this.abandon();
      if (['cancel_window', 'requesting'].includes(s.pay)) return false; // 결과 전까지 화면 유지
      s.view = 'home';
      return true;
    }

    openStatus() {
      const s = this.state;
      if (!s.txId && s.pay !== 'cancelled') return false;
      s.view = 'status';
      s.notice = null;
      this.unschedule('notice');
      return true;
    }

    requestRefund() {
      const s = this.state;
      if (s.pay !== 'approved' || s.refundId) return false;
      if (s.link !== 'online') return '네트워크 연결 후 다시 시도해 주세요.';
      const id = s.txId;
      s.refundId = 'RF-' + id.slice(3);
      s.pay = 'refund_requested';
      this.log(s.refundId + ' 환불 요청 접수 (' + id + ')');
      this.schedule('refund', TIMING.refund.ms, () => {
        s.ledger[id].status = 'refunded';
        s.spent -= MERCHANT.amount;
        s.pay = 'refunded';
        this.log(s.refundId + ' 환불 완료 · ' + won(MERCHANT.amount) + ' 복원');
        this.notify('환불 완료', MERCHANT.name + ' ' + won(MERCHANT.amount) + ' 환불되었어요.');
      });
      return true;
    }

    notify(title, body) {
      this.state.notice = { title, body };
      this.schedule('notice', TIMING.notice.ms, () => { this.state.notice = null; });
    }

    // ---- 모의 서버 · 카드사 -------------------------------------------------
    serverReceive(id) {
      const s = this.state;
      const e = s.ledger[id];
      if (e) { // 같은 거래번호 재수신: 새로 처리하지 않는다 (멱등)
        e.received += 1;
        this.log('서버: ' + id + ' 재수신 → 기존 거래로 처리, 추가 출금 없음');
        if (['approved', 'declined'].includes(e.status)) this.reply(id);
        return;
      }
      s.ledger[id] = { status: 'processing', received: 1, reason: null, approvalNo: null };
      this.log('서버: ' + id + ' 수신 · 카드사 승인 요청');
      if (s.issuerDelay) {
        s.ledger[id].status = 'held';
        this.log('카드사: ' + id + ' 응답 지연 중');
      } else {
        this.schedule('issuer', TIMING.issuer.ms, () => this.issuerDecide(id));
      }
    }

    issuerDecide(id) {
      const s = this.state;
      const e = s.ledger[id];
      if (!e || !['processing', 'held'].includes(e.status)) return false;
      this.unschedule('issuer');
      if (this.balance() < MERCHANT.amount) {
        Object.assign(e, { status: 'declined', reason: '잔액 부족' });
      } else if (s.declineMode) {
        Object.assign(e, { status: 'declined', reason: '카드사 거절' });
      } else {
        s.spent += MERCHANT.amount;
        s.charges += 1;
        Object.assign(e, { status: 'approved', approvalNo: '3082' + id.slice(3) });
      }
      this.log('카드사: ' + id + (e.status === 'approved' ? ' 승인 · 출금 ' + won(MERCHANT.amount) : ' 거절 (' + e.reason + ')'));
      this.reply(id);
      return true;
    }

    // 결과를 앱으로 보낸다. 앱 연결이 끊겨 있으면 유실되고, 앱이 재시도할 때 다시 받는다.
    reply(id) {
      const s = this.state;
      if (s.link !== 'online' || s.txId !== id || !AWAITING.includes(s.pay)) return;
      this.schedule('downlink', TIMING.downlink.ms, () => this.receiveResult(id));
    }

    receiveResult(id) {
      const s = this.state;
      if (s.txId !== id || !AWAITING.includes(s.pay)) return;
      const e = s.ledger[id];
      const late = s.pay === 'checking';
      this.unschedule('pendingLimit');
      s.inflight = false;
      s.pay = e.status;
      s.result = { status: e.status, reason: e.reason, approvalNo: e.approvalNo };
      this.log(id + (e.status === 'approved' ? ' 결제 승인 수신' : ' 결제 거절 수신 (' + e.reason + ')'));
      if (late) {
        this.notify(e.status === 'approved' ? '결제 승인 완료' : '결제 실패',
          MERCHANT.name + ' ' + won(MERCHANT.amount) + (e.status === 'approved' ? ' 결제가 승인되었어요.' : ' · ' + e.reason));
      }
    }

    // ---- 발표자 콘솔 -------------------------------------------------------
    setNetwork(online) {
      const s = this.state;
      if (!online) {
        if (s.network === 'offline') return false;
        s.network = 'offline';
        s.link = 'offline';
        this.unschedule('reconnect');
        this.unschedule('uplink');   // 서버에 닿기 전 요청은 유실
        this.unschedule('downlink'); // 오는 중이던 응답도 유실
        s.inflight = false;
        this.log('네트워크 끊김' + (AWAITING.includes(s.pay) ? ' · ' + s.txId + ' 유지, 재시도 대기' : ''));
        return true;
      }
      if (s.network === 'online') return false;
      s.network = 'online';
      s.link = 'reconnecting';
      this.log('네트워크 재연결 중');
      this.schedule('reconnect', TIMING.reconnect.ms, () => {
        s.link = 'online';
        this.log('네트워크 복구');
        if (AWAITING.includes(s.pay)) this.send();
      });
      return true;
    }

    setIssuerDelay(on) {
      const s = this.state;
      s.issuerDelay = on;
      this.log('카드사 응답 지연 ' + (on ? '켬' : '끔'));
      const e = this.entry();
      if (!on && e && e.status === 'held') { // 지연을 끄면 보류된 응답이 정상 속도로 나간다
        const id = s.txId;
        e.status = 'processing';
        this.schedule('issuer', TIMING.issuer.ms, () => this.issuerDecide(id));
      }
      return true;
    }

    // 지연 중이던 카드사 응답을 지금 보낸다.
    releaseHeld() {
      const e = this.entry();
      if (!e || e.status !== 'held') return false;
      return this.issuerDecide(this.state.txId);
    }

    setDecline(on) {
      this.state.declineMode = on;
      this.log('카드사 거절 ' + (on ? '켬' : '끔'));
      return true;
    }

    setLowBalance(on) {
      this.state.lowBalance = on;
      this.log('잔액 부족 ' + (on ? '켬' : '끔') + ' · 잔액 ' + won(this.balance()));
      return true;
    }

    // ---- 자동 재생 시나리오 --------------------------------------------------
    scenarios() {
      const step = (label, duration, run = () => {}) => ({ label, duration, run });
      const roundTrip = TIMING.uplink.ms + TIMING.issuer.ms + TIMING.downlink.ms;
      // 홈 → 스캔 → 금액 확인 → 지문 → 취소 가능 3초. 마지막 단계는 정확히 승인 요청 순간에 끝난다.
      const toRequest = () => [
        step('홈 화면', 1500),
        step('가맹점 QR 스캔 (모의)', TIMING.scan.ms + 300, (sim) => sim.startScan()),
        step('결제 금액 확인', 2200),
        step('결제하기 → 지문 인증', 1200, (sim) => sim.toAuth()),
        step('지문 센서 1초 길게 누르기', TIMING.hold.ms + 200, (sim) => sim.beginHold()),
        step('3초 동안 취소 가능', TIMING.cancelWindow.ms - 200),
      ];
      return {
        A: {
          title: '정상 승인',
          summary: 'QR → 금액 → 지문 → 3초 → 승인',
          steps: [...toRequest(), step('승인 요청', roundTrip + 300), step('승인 완료', 3000)],
        },
        B: {
          title: '3초 안에 취소',
          summary: '취소하면 아무것도 전송 안 됨',
          steps: [
            ...toRequest().slice(0, -1),
            step('취소 가능 시간', 1200),
            step('취소 누름 · 전송 없음', 3000, (sim) => sim.cancel()),
          ],
        },
        C: {
          title: '응답 유실 → 같은 번호 재시도',
          summary: '네트워크 끊김, 출금은 1회',
          steps: [
            ...toRequest(),
            step('승인 요청 · 카드사 승인됨', roundTrip - TIMING.downlink.ms / 2),
            step('응답 도착 직전 네트워크 끊김', 3000, (sim) => sim.setNetwork(false)),
            step('복구 → 같은 거래번호로 재시도', TIMING.reconnect.ms + roundTrip, (sim) => sim.setNetwork(true)),
            step('기존 승인 결과 수신 · 출금 1회', 3500),
          ],
        },
        D: {
          title: '응답 지연 → 확인 중 → 알림',
          summary: '10초 넘으면 확인 중, 결과는 알림',
          steps: [
            step('카드사 응답 지연 켬', 1200, (sim) => sim.setIssuerDelay(true)),
            ...toRequest(),
            step('승인 대기 (카드사 무응답 10초)', TIMING.pendingLimit.ms + 300),
            step('확인 중 · 홈으로 나감', 2500, (sim) => sim.goHome()),
            step('카드사 응답 도착 → 승인 알림', TIMING.downlink.ms + 2600, (sim) => sim.releaseHeld()),
            step('알림 눌러 결과 확인', 3000, (sim) => sim.openStatus()),
          ],
        },
        E: {
          title: '카드사 거절',
          summary: '거절 결과, 출금 없음',
          steps: [step('카드사 거절 켬', 1200, (sim) => sim.setDecline(true)), ...toRequest(), step('승인 요청', roundTrip + 300), step('결제 실패 · 카드사 거절', 3500)],
        },
        F: {
          title: '잔액 부족',
          summary: '잔액 5,200원 → 거절',
          steps: [step('잔액 부족 켬 (5,200원)', 2000, (sim) => sim.setLowBalance(true)), ...toRequest(), step('승인 요청', roundTrip + 300), step('결제 실패 · 잔액 부족', 3500)],
        },
        G: {
          title: '승인 후 환불 요청',
          summary: '취소 대신 환불만 가능',
          steps: [
            ...toRequest(),
            step('승인 요청', roundTrip + 300),
            step('승인 완료 · 취소 버튼 없음', 2500),
            step('환불 요청', TIMING.refund.ms + 300, (sim) => sim.requestRefund()),
            step('환불 완료 · 잔액 복원', 3500),
          ],
        },
      };
    }
  }

  Object.assign(Demo, { TIMING, MERCHANT, CARD, BALANCE, won });

  if (typeof module !== 'undefined' && module.exports) module.exports = Demo;
  else root.Demo = Demo;
})(typeof window !== 'undefined' ? window : globalThis);
