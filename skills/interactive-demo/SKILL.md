---
name: interactive-demo
description: Build a working, presentation-ready demo of any app from a brief of features, flows and state rules — a state simulator with a realistic device screen, a presenter console (scenario autoplay, pause/next/reset, environment and counterpart toggles, live state, event timeline) and a presentation mode. Use this whenever the user wants an app demo, a clickable or interactive prototype, a UX simulator, a scenario walkthrough for a pitch, client or review meeting, or wants a Figma/design mockup to "actually work" — including Korean requests like "앱 데모", "시연용 프로토타입", "UX 시뮬레이터", "시안을 동작하게", "클릭 가능한 목업", "시나리오 시연", "발표용 데모" — even if they never say "simulator". Do not use for building the real product with a real backend, or for a single static mockup image.
---

# Interactive demo builder

The deliverable is a **state simulator**, not a set of screens. Screens only render state; the value of the demo is that its rules (transitions, timing, exceptions, invariants) behave exactly as the real product would, while every external effect (network, server, sensors, payments, other people) is faked.

What the user gets:

- **Device screen** — looks and handles like the real app (mobile, tablet, web, kiosk, car… whatever the brief targets).
- **Presenter console** — outside the app: scenario presets with autoplay, pause / next step / reset, controls for the environment and counterparts (network, external events, operator/server/other-user responses), live state readout, event timeline.
- **Presentation mode** — hides the console and centers the device.

Behaviour the demo must have:

- The demo owns time. Pause freezes every timer, countdown and elapsed clock; Next skips the remaining time of the step; the same inputs always give the same result.
- Entities in progress (order, request, case, session…) keep one identity through any environment change; repeated taps never create a second one.
- Device input and console controls share one state. Manual intervention ends autoplay but keeps the current state.
- Policy times (confirm holds, cancel windows) stay real; only pacing waits are compressed.

## Workflow

Run the steps in order. **Gates** are hard stops: do not start the next step until the gate condition holds. They exist because rework after the gate is expensive and the user, not you, owns the product rules.

### 1. Intake
Read `references/intake.md`. Find what the brief leaves open, ask everything in one numbered message with a default per question, then stop and wait. Restate what the brief already answers so the user can correct it.

If the user said to proceed without questions ("use your judgment", "I'm away", "pre-approved"), apply defaults, list them, and continue.

### 2. Rules spec — GATE
Write `RULES.md` using `references/rules-spec.md`: entities, state variables, transitions, invariants, exceptions, timing table (policy vs staged), scenarios, what is faked, open assumptions. If the brief only describes the happy path, propose the exceptions yourself using the checklist there.

Show it and get approval before writing any code. Explicit pre-approval in the request counts; note it at the top of `RULES.md`.

### 3. Design assets
Use the best available source, in this order:
1. Design-tool integration (e.g. Figma MCP `get_design_context` / `get_screenshot` per frame).
2. Exported images or SVGs from the user.
3. Screenshots.
4. Nothing: a clean neutral UI in the brand color.

Download any temporary or signed asset URL into `assets/` immediately; check that file contents match their extension. Move colors, type, spacing, radii and shadows into the `:root` tokens in `styles.css`. List every screen you designed without a source so the user can review it.

### 4. State engine and tests — GATE
Copy `starter/` from this skill into the demo folder (see "Starter" below). Replace `domain.js` with the approved rules and `test.cjs` with one test per transition, exception, invariant and scenario. Run `node test.cjs`. Do not build screens until every test passes. A failing rule is far cheaper to fix here than through the UI.

### 5. Screens
Replace `views.js`. Set the UI language once with `static TEXT` in `domain.js` (`Simulator.TEXT_KO` for Korean, `Simulator.TEXT_EN`, or your own table, e.g. `{ ...Simulator.TEXT_KO, studioTag: '...' }`). It also fills the shell labels in `index.html` (`data-text`), so the only literal left there is the app name; do not edit strings inside `sim.js` or `ui.js`. Every view is a pure function of state written with the auto-escaping `html` template. Per-frame values (countdowns, progress, elapsed time) go in `fastKeys` and are painted through `data-bind`, so screens do not flicker or lose focus. Special input (press-and-hold, drag) must feel real: use `data-hold` for holds, which handles pointer capture, leaving the button, keyboard, and window blur.

