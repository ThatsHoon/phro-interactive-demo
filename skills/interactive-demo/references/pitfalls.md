# Pitfalls

Check this list before the browser verification gate and before delivery.

| Pitfall | Why it hurts | Prevention |
|---|---|---|
| Only the happy path is implemented | The presenter presses one unexpected button and the demo shows nonsense | Exception checklist in rules-spec.md; a console control for every exception |
| Policy time and staged time mixed up | Either the audience waits 30 s in silence or a real safety rule looks instant | Timing table with `kind`; tests assert policy times exactly |
| `setTimeout` / `setInterval` used for demo logic | Pause, Next and tests stop working; races appear | Only `sim.schedule()` and `onStep`; the single real interval drives `tick()` |
| Duplicate entities from repeated taps or reconnects | Story breaks ("two orders?") | Create the id in one guarded function; test repeated calls |
| Screen rebuild loses focus or input | Keyboard users and typed text get wiped | `fastKeys` + `data-bind` for per-frame values; focus restore by `data-action`; keep form text in state |
| Presenter console and device diverge | Readout shows one thing, screen another | Both go through the same domain methods; no state written only in the UI layer |
| Manual control during autoplay fights the scenario | Scenario overwrites what the presenter just did | Console controls call `stopScenario()` first (starter does this) |
| Design asset URLs expire (Figma MCP, signed URLs) | Demo breaks a day later | Download into `assets/` immediately; verify file type matches extension |
| Machine-specific paths or global installs | Works only on the author's PC | No absolute paths; Playwright resolved locally; demo itself needs nothing installed |
| External CDN fonts/scripts/maps | Breaks offline and at venues with bad Wi-Fi | Ship files locally; system font stack as fallback; browser test fails on external requests |
| Minified or one-line code | Nobody can adjust the demo before the meeting | Readable, commented code; one concern per file |
| Unescaped values in templates | Odd names or pasted text break the layout (or inject markup) | `html` tagged template escapes by default |
| Real people, real orgs, real phone numbers | Privacy and impersonation problems in slides that get forwarded | Obvious fictional data; label the demo as a simulation |
| Treating the demo as the product | Fake timers and in-memory state get shipped | README says what is faked; recommend a rewrite if it becomes a product |
| Presentation mode hides every exception control | Presenter can only show the happy path in front of the audience | Keyboard `key` on each control; starter shortcuts P/N/R/1–9 |
| UI strings hard-coded in core files | Every new language means patching the engine | `static TEXT` table in `domain.js` |
| Tiny screens overflow | Demo shared by link is opened on a phone | 375 px check in browser test; device scales down |
