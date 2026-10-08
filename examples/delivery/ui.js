// ui.js — domain-neutral rendering runtime and presenter console. Usually left unchanged.
// views.js calls DemoUI.mount({...}) with the screens, actions and console controls.
(function (root) {
  'use strict';

  // ---- safe templating -----------------------------------------------------
  // html`...` escapes every interpolated value unless it is itself html`` output.
  class Raw {
    constructor(text) { this.text = text; }
    toString() { return this.text; }
  }
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const piece = (value) => {
    if (value === null || value === undefined || value === false) return '';
    if (value instanceof Raw) return value.text;
    if (Array.isArray(value)) return value.map(piece).join('');
    return esc(value);
  };
  function html(strings, ...values) {
    let out = strings[0];
    values.forEach((value, i) => { out += piece(value) + strings[i + 1]; });
    return new Raw(out);
  }

  const $ = (id) => document.getElementById(id);
  let config;
  let sim;
  const history = [];
  let lastSignature = '';
  let lastEventKey = '';
  let toastTimer;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // Simple back stack for in-app navigation.
  function go(view) {
    if (sim.state.view !== view) history.push(sim.state.view);
    sim.state.view = view;
  }
  function back() {
    sim.state.view = history.pop() || config.homeView || 'home';
  }

  const clock = (ms) => {
    const d = new Date(sim.epoch + ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  };

  // Values listed in fastKeys change every frame; they are patched in place through
  // data-bind instead of rebuilding the screen, so nothing flickers or loses focus.
  function signature() {
    const slow = {};
    for (const [key, value] of Object.entries(sim.state)) {
      if (!config.fastKeys.includes(key)) slow[key] = value;
    }
    return JSON.stringify([slow, sim.paused]);
  }

  function renderDevice(force) {
    const app = $('app');
    const sig = signature();
    if (force || sig !== lastSignature) {
      lastSignature = sig;
      const focused = app.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      const view = config.views[sim.state.view] || config.views[config.homeView || 'home'];
      app.innerHTML = String(view(sim));
      if (sim.paused) app.insertAdjacentHTML('beforeend', String(html`<div class="paused-badge">${sim.t('pausedBadge')}</div>`));
      $('device').className = 'device ' + (config.frameClass ? config.frameClass(sim) : '');
      if (focused) {
        const match = [...app.querySelectorAll('[data-action],[data-hold]')].find((el) => focusKey(el) === focused);
        if (match) match.focus({ preventScroll: true });
      }
    }
    for (const el of document.querySelectorAll('[data-bind]')) {
      const binder = config.bind[el.dataset.bind];
      if (binder) binder(sim, el);
    }
  }
  const focusKey = (el) => (el.dataset.action ? 'a:' + el.dataset.action : el.dataset.hold ? 'h:' + el.dataset.hold : null);

  function renderConsole() {
    const sc = sim.scenario;
    const step = sc && sc.steps[sc.index];
    $('scenario-name').textContent = sc ? sc.key + ' · ' + sc.title + (sc.done ? ' · ' + sim.t('done') : '') : sim.t('manualTitle');
    $('scenario-step').textContent = sc ? (sc.index + 1) + '/' + sc.steps.length + ' · ' + step.label : sim.t('manualHint');
    const progress = sc ? (sc.done ? 1 : (sc.index + Math.min(1, sc.elapsed / step.duration)) / sc.steps.length) : 0;
    $('scenario-progress').style.width = progress * 100 + '%';
    $('pause').textContent = sim.t(sim.paused ? 'resume' : 'pause') + ' (P)';
    $('pause').setAttribute('aria-pressed', String(sim.paused));
    $('next').disabled = !(sc && !sc.done) && !sim.nextEventIn();
    for (const el of document.querySelectorAll('[data-scenario]')) el.classList.toggle('active', !!sc && sc.key === el.dataset.scenario);
    for (const el of document.querySelectorAll('[data-toggle]')) el.checked = config.toggles[+el.dataset.toggle].get(sim);
    $('entity-tag').textContent = (config.entity && config.entity(sim)) || sim.t('noEntity');
    $('readout').innerHTML = Object.entries(config.readout(sim))
      .map(([key, value]) => String(html`<div><dt>${key}</dt><dd>${value}</dd></div>`)).join('');
    $('sim-clock').textContent = clock(sim.time) + (sim.paused ? ' · ' + sim.t('clockPaused') : '');
    const eventKey = sim.events.length + '|' + (sim.events[0] && sim.events[0].at) + '|' + (sim.events[0] && sim.events[0].message);
    if (eventKey !== lastEventKey) {
      lastEventKey = eventKey;
      $('timeline').innerHTML = sim.events
        .map((e) => String(html`<li><time>${clock(e.at)}</time><span>${e.message}</span></li>`)).join('');
    }
  }

  function render(force) {
    renderDevice(force);
    renderConsole();
  }

  // ---- device input ----------------------------------------------------------
  function bindDevice() {
    const app = $('app');
    const device = $('device');
    app.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const name = target.dataset.action;
      if (name === 'back') back();
      else if (config.actions[name]) {
        const result = config.actions[name](sim, target);
        if (typeof result === 'string') toast(result); // actions return a message when refused
      } else if (config.views[name]) go(name);
      render();
    });

    // Press-and-hold: pointer capture, cancel when the pointer leaves, keyboard support.
    let held = null; // { name, pointerId | 'key' }
    const end = () => {
      if (!held) return;
      const { name, pointerId } = held;
      held = null;
      if (pointerId !== 'key' && device.hasPointerCapture(pointerId)) device.releasePointerCapture(pointerId);
      config.holds[name].end(sim);
      render();
    };
    device.addEventListener('pointerdown', (event) => {
      const target = event.target.closest('[data-hold]');
      if (!target || event.button !== 0) return;
      event.preventDefault();
      held = { name: target.dataset.hold, pointerId: event.pointerId };
      device.setPointerCapture(event.pointerId);
      config.holds[held.name].start(sim);
      render();
    });
    device.addEventListener('pointermove', (event) => {
      if (!held || held.pointerId === 'key') return;
      const target = app.querySelector('[data-hold="' + held.name + '"]');
      const r = target && target.getBoundingClientRect();
      if (r && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) end();
    });
    device.addEventListener('pointerup', end);
    device.addEventListener('pointercancel', end);
    device.addEventListener('contextmenu', (event) => { if (event.target.closest('[data-hold]')) event.preventDefault(); });
    app.addEventListener('keydown', (event) => {
      const target = event.target.closest('[data-hold]');
      if (!target || ![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.repeat || held) return;
      held = { name: target.dataset.hold, pointerId: 'key' };
      config.holds[held.name].start(sim);
      render();
    });
    window.addEventListener('keyup', (event) => { if ([' ', 'Enter'].includes(event.key) && held && held.pointerId === 'key') end(); });
    window.addEventListener('blur', end);
    document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
  }

  // ---- presenter console -----------------------------------------------------
  function runControl(item) {
    sim.stopScenario(); // manual intervention ends autoplay, state stays
    const result = item.run(sim);
    if (result === false && item.fail) toast(item.fail); // guarded action refused
    else if (typeof result === 'string') toast(result);
  }

  function playback(kind) {
    if (kind === 'pause') sim.togglePause();
    else if (kind === 'next') sim.advance();
    else if (kind === 'reset') { history.length = 0; sim.reset(); }
  }

  function buildConsole() {
    const scenarios = sim.scenarios();
    $('presets').innerHTML = Object.entries(scenarios)
      .map(([key, s], i) => String(html`<button class="preset" data-scenario="${key}" title="${i < 9 ? '⌨ ' + (i + 1) : ''}"><b>${key}</b><span>${s.title}<small>${s.summary || ''}</small></span></button>`)).join('');
    $('controls').innerHTML = config.controls
      .map(([group, items], g) => String(html`<div class="control-group"><h3>${group}</h3><div class="control-buttons">${items.map((item, i) => html`<button data-control="${g}:${i}" class="${item.tone || ''}">${item.label}${item.key ? html` <kbd>${item.key.toUpperCase()}</kbd>` : ''}</button>`)}</div></div>`)).join('');
    $('toggles').innerHTML = (config.toggles || [])
      .map((t, i) => String(html`<label class="toggle"><input type="checkbox" data-toggle="${i}"> ${t.label}</label>`)).join('');

    document.querySelector('.console').addEventListener('click', (event) => {
      const preset = event.target.closest('[data-scenario]');
      const control = event.target.closest('[data-control]');
      const play = event.target.closest('[data-play]');
      if (preset) {
        history.length = 0;
        sim.runScenario(preset.dataset.scenario);
      } else if (control) {
        const [g, i] = control.dataset.control.split(':').map(Number);
        runControl(config.controls[g][1][i]);
      } else if (play) {
        playback(play.dataset.play);
      } else return;
      render(true);
    });
    document.querySelector('.console').addEventListener('change', (event) => {
      const el = event.target.closest('[data-toggle]');
      if (!el) return;
      sim.stopScenario(); // a toggle is a manual intervention too
      config.toggles[+el.dataset.toggle].set(sim, el.checked);
      render(true);
    });

    // Keyboard shortcuts work in presentation mode too, where the console is hidden:
    // P pause/resume, N next step, R reset, 1-9 scenarios, plus each control's `key`.
    const scenarioKeys = Object.keys(scenarios);
    const controlByKey = new Map();
    config.controls.forEach(([, items]) => items.forEach((item) => { if (item.key) controlByKey.set(item.key.toLowerCase(), item); }));
    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target.closest && event.target.closest('input, textarea, select, [contenteditable], [data-hold]')) return;
      const key = event.key.toLowerCase();
      if (controlByKey.has(key)) runControl(controlByKey.get(key));
      else if (key === 'p') playback('pause');
      else if (key === 'n') playback('next');
      else if (key === 'r') playback('reset');
      else if (/^[1-9]$/.test(key) && scenarioKeys[+key - 1]) { history.length = 0; sim.runScenario(scenarioKeys[+key - 1]); }
      else return;
      event.preventDefault();
      render(true);
    });
    $('presentation').addEventListener('click', () => {
      document.body.classList.toggle('presentation');
      $('presentation').setAttribute('aria-pressed', String(document.body.classList.contains('presentation')));
      fitDevice();
    });
  }

  // Scale the fixed-size device to the viewport without horizontal scrolling.
  function fitDevice() {
    const { width, height } = config.device;
    const narrow = window.innerWidth <= 860;
    const scale = narrow
      ? Math.min(1, (window.innerWidth - 32) / width)
      : Math.min(1, Math.max(0.5, (window.innerHeight - 140) / height));
    const wrap = $('device-wrap');
    wrap.style.width = width * scale + 'px';
    wrap.style.height = height * scale + 'px';
    $('device').style.transform = 'scale(' + scale + ')';
  }

  function mount(options) {
    config = Object.assign({ fastKeys: [], bind: {}, holds: {}, actions: {}, controls: [], toggles: [], readout: () => ({}), device: { width: 390, height: 844 } }, options);
    sim = config.sim;
    root.demo = sim; // automation and console debugging
    // Static shell labels come from the same TEXT table as everything else.
    for (const el of document.querySelectorAll('[data-text]')) el.textContent = sim.t(el.dataset.text);
    for (const el of document.querySelectorAll('[data-text-label]')) el.setAttribute('aria-label', sim.t(el.dataset.textLabel));
    document.documentElement.lang = sim.constructor.TEXT === root.Simulator.TEXT_KO ? 'ko' : document.documentElement.lang;
    document.documentElement.style.setProperty('--device-w', config.device.width + 'px');
    document.documentElement.style.setProperty('--device-h', config.device.height + 'px');
    bindDevice();
    buildConsole();
    window.addEventListener('resize', fitDevice);
    fitDevice();
    render(true);
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      sim.tick(now - last);
      last = now;
      render();
    }, 50);
  }

  root.DemoUI = { mount, html, esc, toast, go, back, clock: (ms) => clock(ms) };
})(window);
