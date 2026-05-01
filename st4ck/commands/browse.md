---
description: Drive a real browser one IPC primitive at a time via the `st4ck browse` CLI. Each subcommand is one Bash invocation; the wrapper hides the runner behind the scenes. Multi-session out of the box. Optional `--record` saves the trace as a deterministic md test you can replay later.
argument-hint: <url> [--session <name>] [--record [--out <path>]] [--instruction "<text>"] [--platform=<v>] [--device "<name>"] [--viewport <WxH>] [--locale <bcp47>] [--timezone-id <iana>] [--color-scheme <v>] [--reduced-motion <v>] [--geolocation <lat,lon>] [--context-options <json>] [--headless] [--no-blank-page-check]
---

# /st4ck-lite:browse

Activates the `qa-record-test` skill. You drive a real browser one primitive at a time, one Bash command per primitive, observing the live page state between every action. The `st4ck browse` CLI wraps the runner: each subcommand spawns, sends one IPC command, reads one response envelope, exits. You never touch a FIFO, never manage a background runner, never run `mkfifo`. Multi-session is built in: `-s alice` and `-s bob` route to independent runners.

The captured trace (when you launch with `--record`) is a deterministic markdown file in your repo. Replay it later with zero LLM cost via `/st4ck-lite:run <path>`.

> **Version.** Examples use `npx st4ck@latest` — npm always serves the current release. To pin (CI reproducibility, rollback), substitute an explicit version (e.g. `npx st4ck@0.2.0-alpha.1`); see `npm view st4ck versions` for the list.

## What to do

Activate the `qa-record-test` skill. The user's `$ARGUMENTS` carries:
- `<url>` — the target site
- `"<instruction>"` — what behaviour the agent should verify ("sign in as alice and confirm the dashboard renders the new chart")
- Optional `--out <path>` — override the default output path
- Optional `--name <slug>` — override just the slug

Drive the runner via the `st4ck browse <op>` CLI per the skill's procedure. Continue when the verification succeeds (saves the trace), or abort if you hit something that needs human attention before retrying.

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth for the launch/act/close lifecycle, primitives, locators, no-code platform handling, and the session-level `--platform` mode.

## Lite-tier boundary

This is the **free** plugin. Lite tier means:
- No account, no MCP key, no server connection — recordings live in your repo as plain md.
- No component layer — recordings are flat primitive sequences in a single test md.
- No signing — md files replay as-is.

For TRIAD attestation, server-enforced review, cross-project knowledge base, and Agent Teams orchestration, see the paid `st4ck` plugin.
