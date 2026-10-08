// views.js — screens, device actions and presenter controls. REPLACE with the real app.
// Each view is a pure function of state. Use html`` (auto-escaping) for every template.
(function () {
  'use strict';
  const { html, mount } = DemoUI;
  const sim = new Demo();
  const { TIMING } = Demo;

  const header = (title, sub, back) => html`
    <header class="app-header">
      ${back ? html`<button class="back" data-action="back" aria-label="Back">‹</button>` : ''}
      <div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div>
    </header>`;
  const button = (label, action, tone = 'secondary') => html`<button class="btn ${tone}" data-action="${action}">${label}</button>`;
  const status = (s) => (s.link === 'online' ? 'Online' : s.link === 'reconnecting' ? 'Reconnecting…' : 'Offline');

  const views = {
    home: ({ state: s }) => html`
      ${header('Demo App', 'Replace with the real home screen')}
      <div class="page">
        <div class="card"><span class="pill ${s.link === 'online' ? 'ok' : 'warn'}">${status(s)}</span>
          <h2>${s.requestId && s.request !== 'idle' ? 'Request ' + s.requestId + ': ' + s.request : 'No active request'}</h2>
          <p>Connection changes never create a second request.</p></div>
        ${button('Make a request', 'open-request', 'primary')}
        ${button('About', 'about')}
      </div>`,

    request: ({ state: s }) => {
      if (['idle', 'holding'].includes(s.request)) {
        return html`${header('New request', 'Keep pressing. Releasing stops it.', true)}
          <div class="page center">
            <button class="hold" data-hold="request" aria-label="Press and hold to request">
              <span class="hold-ring" data-bind="hold-ring"></span><strong>HOLD</strong>
            </button>
            <p class="muted">Hold for ${TIMING.hold.ms / 1000}s. Accidental taps do nothing.</p>
          </div>`;
      }
      if (s.request === 'cancel_window') {
        return html`${header('Sending soon', 'You can still cancel.')}
          <div class="page center">
            <div class="countdown"><span class="hold-ring" data-bind="window-ring"></span><strong data-bind="window-seconds"></strong></div>
            ${button('Cancel', 'cancel')}
          </div>`;
      }
      const titles = { queued: 'Waiting for connection', sending: 'Sending…', accepted: 'Accepted', cancelled: 'Cancelled', completed: 'Completed' };
      const done = ['cancelled', 'completed'].includes(s.request);
      return html`${header(titles[s.request], s.requestId)}
        <div class="page">
          <div class="card"><span class="pill ${s.link === 'online' ? 'ok' : 'warn'}">${status(s)}</span>
            <p>${s.request === 'queued' ? 'Saved on this device. It sends automatically when the connection returns.' : 'Same request id across every connection change.'}</p></div>
          ${['queued', 'sending'].includes(s.request) ? button('Cancel request', 'cancel') : ''}
          ${done ? button('Home', 'home', 'primary') : ''}
        </div>`;
    },

    about: () => html`${header('About', 'Demo only', true)}
      <div class="page"><div class="card"><p>No real network, location or payment is used.</p></div></div>`,
  };

  mount({
    sim,
    views,
    homeView: 'home',
    device: { width: 390, height: 844 },
    fastKeys: ['holdMs', 'windowMs'],
    frameClass: (s) => (['holding', 'cancel_window', 'queued', 'sending'].includes(s.state.request) ? 'alert' : ''),
    entity: (s) => s.state.requestId,

    actions: {
      home: (s) => { s.state.view = 'home'; },
      'open-request': (s) => s.openRequest(),
      cancel: (s) => { if (!s.cancel()) return 'This request can no longer be cancelled.'; },
    },
    holds: {
      request: { start: (s) => s.beginHold(), end: (s) => s.releaseHold() },
    },
    bind: {
      'hold-ring': (s, el) => el.style.setProperty('--progress', Math.min(1, s.state.holdMs / TIMING.hold.ms)),
      'window-ring': (s, el) => el.style.setProperty('--progress', s.state.windowMs / TIMING.cancelWindow.ms),
      'window-seconds': (s, el) => { el.textContent = Math.ceil(s.state.windowMs / 1000); },
    },

    controls: [
      ['Environment', [
        { label: 'Go offline', key: 'o', run: (s) => s.setNetwork(false) },
        { label: 'Back online', key: 'i', run: (s) => s.setNetwork(true) },
      ]],
      ['Counterpart', [
        { label: 'Accept', key: 'a', run: (s) => s.respond(), fail: 'Needs a request that is being sent while online.' },
        { label: 'Complete', key: 'c', run: (s) => s.complete(), fail: 'Needs an accepted request.' },
      ]],
    ],
    toggles: [
      { label: 'Counterpart responds automatically', get: (s) => s.state.autoRespond, set: (s, on) => s.setAutoRespond(on) },
    ],
    readout: ({ state: s }) => ({ View: s.view, Request: s.request, Network: s.network, Link: s.link, Attempts: s.attempts }),
  });
})();