### 6. Presenter console
Fill `controls`, `toggles`, `readout`, `entity` in the `mount()` call. Give every exception in the rules spec a console control so the presenter can trigger it on demand. Guarded actions return `false` with a `fail` message, so a mistimed click explains itself instead of doing nothing.

Write every label, readout value and toast in `views.js` in the UI language too; status words like ON/OFF or idle/sending leak into the console most often.

Give each control a single-letter `key`. Presentation mode hides the console, and the presenter still needs to trigger exceptions mid-talk; the starter already maps P (pause), N (next), R (reset) and 1–9 (scenarios), so avoid those letters. List the keys in the README.

### 7. Browser verification — GATE
Update the domain section of `browser.test.cjs` with the app's core interactions, then run `node browser.test.cjs`. It covers: core flow clicks, timers and holds with real input, every scenario stepped to completion, pause and resume, opening from `file://`, 375 px width without horizontal scroll, zero broken assets, zero console errors, zero external requests. It writes screenshots to `screenshots/`.

Playwright must resolve from the demo folder or a parent (`npm i -D playwright`; it falls back to an installed Edge or Chrome). If it cannot be installed, verify the same list with whatever browser tools are available. Show the user the key screenshots before calling the demo done.

### 8. Delivery
Write `README.md` (in the user's language): how to open it, how to present (each scenario and what it proves, console controls), the rules in plain words, what is faked or compressed, file roles, verification results. Confirm the delivery form works: zip and open from disk, or the hosting URL. Leave `screenshots/` and `node_modules/` out of the zip; they are verification artifacts, not part of the demo.

## Starter

`starter/` is a runnable, domain-neutral skeleton (`node test.cjs` passes; `node browser.test.cjs` passes). Its example domain is a generic hold → cancel window → send → accept flow that survives going offline. Keep the structure, replace the example.

| File | Role | Change it? |
|---|---|---|
| `sim.js` | Virtual clock (`tick`), `schedule/unschedule/pending` timers, event log, `nextId`, scenario playback (`runScenario`, `advance`, `togglePause`, `stopScenario`), `nextEventIn()` | Rarely |
| `domain.js` | `class Demo extends Simulator`: `initialState`, `onStep`, actions, `TIMING`, `scenarios()` | Replace |
| `ui.js` | Render loop, `html` escaping, `data-action` / `data-hold` / `data-bind`, focus restore, console wiring, device scaling, `window.demo` | Rarely |
| `views.js` | Screens + `DemoUI.mount({...})` config | Replace |
| `index.html` | Studio shell: device frame + console | Title and labels |
| `styles.css` | Tokens, studio and console layout, example screen styles | Tokens and screen styles |
| `test.cjs` | Rule tests, Node built-ins only | Replace |
| `browser.test.cjs` | Playwright checks + screenshots | Domain section |
| `server.cjs` | Optional local static server | No |

Contract essentials:
- All demo logic timing goes through `sim.schedule(key, ms, fn)` or `onStep(dt)`. One real interval in `ui.js` drives `tick()`; nothing else may call `setTimeout` for demo behaviour, or pause and Next break.
- Create entities in one guarded method (`commit()` pattern) so duplicates are impossible.
- `scenarios()` returns `{ key: { title, summary, steps: [{ label, duration, run(sim) }] } }`.
- Device actions: `actions[name](sim, el)`; return a string to show it as a toast. Unknown action names that match a view navigate to it; `back` pops history.
- Controls: `{ label, key, run(sim), fail, tone }`. Any control or toggle ends autoplay and keeps the current state.
- `reset()` restarts entity numbering, so every rehearsal shows the same ids.
- Continuous phases (cooking, moving along a route) progress in `onStep` with no scheduled job; override `nextEventIn()` so the Next button can still skip them.

## Stack choice

Default: the no-build static starter. It opens from disk, works offline, and can be zipped or hosted anywhere.

Switch only when there is a reason, and keep the same architecture (pure engine with a virtual clock, tests first, views as a function of state, presenter console):
- The demo will grow into the product, or the team's codebase is React/Vue/etc. → that framework, engine still framework-free.
- The demo needs native device features (camera, haptics, real notifications) → a native or PWA shell, still faking the backend.
- The user asks for a specific stack.

## Before you call it done

Read `references/pitfalls.md` and check each row against the demo. Then report: files created, test results, browser check results with screenshots, assumptions still open, and what is faked.
