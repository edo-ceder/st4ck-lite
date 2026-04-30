---
description: Record a test by walking through a website. The agent drives the browser via the `st4ck browse` CLI; the runner captures every primitive into a markdown test file in ./tests/.
argument-hint: <url> "<instruction>" [--out <path>]
---

# /st4ck-lite:author

Activates the `qa-record-test` skill to capture an agent-driven walkthrough as a deterministic md test file. No account, no key, no service. The output md file lives in your repo (`./tests/<slug>.md`) and replays via `/st4ck-lite:run`.

Bootstrap (one-time, optional):

```bash
npx st4ck@<version> author <url> "<instruction>"
```

This writes a `.st4ck/session.md` skill file teaching the new CLI surface. Substitute the latest `st4ck` version (`npm view st4ck version`); the plugin manifest does not pin the CLI version, so pin in your invocation.

## What to do

Activate the `qa-record-test` skill. The user's `$ARGUMENTS` carries:
- `<url>` — the target site
- `"<instruction>"` — what the agent should do (a walkthrough, like "sign in as alice and verify the dashboard loads")
- Optional `--out <path>` — override the default output path (defaults to `./tests/<slugified-instruction>.md`)
- Optional `--name <slug>` — override just the slug

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth.
