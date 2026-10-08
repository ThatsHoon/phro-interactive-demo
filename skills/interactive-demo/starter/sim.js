// sim.js — domain-neutral simulation core. Usually left unchanged.
// Owns the virtual clock, scheduled jobs, event log, entity ids and scenario playback.
// Domain rules live in a subclass (domain.js). Runs in the browser and in Node.
(function (root) {
  'use strict';

  const STEP_MS = 50; // fixed sub-step keeps results identical for identical input

  // Every string the core and ui.js show. A domain picks a table with `static TEXT = ...`.
  const TEXT_EN = {
    ready: 'Simulator ready', started: 'Scenario {key} started: {title}', step: 'Step: {label}',
    complete: 'Scenario {key} complete', paused: 'Paused', resumed: 'Resumed', manual: 'Switched to manual control',
    pause: 'Pause', resume: 'Resume', manualTitle: 'Manual control', manualHint: 'Pick a scenario or use the controls',
    done: 'done', noEntity: 'NO ACTIVE ENTITY', pausedBadge: 'PAUSED', clockPaused: 'paused',
    studioTag: 'INTERACTIVE DEMO', presentation: 'Presentation mode', scenarios: 'Scenarios', autoplay: 'AUTOPLAY',
    next: 'Next step → (N)', reset: 'Reset (R)', controls: 'Environment & events', state: 'Current state',
    timeline: 'Event timeline', console: 'Presenter console', device: 'Device preview',
    caption: 'Simulation only. Nothing is sent, recorded or charged. Keys: P pause · N next · R reset · 1–9 scenarios',
  };
  const TEXT_KO = {
    ready: '시뮬레이터 준비', started: '시나리오 {key} 시작: {title}', step: '단계: {label}',
    complete: '시나리오 {key} 완료', paused: '일시정지', resumed: '계속 재생', manual: '수동 제어로 전환',
    pause: '일시정지', resume: '계속 재생', manualTitle: '수동 시연', manualHint: '시나리오를 고르거나 제어 버튼을 누르세요',
    done: '완료', noEntity: '진행 중인 항목 없음', pausedBadge: '일시정지', clockPaused: '정지됨',
    studioTag: '인터랙티브 데모', presentation: '발표 모드', scenarios: '시나리오', autoplay: '자동 재생',
    next: '다음 단계 → (N)', reset: '초기화 (R)', controls: '환경 · 이벤트 제어', state: '현재 상태',
    timeline: '이벤트 타임라인', console: '발표자 콘솔', device: '기기 화면',
    caption: '시뮬레이션 전용입니다. 실제 전송·기록·결제가 일어나지 않습니다. 단축키: P 일시정지 · N 다음 · R 초기화 · 1–9 시나리오',
  };

  class Simulator {
    constructor() {
      this.reset();
    }

    // t('step', { label }) -> localized string from the class's TEXT table
    t(key, vars = {}) {
      const text = (this.constructor.TEXT || TEXT_EN)[key] || TEXT_EN[key] || key;
      return text.replace(/\{(\w+)\}/g, (_, name) => vars[name]);
    }

    // ---- hooks for the domain subclass -------------------------------------
    initialState() { return {}; }
    onReset() {}
    onStep(dt) {}        // continuous updates: progress bars, countdowns, elapsed time
    scenarios() { return {}; } // { key: { title, summary, steps: [{ label, duration, run }] } }
    // ms until the next thing happens when no scenario runs; drives the "Next" button.
    // Override when progress is continuous (onStep) rather than a scheduled job.
    nextEventIn() {
      return this.jobs.length ? Math.max(1, Math.min(...this.jobs.map((job) => job.at)) - this.time) : null;
    }

    // ---- lifecycle ---------------------------------------------------------
    reset() {
      this.serial = 0; // ids restart, so every run of the demo shows the same numbers
      this.time = 0;
      this.paused = false;
      this.jobs = [];
      this.jobSeq = 0;
      this.events = [];
      this.scenario = null;
      this.epoch = Date.now();
      this.state = this.initialState();
      this.log(this.t('ready'));
      this.onReset();
    }

    nextId(prefix) {
      this.serial += 1;
      return prefix + '-' + String(this.serial).padStart(4, '0');
    }

    log(message) {
      this.events.unshift({ at: this.time, message });
      if (this.events.length > 100) this.events.length = 100;
    }

    // ---- virtual timers: never use setTimeout for demo logic ---------------
    schedule(key, delay, fn) {
      this.unschedule(key);
      this.jobs.push({ key, at: this.time + delay, seq: this.jobSeq++, fn });
    }

    unschedule(key) {
      this.jobs = this.jobs.filter((job) => job.key !== key);
    }

    pending(key) {
      return this.jobs.some((job) => job.key === key);
    }

    // Advance the clock. Real-time loop and tests both call this.
    tick(ms) {
      if (this.paused) return;
      let remaining = ms;
      while (remaining > 0) {
        const dt = Math.min(remaining, STEP_MS);
        remaining -= dt;
        this.time += dt;
        this.onStep(dt);
        this.runDueJobs();
        this.progressScenario(dt);
      }
    }

    runDueJobs() {
      // A job may schedule another job that is already due; loop until none remain.
      for (;;) {
        const due = this.jobs
          .filter((job) => job.at <= this.time)
          .sort((a, b) => a.at - b.at || a.seq - b.seq);
        if (!due.length) return;
        const job = due[0];
        this.jobs = this.jobs.filter((j) => j !== job);
        job.fn();
      }
    }

    // ---- scenario playback -------------------------------------------------
    runScenario(key) {
      const def = this.scenarios()[key];
      if (!def) throw new Error('Unknown scenario ' + key);
      this.reset();
      this.scenario = { key, title: def.title, steps: def.steps, index: 0, elapsed: 0, done: false };
      this.log(this.t('started', { key, title: def.title }));
      this.log(this.t('step', { label: def.steps[0].label }));
      def.steps[0].run(this);
    }

    progressScenario(dt) {
      const sc = this.scenario;
      if (!sc || sc.done) return;
      sc.elapsed += dt;
      if (sc.elapsed >= sc.steps[sc.index].duration) this.nextStep();
    }

    nextStep() {
      const sc = this.scenario;
      if (!sc || sc.done) return;
      sc.elapsed = 0;
      if (sc.index + 1 >= sc.steps.length) {
        sc.done = true;
        this.log(this.t('complete', { key: sc.key }));
        return;
      }
      sc.index += 1;
      this.log(this.t('step', { label: sc.steps[sc.index].label }));
      sc.steps[sc.index].run(this);
    }

    // "Next" button: burn the remaining time of the current step (or jump to the
    // next scheduled job when no scenario runs). Keeps the paused state as it was.
    advance() {
      const wasPaused = this.paused;
      this.paused = false;
      const sc = this.scenario;
      if (sc && !sc.done) {
        this.tick(Math.max(1, sc.steps[sc.index].duration - sc.elapsed));
      } else {
        const wait = this.nextEventIn();
        if (wait) this.tick(wait);
      }
      this.paused = wasPaused;
    }

    togglePause() {
      this.paused = !this.paused;
      this.log(this.t(this.paused ? 'paused' : 'resumed'));
    }

    // Manual intervention ends autoplay but keeps the current state.
    stopScenario() {
      if (!this.scenario) return;
      this.log(this.t('manual'));
      this.scenario = null;
    }
  }

  Simulator.TEXT = TEXT_EN;
  Simulator.TEXT_EN = TEXT_EN;
  Simulator.TEXT_KO = TEXT_KO;

  if (typeof module !== 'undefined' && module.exports) module.exports = Simulator;
  else root.Simulator = Simulator;
})(typeof window !== 'undefined' ? window : globalThis);
