// views.js — 페이링 화면, 기기 동작, 발표자 콘솔. 모든 화면은 상태의 순수 함수.
(function () {
  'use strict';
  const { html, mount, toast, clock } = DemoUI;
  const sim = new Demo();
  const { TIMING, MERCHANT, CARD, won } = Demo;

  // 도메인 메서드는 성공 시 true, 거부 시 false 또는 안내 문구를 돌려준다. 문구만 토스트로 보인다.
  const say = (result) => (typeof result === 'string' ? result : undefined);

  const PAY_LABEL = {
    idle: '대기', scanning: 'QR 스캔 중', confirm: '금액 확인', auth: '지문 인증 대기', holding: '지문 인증 중',
    cancel_window: '취소 가능 (3초)', requesting: '승인 요청 중', checking: '확인 중', approved: '승인 완료',
    declined: '거절', cancelled: '취소됨', refund_requested: '환불 요청됨', refunded: '환불 완료',
  };
  const VIEW_LABEL = { home: '홈', scan: 'QR 스캔', confirm: '결제 확인', auth: '지문 인증', status: '결제 결과' };
  const LINK_LABEL = { online: '연결됨', reconnecting: '재연결 중', offline: '끊김' };
  const onOff = (on) => (on ? '켜짐' : '꺼짐');

  // ---- 아이콘 (인라인 SVG, 외부 파일 없음) ----
  const icon = {
    back: html`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    close: html`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    qr: html`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
    bell: html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
    check: html`<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    cross: html`<svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    clock: html`<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    undo: html`<svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path d="M8 8H4V4M4.5 8A8 8 0 1112 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    store: html`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 9l1.5-4h13L20 9M4 9h16v1.5a2.7 2.7 0 01-5.3 0 2.7 2.7 0 01-5.4 0A2.7 2.7 0 014 10.5zM5.5 13v6h13v-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
    finger: html`<svg viewBox="0 0 48 48" width="76" height="76" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M12 16a14 14 0 0124 0"/><path d="M9 26a15 15 0 01.6-5"/><path d="M15 38c-2-3-3-7-3-11a12 12 0 0124 0v2"/>
      <path d="M19 41c-1.8-3-3-7-3-12a8 8 0 0116 0c0 3 0 6-1 9"/><path d="M24 29c0 5 1 9 3 13"/><path d="M36 33c-.3 2.5-1 5-2 7"/>
      <path d="M24 21a4 4 0 014 4v4"/></svg>`,
  };

  // 가상 가맹점 QR: 고정 패턴으로 그린다 (매번 같은 그림).
  const qrCode = (() => {
    const n = 21;
    const finder = (x, y) => x < 7 && y < 7;
    const inFinder = (x, y) => finder(x, y) || finder(n - 1 - x, y) || finder(x, n - 1 - y);
    const cells = [];
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (inFinder(x, y)) continue;
        if (((x * 7 + y * 13 + x * y) % 5) < 2) cells.push(html`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    }
    const eye = (x, y) => html`<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" fill="none" stroke="#111" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
    return html`<svg class="qr-code" viewBox="-1 -1 ${n + 2} ${n + 2}" aria-label="가맹점 QR (모의)"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><g fill="#111">${cells}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</g></svg>`;
  })();

  // ---- 공통 틀: 상태바 + 화면 + 푸시 알림 배너 ----
  const statusBar = (s, dark) => html`
    <div class="statusbar ${dark ? 'dark' : ''}">
      <span data-bind="clock"></span>
      <span class="sb-right">
        ${s.link === 'online' ? html`<span class="sb-net">LTE</span>` : html`<span class="sb-net off">${s.link === 'reconnecting' ? '연결 중…' : '오프라인'}</span>`}
        <svg viewBox="0 0 20 12" width="20" height="12" aria-hidden="true"><g fill="currentColor" opacity="${s.link === 'online' ? 1 : 0.3}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></g></svg>
        <span class="battery"><i></i></span>
      </span>
    </div>`;

  const banner = (s) => (s.notice ? html`
    <button class="push" data-action="open-status">
      <span class="push-app"><b class="logo-dot"></b>페이링 · 지금</span>
      <strong>${s.notice.title}</strong><span>${s.notice.body}</span>
    </button>` : '');

  const screen = (s, body, { dark = false } = {}) => html`
    <div class="screen ${dark ? 'dark' : ''}">${statusBar(s, dark)}${body}${banner(s)}</div>`;

  const topbar = (title, action = 'abandon', glyph = icon.back) => html`
    <header class="topbar"><button class="icon-btn" data-action="${action}" aria-label="뒤로">${glyph}</button><h1>${title}</h1><span></span></header>`;

  const offlineNote = (s) => (s.link === 'online' ? '' : html`
    <div class="note warn"><b>${s.link === 'reconnecting' ? '다시 연결하는 중…' : '네트워크 연결이 끊겼어요'}</b>
      ${s.txId ? html`<span>같은 거래번호 <code>${s.txId}</code>로 자동 재시도해요. 두 번 결제되지 않아요.</span>` : html`<span>연결되면 이어서 진행돼요.</span>`}</div>`);

  const details = (rows) => html`<dl class="details">${rows.filter(Boolean).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
  const txRows = (s) => [
    ['가맹점', MERCHANT.name],
    ['결제수단', CARD],
    s.txId && ['거래번호', s.txId],
    s.result && s.result.approvalNo && ['승인번호', s.result.approvalNo],
    s.refundId && ['환불번호', s.refundId],
  ];

  const recentCard = (s) => {
    if (!s.txId && s.pay !== 'cancelled') return '';
    const tone = { approved: 'ok', refunded: 'muted', declined: 'bad', cancelled: 'muted', checking: 'warn', requesting: 'warn', refund_requested: 'warn' }[s.pay] || '';
    return html`
      <section class="block"><h2 class="block-title">최근 결제</h2>
        <button class="recent" data-action="open-status">
          <span class="merchant-ic">${icon.store}</span>
          <span class="recent-main"><b>${MERCHANT.name}</b><small>${s.txId || '승인 요청 전 취소'}</small></span>
          <span class="recent-side"><b>${won(MERCHANT.amount)}</b><span class="pill ${tone}">${PAY_LABEL[s.pay]}</span></span>
        </button></section>`;
  };

  const views = {
    home: ({ state: s }) => screen(s, html`
      <header class="home-head"><span class="brand"><b class="logo-dot"></b>페이링</span><span class="icon-btn" aria-hidden="true">${icon.bell}</span></header>
      <div class="page">
        <section class="balance-card">
          <span class="card-name">${CARD}</span>
          <small>연결 계좌 잔액</small>
          <strong>${won(sim.balance())}</strong>
        </section>
        <button class="qr-pay" data-action="scan"><span class="qr-ic">${icon.qr}</span><span><b>QR 결제</b><small>가맹점 QR을 스캔해서 결제해요</small></span></button>
        ${offlineNote(s)}
        ${recentCard(s)}
      </div>`),

    scan: ({ state: s }) => screen(s, html`
      ${topbar('QR 스캔', 'abandon', icon.close)}
      <div class="scan-area">
        <div class="viewfinder"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
          ${qrCode}<i class="scan-line" data-bind="scan-line"></i></div>
        <p>${s.pay === 'scanning' ? '가맹점 QR을 사각형 안에 맞춰주세요' : '인식 완료'}</p>
        <small>모의 카메라 화면입니다</small>
      </div>`, { dark: true }),

    confirm: ({ state: s }) => screen(s, html`
      ${topbar('결제 확인')}
      <div class="page">
        <section class="merchant"><span class="merchant-ic big">${icon.store}</span><div><b>${MERCHANT.name}</b><small>가맹점 번호 ${MERCHANT.id}</small></div></section>
        <section class="amount"><small>${MERCHANT.items}</small><strong>${won(MERCHANT.amount)}</strong></section>
        ${details([['결제수단', CARD], ['할부', '일시불']])}
        ${offlineNote(s)}
      </div>
      <footer class="cta"><button class="btn primary" data-action="pay">${won(MERCHANT.amount)} 결제하기</button></footer>`),

    auth: ({ state: s }) => {
      if (s.pay === 'cancel_window') {
        return screen(s, html`
          <header class="topbar"><span></span><h1>승인 요청 대기</h1><span></span></header>
          <div class="page center">
            <div class="countdown"><span class="ring" data-bind="window-ring"></span><strong data-bind="window-seconds"></strong></div>
            <h2 class="title">곧 승인 요청을 보내요</h2>
            <p class="muted">${MERCHANT.name} · ${won(MERCHANT.amount)}<br>지금 취소하면 아무것도 결제되지 않아요.</p>
          </div>
          <footer class="cta"><button class="btn danger-outline" data-action="cancel">결제 취소</button></footer>`);
      }
      return screen(s, html`
        ${topbar('지문 인증')}
        <div class="page center">
          <p class="muted">${MERCHANT.name}</p>
          <strong class="amount-sm">${won(MERCHANT.amount)}</strong>
          <button class="finger ${s.pay === 'holding' ? 'pressing' : ''}" data-hold="finger" aria-label="지문 센서를 1초간 길게 누르기">
            <span class="ring" data-bind="hold-ring"></span>${icon.finger}
          </button>
          <h2 class="title">${s.pay === 'holding' ? '그대로 누르고 있어요…' : '지문 센서를 1초간 길게 눌러주세요'}</h2>
          <p class="muted small">손을 떼면 인증이 취소돼요 (모의 지문 센서)</p>
        </div>`);
    },

    status: ({ state: s }) => {
      const amount = html`<strong class="amount-lg">${won(MERCHANT.amount)}</strong>`;
      const home = html`<button class="btn primary" data-action="home">확인</button>`;
      const head = (tone, glyph, title, sub) => html`
        <div class="result-head"><span class="badge ${tone}">${glyph}</span><h2 class="title">${title}</h2><p class="muted">${sub}</p></div>`;
      const pages = {
        requesting: () => html`
          <div class="page center">
            <span class="spinner" data-bind="spin"></span>
            <h2 class="title">승인 요청 중</h2><p class="muted">카드사에 결제 승인을 요청하고 있어요</p>${amount}
            <div class="wait"><div class="wait-track"><i data-bind="wait-bar"></i></div><span data-bind="wait-text"></span></div>
          </div>
          <div class="page">${offlineNote(s)}${details(txRows(s))}<p class="muted small center-text">승인 요청이 전송되어 취소할 수 없어요.</p></div>`,
        checking: () => html`
          <div class="page center">${head('warn', icon.clock, '결제 확인 중', '카드사 응답이 늦어지고 있어요. 결과가 나오면 알림으로 알려드릴게요.')}${amount}</div>
          <div class="page">${offlineNote(s)}
            <div class="note"><b>중복 결제 걱정 없어요</b><span>같은 거래번호 <code>${s.txId}</code>로만 확인하기 때문에 두 번 결제되지 않아요. 이 화면을 닫아도 돼요.</span></div>
            ${details(txRows(s))}</div>
          <footer class="cta"><button class="btn primary" data-action="home">홈으로</button></footer>`,
        approved: () => html`
          <div class="page center">${head('ok', icon.check, '결제 완료', MERCHANT.name)}${amount}</div>
          <div class="page">${details(txRows(s))}
            <p class="muted small center-text">승인된 결제는 취소 대신 환불 요청으로 처리돼요.</p></div>
          <footer class="cta two"><button class="btn secondary" data-action="refund">환불 요청</button>${home}</footer>`,
        declined: () => html`
          <div class="page center">${head('bad', icon.cross, '결제 실패',
            s.result.reason === '잔액 부족' ? '연결 계좌 잔액이 부족해요' : '카드사에서 승인을 거절했어요')}${amount}</div>
          <div class="page"><div class="note"><b>출금되지 않았어요</b><span>${s.result.reason === '잔액 부족' ? '잔액 ' + won(sim.balance()) + ' · 계좌를 충전한 뒤 다시 결제해 주세요.' : '카드사에 문의하거나 다른 결제수단을 이용해 주세요.'}</span></div>
            ${details(txRows(s))}</div>
          <footer class="cta">${home}</footer>`,
        cancelled: () => html`
          <div class="page center">${head('muted', icon.cross, '결제를 취소했어요', '승인 요청을 보내지 않았어요. 결제된 금액은 없어요.')}</div>
          <footer class="cta">${home}</footer>`,
        refund_requested: () => html`
          <div class="page center"><span class="spinner" data-bind="spin"></span><h2 class="title">환불 요청 접수</h2><p class="muted">처리가 끝나면 알림으로 알려드릴게요</p>${amount}</div>
          <div class="page">${details(txRows(s))}</div>
          <footer class="cta">${home}</footer>`,
        refunded: () => html`
          <div class="page center">${head('ok', icon.undo, '환불 완료', '연결 계좌로 돌려드렸어요')}${amount}</div>
          <div class="page">${details(txRows(s))}</div>
          <footer class="cta">${home}</footer>`,
      };
      const page = pages[s.pay];
      return screen(s, html`<header class="topbar"><span></span><h1>결제</h1><span></span></header>${page ? page() : ''}`);
    },
  };

  mount({
    sim,
    views,
    homeView: 'home',
    device: { width: 390, height: 844 },
    fastKeys: ['holdMs', 'windowMs'],
    frameClass: () => '',
    entity: ({ state: s }) => (s.txId ? s.txId + ' · ' + PAY_LABEL[s.pay] : null),

    actions: {
      scan: (s) => say(s.startScan()),
      abandon: (s) => { s.abandon(); },
      pay: (s) => { s.toAuth(); },
      cancel: (s) => say(s.cancel()),
      home: (s) => { s.goHome(); },
      refund: (s) => say(s.requestRefund()),
      'open-status': (s) => { s.openStatus(); },
    },
    holds: {
      finger: {
        start: (s) => s.beginHold(),
        end: (s) => { const message = s.releaseHold(); if (message) toast(message); },
      },
    },
    bind: {
      clock: (s, el) => { el.textContent = clock(s.time).slice(0, 5); },
      'hold-ring': (s, el) => el.style.setProperty('--progress', Math.min(1, s.state.holdMs / TIMING.hold.ms)),
      'window-ring': (s, el) => el.style.setProperty('--progress', s.state.windowMs / TIMING.cancelWindow.ms),
      'window-seconds': (s, el) => { el.textContent = Math.ceil(s.state.windowMs / 1000); },
      'wait-bar': (s, el) => { el.style.width = Math.min(1, (s.time - s.state.requestedAt) / TIMING.pendingLimit.ms) * 100 + '%'; },
      'wait-text': (s, el) => { el.textContent = '승인 대기 ' + Math.min(10, Math.floor((s.time - s.state.requestedAt) / 1000)) + '초 / 10초'; },
      spin: (s, el) => { el.style.transform = 'rotate(' + ((s.time * 0.4) % 360) + 'deg)'; },
      'scan-line': (s, el) => {
        const job = s.jobs.find((j) => j.key === 'scan');
        el.style.setProperty('--p', job ? 1 - (job.at - s.time) / TIMING.scan.ms : 1);
      },
    },

    controls: [
      ['네트워크', [
        { label: '네트워크 끊기', key: 'o', tone: 'danger', run: (s) => s.setNetwork(false), fail: '이미 끊겨 있어요.' },
        { label: '네트워크 복구', key: 'i', run: (s) => s.setNetwork(true), fail: '이미 연결되어 있어요.' },
      ]],
      ['카드사 응답', [
        { label: '응답 지연 켜기·끄기', key: 'd', run: (s) => s.setIssuerDelay(!s.state.issuerDelay) },
        { label: '지연된 응답 지금 도착', key: 'a', run: (s) => s.releaseHeld(), fail: '지연 중인 카드사 응답이 없어요. 응답 지연을 켜고 승인 요청을 보내 보세요.' },
        { label: '거절 켜기·끄기', key: 'x', tone: 'danger', run: (s) => s.setDecline(!s.state.declineMode) },
        { label: '잔액 부족 켜기·끄기', key: 'b', tone: 'danger', run: (s) => s.setLowBalance(!s.state.lowBalance) },
      ]],
      ['앱 대신 누르기', [
        { label: '결제 취소', key: 'c', run: (s) => s.cancel(), fail: '3초 취소 가능 시간에만 취소할 수 있어요.' },
        { label: '환불 요청', key: 'f', run: (s) => s.requestRefund(), fail: '승인 완료된 결제에서 한 번만 요청할 수 있어요.' },
      ]],
    ],
    readout: ({ state: s }) => {
      const e = s.txId && s.ledger[s.txId];
      return {
        화면: VIEW_LABEL[s.view],
        결제상태: PAY_LABEL[s.pay],
        거래번호: s.txId || '—',
        요청시도: s.attempts + '회',
        서버수신: (e ? e.received : 0) + '회',
        출금횟수: s.charges + '회',
        네트워크: LINK_LABEL[s.link],
        응답지연: onOff(s.issuerDelay),
        카드사거절: onOff(s.declineMode),
        잔액부족: onOff(s.lowBalance),
        잔액: won(sim.balance()),
        알림: s.notice ? s.notice.title : '—',
      };
    },
  });
})();
