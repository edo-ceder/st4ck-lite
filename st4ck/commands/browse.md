---
description: Drive a real browser one IPC primitive at a time to verify behaviour live. Captures the trace as a deterministic md file you can replay later. Same mechanic as /st4ck-lite:author — different framing for verification-first usage.
argument-hint: <url> "<instruction>" [--out <path>]
---

# /st4ck-lite:browse

Activates the `qa-record-test` skill to drive a browser session via IPC primitives. Use this when you want to verify a feature or fix works — the agent walks the site one primitive at a time, observing the live page between actions. The captured md file lives in your repo and replays via `/st4ck-lite:run`.

## What to do

Activate the `qa-record-test` skill. The user's `$ARGUMENTS` carries:
- `<url>` — the target site
- `"<instruction>"` — what behaviour the agent should verify ("sign in as alice and confirm the dashboard renders the new chart")
- Optional `--out <path>` — override the default output path
- Optional `--name <slug>` — override just the slug

Drive the runner via the IPC vocabulary documented in the skill. Continue when the verification succeeds (saves the trace), or abort if you hit something that needs human attention before retrying.

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth for primitives, locators, no-code platform flags, and the session-level `--platform` mode.
