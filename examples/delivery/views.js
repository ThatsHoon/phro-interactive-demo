// views.js — 데모배달 화면, 기기 액션, 발표자 콘솔 구성.
// 모든 화면은 상태의 순수 함수. 매 프레임 바뀌는 값(시계, 진행률, 라이더 위치)은 data-bind로 칠한다.
(function () {
  'use strict';
  const { html, mount } = DemoUI;
  const sim = new Demo();
  const { TIMING, MIN, PLACES, ORDER, won } = Demo;

  // 이야기 시계: 19:00 시작, 데모 1초 = 1분
  const storyClock = (ms) => {
    const total = 19 * 60 + Math.floor(ms / MIN);
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
  const minutes = (ms) => Math.max(0, Math.floor(ms / MIN));

  const ORDER_LABEL = {
    none: '없음', placed: '주문 접수', accepted: '가게 수락', cooking: '조리 중', ready: '조리 완료·라이더 대기',
    delivering: '배달 중', delivered: '배달 완료', rejected: '가게 거절', cancelled: '고객 취소',
  };
  const DISPATCH_LABEL = { idle: '대기 전', searching: '배차 중', assigned: '가게로 이동', at_store: '가게 도착', done: '픽업 완료' };
  const CHANGE_LABEL = { pending: '라이더 확인 대기', approved: '승인', declined: '거절', expired: '만료' };
  const REVIEW_LABEL = { none: '-', requested: '요청됨', done: '작성 완료' };
  const TOWARD = { home: '집으로', office: '회사로' };
  const STEPS = ['접수', '수락', '조리', '배달', '완료'];
  const STEP_INDEX = { placed: 0, accepted: 1, cooking: 2, ready: 2, delivering: 3, delivered: 4 };

  const statusBar = html`<div class="statusbar"><b data-bind="clock"></b><span>LTE · 92%</span></div>`;
  const btn = (label, action, tone = 'secondary') => html`<button class="btn ${tone}" data-action="${action}">${label}</button>`;
  const flash = html`<div class="flash" data-bind="flash" role="status" hidden></div>`;

  function statusText(s) {
    switch (s.order) {
      case 'placed': return ['주문 접수 완료', '가게에서 주문을 확인하고 있어요'];
      case 'accepted': return ['가게가 주문을 수락했어요', '곧 조리를 시작해요. 지금은 취소할 수 있어요'];
      case 'cooking': return ['조리 중이에요', '한입분식에서 맛있게 만들고 있어요'];
      case 'ready': return ['조리 완료', s.dispatch === 'searching' ? '라이더 배차를 기다리고 있어요' : '라이더가 음식을 가지러 가고 있어요'];
      case 'delivering': return ['배달 중이에요', TOWARD[s.address] + ' 이동하고 있어요'];
      case 'delivered': return ['배달 완료', '맛있게 드세요!'];
      case 'rejected': return ['가게가 주문을 받지 못했어요', '재료 소진으로 거절되어 자동 환불됐어요'];
      case 'cancelled': return ['주문을 취소했어요', '결제 금액이 자동 환불됐어요'];
      default: return ['', ''];
    }
  }

  function etaLine(sim) {
    const s = sim.state;
    if (s.order === 'delivered') return html`<p class="eta">${storyClock(s.deliveredAt)} 도착</p>`;
    const eta = sim.eta();
    if (!eta || !(s.order in STEP_INDEX)) return '';
    if (eta.exact !== undefined) return html`<p class="eta">도착 예정 <b>${storyClock(eta.exact)}</b> · <span data-bind="remaining"></span></p>`;
    return html`<p class="eta ${s.delayNotice ? 'late' : ''}">도착 예정 <b>${storyClock(eta.from)} ~ ${storyClock(eta.to)}</b>${s.delayNotice ? ' (지연)' : ''}</p>`;
  }

  const stepper = (s) => {
    const at = STEP_INDEX[s.order];
    if (at === undefined) return '';
    return html`<ol class="stepper">${STEPS.map((label, i) => html`<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i></i><span>${label}</span></li>`)}</ol>`;
  };

  // ---- 가상 지도 --------------------------------------------------------------------
  const XS = [0, 20, 60, 135, 200, 290, 340];
  const YS = [0, 60, 90, 150, 230, 250, 290];
  const blocks = [];
  for (let i = 0; i < XS.length - 1; i += 1) {
    for (let j = 0; j < YS.length - 1; j += 1) {
      const w = XS[i + 1] - XS[i] - 12;
      const h = YS[j + 1] - YS[j] - 12;
      if (w > 4 && h > 4) blocks.push(html`<rect class="${(i + j) % 5 === 2 ? 'park' : 'block'}" x="${XS[i] + 6}" y="${YS[j] + 6}" width="${w}" height="${h}" rx="4"/>`);
    }
  }
  const streets = 'M0 ' + YS.slice(1, -1).join('H340M0 ') + 'H340' + XS.slice(1, -1).map((x) => 'M' + x + ' 0V290').join('');

  const pin = (place, cls, label) => html`<g class="pin ${cls}" transform="translate(${place.at[0]} ${place.at[1]})"><circle r="8"/><text y="-13">${label}</text></g>`;

  function map(sim) {
    const s = sim.state;
    const lost = s.riderLink === 'lost';
    const route = s.leg ? 'M' + s.leg.path.map((p) => p.join(' ')).join('L') : '';
    const office = s.addressChange && s.addressChange.status !== 'expired' ? s.addressChange.status : null;
    return html`<div class="map-card">
      <svg class="map" viewBox="0 0 340 290" role="img" aria-label="라이더 위치 (가상 지도)">
        <rect class="map-bg" width="340" height="290"/>
        ${blocks}
        <path class="street" d="${streets}"/>
        ${route ? html`<path class="route ${s.leg.kind}" d="${route}"/>` : ''}
        ${pin(PLACES.store, 'store', PLACES.store.label)}
        ${pin(PLACES.home, s.address === 'home' ? 'dest' : 'muted', PLACES.home.label)}
        ${office ? pin(PLACES.office, office === 'approved' ? 'dest' : office === 'pending' ? 'ghost' : 'muted', PLACES.office.label + (office === 'pending' ? '?' : '')) : ''}
        <g class="rider ${lost ? 'lost' : ''}" data-bind="rider" visibility="hidden">
          <circle class="halo" r="15"/><circle class="dot" r="8"/>
          ${lost ? html`<text y="26">마지막 위치</text>` : ''}
        </g>
      </svg>
      ${lost ? html`<p class="map-warn">라이더 통신이 끊겼어요 · <span data-bind="last-seen"></span> 위치</p>` : ''}
    </div>`;
  }

  function riderCard(s) {
    if (s.dispatch === 'idle') return '';
    if (s.dispatch === 'searching') {
      return html`<div class="card rider-card searching"><div class="avatar spin"></div><div>
        <b>라이더를 찾고 있어요</b><p class="muted">배차 대기 <span data-bind="search-timer"></span>${s.ridersAvailable ? '' : ' · 주변 라이더가 부족해요'}</p></div></div>`;
    }
    const where = { assigned: '가게로 이동 중', at_store: '가게에서 음식을 기다리는 중', done: s.order === 'delivered' ? '배달을 마쳤어요' : TOWARD[s.address] + ' 배달 중' }[s.dispatch];
    return html`<div class="card rider-card"><div class="avatar">${s.rider.name[0]}</div><div class="grow">
        <b>${s.rider.name} 라이더 · ${s.rider.vehicle}</b><p class="muted">${where}</p>
        ${s.riderLink === 'lost' ? html`<p class="warn-text">통신이 잠시 끊겼어요. 마지막 위치를 보여드려요</p>` : ''}
      </div><button class="chip" data-action="call-rider">전화</button></div>`;
  }

  function addressCard(s) {
    const req = s.addressChange;
    const dest = PLACES[s.address];
    const line = html`<p class="addr"><b>배달 주소 · ${dest.label}</b><span>${dest.line}</span></p>`;
    if (!req) {
      return html`<div class="card">${line}${s.order === 'delivering' ? btn('배달 주소 변경 요청', 'request-address') : ''}</div>`;
    }
    const msg = {
      pending: ['회사로 주소 변경을 요청했어요', s.riderLink === 'lost' ? '라이더 통신이 복구되면 확인돼요' : '라이더 확인을 기다리고 있어요. 승인 전까지는 기존 주소로 이동해요'],
      approved: ['라이더가 주소 변경을 수락했어요', '회사로 경로를 바꿨어요'],
      declined: ['라이더가 주소 변경을 거절했어요', '기존 주소(집)로 배달해요'],
      expired: ['주소가 변경되지 않았어요', '라이더가 이미 기존 주소에 도착했어요'],
    }[req.status];
    return html`<div class="card notice ${req.status}"><b>${msg[0]}</b><p class="muted">${msg[1]}</p>${line}</div>`;
  }

  const refundCard = (s) => html`<div class="card refund"><span class="pill ok">자동 환불 완료</span>
    <h2>${won(s.refund.amount)}</h2><p class="muted">사유: ${s.refund.reason} · 데모카드 결제 취소 (가짜)</p>
    <p class="fine">실제 카드사 반영은 3~5영업일 걸린다는 안내가 함께 나가요</p></div>`;

  const delayCard = (s) => html`<div class="card delay"><b>배차가 늦어지고 있어요</b>
    <p class="muted">주변 라이더가 부족해 10분 정도 늦어질 수 있어요. 죄송한 마음을 담아 쿠폰을 드렸어요.</p>
    <div class="coupon"><b>${won(s.coupon.amount)}</b><span>다음 주문 할인 쿠폰 · ${s.coupon.id}</span></div></div>`;

  function reviewCard(s) {
    if (s.review === 'requested') {
      return html`<div class="card review"><b>맛있게 드셨나요?</b><p class="muted">한입분식에 리뷰를 남겨주세요</p>
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => html`<button data-action="rate" data-rating="${n}" aria-label="${n}점">★</button>`)}</div></div>`;
    }
    if (s.review === 'done') return html`<div class="card review"><b>리뷰 고마워요!</b><p class="stars-static">${'★'.repeat(s.rating)}${'☆'.repeat(5 - s.rating)}</p></div>`;
    return '';
  }

  function cancelArea(s) {
    if (['placed', 'accepted'].includes(s.order)) return btn('주문 취소', 'cancel-order', 'danger-outline');
    if (['cooking', 'ready'].includes(s.order)) {
      return html`<button class="btn disabled-look" data-action="cancel-order" aria-describedby="cancel-note">주문 취소</button>
        <p class="fine center" id="cancel-note">조리가 시작되어 앱에서 취소할 수 없어요</p>`;
    }
    return '';
  }

  const orderSummary = (s) => html`<div class="card summary"><div class="row"><span>${s.orderId}</span><span>${ORDER.store}</span></div>
    ${ORDER.items.map((i) => html`<div class="row"><span>${i.name} × ${i.qty}</span><span>${won(i.price * i.qty)}</span></div>`)}
    <div class="row"><span>배달팁</span><span>${won(ORDER.tip)}</span></div>
    <div class="row total"><span>결제 금액</span><span>${won(ORDER.total)}</span></div></div>`;

  const views = {
    menu: (sim) => {
      const s = sim.state;
      const active = sim.active();
      return html`${statusBar}
        <header class="hero"><div class="hero-art" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="hero-info"><h1>한입분식</h1><p>★ 4.8 · 배달 30~40분 · 배달팁 ${won(ORDER.tip)}</p></div></header>
        <div class="page">
          ${active ? html`<button class="card active-order" data-action="track"><span class="pill ok">${ORDER_LABEL[s.order]}</span><b>진행 중인 주문 ${s.orderId} 보기 ›</b></button>` : ''}
          <div class="card summary"><h2>장바구니</h2>
            ${ORDER.items.map((i) => html`<div class="row"><span>${i.name} × ${i.qty}</span><span>${won(i.price * i.qty)}</span></div>`)}
            <div class="row"><span>배달팁</span><span>${won(ORDER.tip)}</span></div>
            <div class="row total"><span>합계</span><span>${won(ORDER.total)}</span></div></div>
          <div class="card"><p class="addr"><b>배달 주소 · ${PLACES.home.label}</b><span>${PLACES.home.line}</span></p></div>
          <button class="btn primary ${active ? 'disabled-look' : ''}" data-action="place-order">${won(ORDER.total)} 주문하기</button>
          <p class="fine center">데모 결제 · 실제로 결제되지 않아요</p>
        </div>${flash}`;
    },

    track: (sim) => {
      const s = sim.state;
      if (s.order === 'none') return views.menu(sim);
      const [title, sub] = statusText(s);
      const ended = ['rejected', 'cancelled'].includes(s.order);
      return html`${statusBar}
        <header class="app-header"><button class="back" data-action="menu" aria-label="뒤로">‹</button><div><h1>주문 현황</h1><p>${s.orderId} · 한입분식</p></div></header>
        <div class="page">
          <section class="status ${s.order}"><h2>${title}</h2><p>${sub}</p>${etaLine(sim)}
            ${s.order === 'cooking' ? html`<div class="bar"><i data-bind="cook-bar"></i></div>` : ''}
            ${stepper(s)}</section>
          ${reviewCard(s)}
          ${s.refund ? refundCard(s) : ''}
          ${s.delayNotice ? delayCard(s) : ''}
          ${s.leg ? map(sim) : ''}
          ${ended ? '' : riderCard(s)}
          ${ended ? '' : addressCard(s)}
          ${cancelArea(s)}
          ${ended || s.review === 'done' ? btn('다른 메뉴 둘러보기', 'menu', 'primary') : ''}
          ${orderSummary(s)}
        </div>${flash}`;
    },
  };

  mount({
    sim,
    views,
    homeView: 'menu',
    device: { width: 390, height: 844 },
    entity: (sim) => sim.state.orderId,

    actions: {
      'place-order': (sim) => { if (!sim.placeOrder()) return '이미 진행 중인 주문이 있어요'; },
      menu: (sim) => { sim.state.view = 'menu'; },
      track: (sim) => { sim.state.view = 'track'; },
      'cancel-order': (sim) => { sim.cancel(); }, // 거부 사유는 앱 안내 문구로 표시
      'request-address': (sim) => { if (!sim.requestAddressChange()) return '배달 중에만, 주문당 한 번 요청할 수 있어요'; },
      rate: (sim, el) => { sim.submitReview(Number(el.dataset.rating)); },
      'call-rider': () => '데모에서는 실제로 연결되지 않아요',
    },

    bind: {
      clock: (sim, el) => { el.textContent = storyClock(sim.time); },
      'cook-bar': (sim, el) => { el.style.width = Math.min(100, ((sim.time - sim.state.cookStartAt) / TIMING.cooking.ms) * 100) + '%'; },
      'search-timer': (sim, el) => {
        const sec = Math.floor(((sim.time - sim.state.searchStartAt) / MIN) * 60);
        el.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      },
      remaining: (sim, el) => {
        const eta = sim.eta();
        const left = eta && eta.exact !== undefined ? Math.ceil((eta.exact - sim.time) / MIN) : 0;
        el.textContent = left > 0 ? left + '분 남음' : '곧 도착';
      },
      rider: (sim, el) => {
        const p = sim.displayPos();
        if (!p) { el.setAttribute('visibility', 'hidden'); return; }
        el.setAttribute('visibility', 'visible');
        el.setAttribute('transform', 'translate(' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ')');
      },
      'last-seen': (sim, el) => {
        const m = sim.state.lastFix ? minutes(sim.time - sim.state.lastFix.at) : 0;
        el.textContent = m === 0 ? '방금 전' : m + '분 전';
      },
      flash: (sim, el) => {
        const f = sim.state.flash;
        const show = !!f && sim.time < f.until;
        if (el.hidden === show) el.hidden = !show;
        if (show && el.textContent !== f.text) el.textContent = f.text;
      },
    },

    controls: [
      ['고객', [
        { label: '주문하기', key: 'o', run: (sim) => sim.placeOrder(), fail: '이미 진행 중인 주문이 있어요' },
        { label: '주문 취소 요청', key: 'c', run: (sim) => sim.cancel() }, // 거부 사유는 기기 화면에 표시
        { label: '주소 변경 요청 (회사)', key: 'm', run: (sim) => sim.requestAddressChange(), fail: '배달 중에만, 주문당 한 번 요청할 수 있어요' },
      ]],
      ['가게', [
        { label: '수락', key: 'a', run: (sim) => sim.storeAccept(), fail: '주문 접수 상태에서만 수락할 수 있어요' },
        { label: '거절 → 자동 환불', key: 'x', tone: 'danger', run: (sim) => sim.storeReject(), fail: '주문 접수 상태에서만 거절할 수 있어요' },
        { label: '조리 시작', key: 's', run: (sim) => sim.startCooking(), fail: '가게 수락 후에만 조리를 시작할 수 있어요' },
      ]],
      ['라이더 · 환경', [
        { label: '라이더 부족 ↔ 정상', key: 'd', run: (sim) => sim.setRidersAvailable(!sim.state.ridersAvailable) },
        { label: '통신 끊김 ↔ 복구', key: 'l', run: (sim) => sim.setRiderLink(sim.state.riderLink === 'lost'), fail: '배차된 라이더가 이동 중일 때만 바꿀 수 있어요' },
        { label: '주소 변경 승인', key: 'y', run: (sim) => sim.riderRespond(true), fail: '확인 대기 중인 요청이 없거나 라이더 통신이 끊겨 있어요' },
        { label: '주소 변경 거절', key: 'u', tone: 'danger', run: (sim) => sim.riderRespond(false), fail: '확인 대기 중인 요청이 없거나 라이더 통신이 끊겨 있어요' },
      ]],
    ],
    toggles: [
      { label: '가게 자동 응답 (끄면 수락·거절·조리 시작을 직접)', get: (sim) => sim.state.autoStore, set: (sim, on) => sim.setAutoStore(on) },
    ],
    readout: (sim) => {
      const s = sim.state;
      return {
        '이야기 시각': storyClock(sim.time) + (s.placedAt !== null ? ' (주문 +' + minutes(sim.time - s.placedAt) + '분)' : ''),
        화면: s.view === 'menu' ? '메뉴' : '주문 현황',
        주문: ORDER_LABEL[s.order],
        배차: DISPATCH_LABEL[s.dispatch],
        '라이더 통신': s.riderLink === 'lost' ? '끊김' : '연결',
        '라이더 수급': s.ridersAvailable ? '원활' : '부족',
        '가게 응답': s.autoStore ? '자동' : '수동',
        배송지: PLACES[s.address].label,
        '주소 변경': s.addressChange ? CHANGE_LABEL[s.addressChange.status] : '-',
        쿠폰: s.coupon ? won(s.coupon.amount) : '-',
        환불: s.refund ? won(s.refund.amount) : '-',
        리뷰: REVIEW_LABEL[s.review] + (s.rating ? ' ' + s.rating + '점' : ''),
      };
    },
  });
})();
