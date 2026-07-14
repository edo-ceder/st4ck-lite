---
description: Drive a real browser one IPC primitive at a time via the `st4ck browse` CLI. Each subcommand is one Bash invocation; the wrapper hides the runner behind the scenes. Multi-session out of the box. Optional `--record` saves the trace as a deterministic md test you can replay later.
argument-hint: <url> [--session <name>] [--record [--out <path>]] [--instruction "<text>"] [--storage-state <file>] [--device "<name>"] [--viewport <WxH>] [--locale <bcp47>] [--timezone-id <iana>] [--color-scheme <v>] [--reduced-motion <v>] [--geolocation <lat,lon>] [--context-options <json>] [--headless] [--no-blank-page-check]
---

# /st4ck-lite:browse

Activate the `qa-record-test` skill. Drive a real browser one primitive at a time, one Bash command per primitive, and read the live result before choosing the next action. The `st4ck browse` CLI owns the runner/session plumbing. Never touch a FIFO or spawn `st4ck-runner` directly.

When launch includes `--record`, close writes a deterministic Markdown trace in the repository. Replay it later without an LLM via `/st4ck-lite:run <path>`.

Before acting, use `npx -y st4ck@latest browse --help`; for exact operation flags use `npx -y st4ck@latest browse <op> --help`. The runtime help wins if installed skill prose ever drifts.

## What to do

Activate the `qa-record-test` skill. The user's `$ARGUMENTS` carries:
- `<url>` — the target site
- `"<instruction>"` — what behaviour the agent should verify ("sign in as alice and confirm the dashboard renders the new chart")
- Optional `--out <path>` — override the default output path
- Optional `--name <slug>` — override just the slug

Drive the browser through `st4ck browse <op>` according to the skill. Close after the expected state is proven, or abort if the flow cannot safely continue.

Do not duplicate the procedure here. The skill is the canonical Lite guidance for launch/act/close, current locator flags, focused observation, reactive-click escalation, auth-state handling, and replay.

## Lite-tier boundary

This is the free, local surface:

- No account, MCP key, or hosted workspace is required; traces live in the repository as Markdown.
- This recording skill currently emits one flat primitive trace. Basic local reusable components are intended to remain open source, but this alpha does not yet ship a local component registry or authoring workflow. Do not invent a component format.
- Traces replay locally as-is; Lite does not provide hosted attestation or workspace policy.

For shared database-backed tests/components, MCP authoring and execution, lifecycle links, team policy, and workspace-backed history, use the full `st4ck` plugin with a st4ck workspace.
