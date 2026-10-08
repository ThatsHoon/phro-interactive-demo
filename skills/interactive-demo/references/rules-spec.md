# Rules spec format

The rules spec is the contract between the user and the demo. Tests are written from it, screens render it, scenarios replay it. Save it as `RULES.md` in the demo folder and show it to the user for approval.

Keep it tables and short sentences. Use the user's language for labels.

## Template

```markdown
# <App> demo — rules spec

## Entities
| Entity | Id format | Created when | Never duplicated because |
|---|---|---|---|
| Request | REQ-0001 | cancel window expires | commit() is a no-op while one is active |

## State variables
| Variable | Values | Set by |
|---|---|---|
| request | idle, holding, cancel_window, queued, sending, accepted, cancelled, completed | user, counterpart, environment |
| link | online, reconnecting, offline | environment (console) |

## Transitions
| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | press and hold | — | holding | — |
| holding | release early | hold < 1.5 s | idle | nothing sent |
| cancel_window | window expires | — | queued → sending | create id, send if online |
| sending | connection lost | — | queued | same id kept |
| queued | connection restored | — | sending | resend with same id |

## Invariants
- One active request at a time; repeated taps never create a second id.
- The id never changes across reconnects, retries or screen changes.
- Nothing is sent before the cancel window ends.

## Exceptions
| Situation | Behaviour on screen | Rule |
|---|---|---|
| Offline at send time | "Saved, sends when connected" | queue, auto-send on recovery |
| Counterpart never answers | stays "sending", presenter can trigger | no automatic failure in the demo |

## Timing
| Timer | Duration | Kind | Note |
|---|---|---|---|
| Hold to request | 1.5 s | policy | real product rule, never compress |
| Cancel window | 3 s | policy | real product rule |
| Reconnect | 1.5 s | staged | real: seconds–minutes |

## Scenarios (autoplay presets)
| Key | Title | Steps (label · duration · what changes) |
|---|---|---|
| A | Happy path | Home 1.5 s · Hold 1.6 s · Window 3 s · Accepted 2.5 s · Completed 1.5 s |

## Faked
- Network, counterpart responses, location: simulated in memory. Reload resets everything.

## Assumptions (needs confirmation)
- ...
```

## Exception discovery checklist

A spec with only the happy path is not ready. For each step of each flow, ask:

- What if the connection drops here? Comes back here?
- What if the user taps the same thing twice, or taps back?
- Can the user cancel here? What happens to what was already sent?
- What if the counterpart (server, operator, store, driver, other user) rejects, delays or never answers?
- What if a permission (location, camera, notifications) is denied?
- What does the screen show when the list is empty or the data is missing/stale?
- Is there a timeout? Is it a policy time or just for pacing?
- What survives a screen change? What must reset?
- Can two events race (cancel while being accepted)? Which wins?

Propose the answers you think are right; the user only has to correct them.

## Timing: policy vs staged

- **policy**: the duration is part of the product (hold-to-confirm, cancel window, OTP expiry). Keep the real value so the audience feels it.
- **staged**: the duration only paces the story (server response, driver arrival, cooking). Compress to 1–3 s, and say in README that it is compressed.
- If a policy time is too long for a live demo (e.g. 30 min), keep it in the rules, add a "skip" via the Next button, and say so.
