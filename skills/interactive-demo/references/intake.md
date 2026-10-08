# Intake

Goal: find every gap in the brief that would change what gets built, ask about all of them in ONE message, and default the rest.

## Questionnaire

Ask only what the brief leaves open. Group the questions, number them, and offer the default in parentheses so the user can answer "defaults are fine".

| # | Topic | Why it matters | Default if unanswered |
|---|---|---|---|
| 1 | Purpose and audience (investors, client, internal review, usability test) | Sets polish level and whether the console is shown | Client-style presentation |
| 2 | Demo mode: presenter drives / autoplay / both | Decides scenario presets vs manual controls weight | Both |
| 3 | Target device(s) and size | Frame and layout | Mobile 390×844 |
| 4 | Design source: Figma link + frames, exported images, screenshots, none | Asset pipeline | None: clean neutral UI in the brand color if given |
| 5 | Screen list | Scope | Derived from flows; list them back |
| 6 | Main flows (A → B → C with conditions) | Navigation and scenarios | From brief |
| 7 | State rules: what changes what, what must never change | The core of the demo | Propose from domain knowledge, mark as assumption |
| 8 | Exceptions: offline, timeout, reject, duplicate tap, cancel at each stage, permission denied, empty state | Demo must survive any button the presenter presses | Propose a list; see rules-spec.md checklist |
| 9 | What is faked (map = image, call = UI only, payment = no charge) | Avoids accidental real effects | Everything external is faked |
| 10 | Scenario script(s) for the presentation | Autoplay presets | 2–4 presets covering happy path + key exceptions |
| 11 | Timing: real policy durations vs presentation pace | Policy vs staged timing | Keep policy times, stage others at 1–3 s per step |
| 12 | Delivery: zip, URL, offline, who opens it | Stack constraints | Static files, opens from disk, works offline |
| 13 | Language of the UI | Copy | Language of the brief |
| 14 | After the demo: throwaway or grows into the product | Stack choice | Throwaway → no-build static |

## How to ask

- One message, numbered, defaults shown. Do not drip-feed questions.
- If the brief already answers a topic, do not ask it; restate it briefly so the user can correct it.
- If the brief is thin (no rules, no exceptions), ask AND propose: "I'd assume X, Y, Z — correct?" A proposal is faster to answer than an open question.
- Stop after asking. Do not build "something to look at" while waiting.

## When to skip asking

Proceed with defaults (listing them explicitly) when the user says to, e.g. "use your judgment", "don't ask, just build", "I'm away". Write the assumptions into the rules spec so they can be reviewed later.
