// domain.js — the app's state rules. REPLACE this example with the approved rules spec.
// Example domain: a generic "request" (hold to request -> cancel window -> send ->
// counterpart accepts -> complete) that survives going offline. It exists to show the
// patterns: timing table, one entity id per request, queue-while-offline, guarded actions.
(function (root) {
  'use strict';
  const Simulator = typeof module !== 'undefined' && module.exports ? require('./sim.js') : root.Simulator;

  // policy = real product rule, keep exact. staged = compressed for the presentation.
  const TIMING = {
    hold: { ms: 1500, kind: 'policy', note: 'press-and-hold prevents accidental requests' },
    cancelWindow: { ms: 3000, kind: 'policy', note: 'user may cancel before anything is sent' },
    reconnect: { ms: 1500, kind: 'staged', note: 'real reconnect can take much longer' },
    response: { ms: 2000, kind: 'staged', note: 'counterpart acknowledges the request' },
  };

  class Demo extends Simulator {
    // UI language for core/console strings: Simulator.TEXT_EN, Simulator.TEXT_KO, or your own table.
    static TEXT = Simulator.TEXT_EN;

    initialState() {
      return {
        view: 'home',
        network: 'online',   // environment, set from the presenter console
        link: 'online',      // what the app currently has: online | reconnecting | offline
        request: 'idle',     // idle | holding | cancel_window | queued | sending | accepted | cancelled | completed
        requestId: null,
        holdMs: 0,
        windowMs: 0,
        attempts: 0,
        autoRespond: true,
      };
    }

    active() {
      return ['queued', 'sending', 'accepted'].includes(this.state.request);
    }

    onStep(dt) {
      const s = this.state;
      if (s.request === 'holding') {
        s.holdMs += dt;
        if (s.holdMs >= TIMING.hold.ms) {
          s.request = 'cancel_window';
          s.windowMs = TIMING.cancelWindow.ms;
          this.log('Hold complete, cancel window open');
        }
      } else if (s.request === 'cancel_window') {
        s.windowMs = Math.max(0, s.windowMs - dt);
        if (s.windowMs === 0) this.commit();
      }
    }

    // ---- user actions ------------------------------------------------------
    // Opening the screen shows the active request, or a fresh one after a finished request.
    openRequest() {
      const s = this.state;
      if (['cancelled', 'completed'].includes(s.request)) {
        s.request = 'idle';
        s.requestId = null;
      }
      s.view = 'request';
    }

    beginHold() {
      const s = this.state;
      if (!['idle', 'cancelled', 'completed'].includes(s.request)) return false;
      s.view = 'request';
      s.request = 'holding';
      s.requestId = null;
      s.holdMs = 0;
      return true;
    }

    releaseHold() {
      const s = this.state;
      if (s.request !== 'holding') return;
      s.request = 'idle';
      s.holdMs = 0;
      this.log('Released early, nothing sent');
    }

    // Creates the entity exactly once; repeated calls while active are no-ops.
    commit() {
      const s = this.state;
      if (this.active()) return;
      s.requestId = this.nextId('REQ');
      s.request = 'queued';
      this.log('Request ' + s.requestId + ' created');
      this.send();
    }

    send() {
      const s = this.state;
      if (!['queued', 'sending'].includes(s.request)) return;
      if (s.link !== 'online') {
        s.request = 'queued';
        this.log(s.requestId + ' queued until connection returns');
        return;
      }
      s.request = 'sending';
      s.attempts += 1;
      this.log(s.requestId + ' sent (attempt ' + s.attempts + ')');
      if (s.autoRespond) this.schedule('response', TIMING.response.ms, () => this.respond());
    }

    cancel() {
      const s = this.state;
      if (['holding', 'cancel_window'].includes(s.request)) {
        s.request = 'idle';
        s.holdMs = 0;
        s.windowMs = 0;
        this.log('Cancelled before sending');
        return true;
      }
      if (['queued', 'sending'].includes(s.request)) {
        this.unschedule('response');
        s.request = 'cancelled';
        this.log(s.requestId + ' cancelled');
        return true;
      }
      return false; // accepted requests are closed by the counterpart, not the user
    }

    // ---- counterpart / environment (presenter console) ----------------------
    respond() {
      const s = this.state;
      if (s.request !== 'sending' || s.link !== 'online') return false;
      this.unschedule('response');
      s.request = 'accepted';
      this.log(s.requestId + ' accepted by counterpart');
      return true;
    }

    complete() {
      const s = this.state;
      if (s.request !== 'accepted') return false;
      s.request = 'completed';
      this.log(s.requestId + ' completed');
      return true;
    }

    setNetwork(online) {
      const s = this.state;
      s.network = online ? 'online' : 'offline';
      if (!online) {
        this.unschedule('reconnect');
        this.unschedule('response');
        s.link = 'offline';
        if (s.request === 'sending') s.request = 'queued';
        this.log('Connection lost' + (s.requestId ? ', ' + s.requestId + ' kept' : ''));
        return;
      }
      if (s.link === 'online') return;
      s.link = 'reconnecting';
      this.log('Reconnecting');
      this.schedule('reconnect', TIMING.reconnect.ms, () => {
        s.link = 'online';
        this.log('Connection restored');
        if (s.request === 'queued') this.send();
      });
    }

    setAutoRespond(on) {
      const s = this.state;
      s.autoRespond = on;
      if (!on) this.unschedule('response');
      else if (s.request === 'sending') this.schedule('response', TIMING.response.ms, () => this.respond());
    }

    // ---- autoplay scenarios -------------------------------------------------
    scenarios() {
      const step = (label, duration, run = () => {}) => ({ label, duration, run });
      const holdTime = TIMING.hold.ms + 100;
      return {
        A: {
          title: 'Happy path',
          summary: 'Hold, cancel window, accepted, completed',
          steps: [
            step('Home', 1500),
            step('Press and hold', holdTime, (sim) => sim.beginHold()),
            step('Cancel window', TIMING.cancelWindow.ms),
            step('Sent, waiting for counterpart', TIMING.response.ms + 500),
            step('Completed', 1500, (sim) => sim.complete()),
          ],
        },
        B: {
          title: 'Offline request',
          summary: 'Queued offline, sent on recovery',
          steps: [
            step('Connection lost', 1500, (sim) => sim.setNetwork(false)),
            step('Press and hold', holdTime, (sim) => sim.beginHold()),
            step('Cancel window', TIMING.cancelWindow.ms),
            step('Queued on device', 2000),
            step('Connection back, auto send', TIMING.reconnect.ms + TIMING.response.ms + 500, (sim) => sim.setNetwork(true)),
          ],
        },
      };
    }
  }

  Demo.TIMING = TIMING;

  if (typeof module !== 'undefined' && module.exports) module.exports = Demo;
  else root.Demo = Demo;
})(typeof window !== 'undefined' ? window : globalThis);
