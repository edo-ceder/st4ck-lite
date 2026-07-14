# st4ck-lite

> **Let your coding agent verify a UI once. Replay the captured test without an LLM.**

`st4ck-lite` is the free, open-source, local surface of st4ck. It teaches an agent to drive `st4ck browse`, save the verified primitive trace as Markdown in the repository, and replay it deterministically with `st4ck run`. No st4ck account, API key, or hosted workspace is required.

The repository ships a Claude Code plugin plus a checked-in Codex Browse skill source. Both use the same public `st4ck` CLI and `st4ck-runner` packages.

## Quick start

In Claude Code:

```text
/plugin marketplace add edo-ceder/st4ck-lite
/plugin install st4ck-lite@st4ck-lite-marketplace
/reload-plugins

/st4ck-lite:author https://app.example.com "Sign in as alice and verify the dashboard loads"
/st4ck-lite:run tests/sign-in-as-alice-and-verify-the-dashboard-loads.md
```

Without a plugin, any coding agent that can run shell commands can use the CLI:

```bash
npx st4ck@latest author https://app.example.com "Sign in as alice and verify the dashboard loads"
npx st4ck@latest browse --help
# The agent reads .st4ck/session.md, drives the browser, proves the outcome, and closes the recording.
npx st4ck@latest run tests/sign-in-as-alice-and-verify-the-dashboard-loads.md
```

For Codex, the durable skill source is [`codex/skills/st4ck-browse/SKILL.md`](codex/skills/st4ck-browse/SKILL.md). Install or synchronize it to `$CODEX_HOME/skills/st4ck-browse/SKILL.md` (normally `~/.codex/skills/st4ck-browse/SKILL.md`), then start a fresh Codex task so the skill list reloads.

## What ships now

- Agent-driven browser recording with one `st4ck browse <op>` invocation per observed action.
- Canonical accessible locators plus collision-aware `interactables` and `locate` discovery.
- Focused reads and assertions with `get-text` and `assert-contains`.
- Scroll, focused-fill, settled-click, real native-click escalation, Bubble diagnostics, screenshots, and multi-session driving.
- Deterministic local Markdown replay with no LLM calls during replay.
- Source-grounded PRD authoring and multi-angle PRD review skills that operate on local files.

The runtime registry and `npx st4ck@latest browse <op> --help` are the operation-level source of truth. The installed skills teach strategy and safe examples; they should not replace runtime help.

## Recording model

```text
agent intent
    |
    v
st4ck browse launch --record
    |
    v
observe -> one primitive -> verify -> next primitive
    |
    v
st4ck browse close
    |
    v
tests/<flow>.md
    |
    v
st4ck run tests/<flow>.md   (deterministic, no LLM)
```

The current recording skill emits one flat primitive trace. It does not silently infer or register reusable components.

## Local components: intended, not invented

Basic reusable local components are intended to remain part of the open-source surface; they are not a paid-only concept. This alpha does **not** yet ship a local component registry, component authoring command, or stable component-file format. Until that contract exists, Lite skills must not invent one.

The full `st4ck` + workspace surface is different: it adds shared database-backed tests/components, MCP authoring and execution, lifecycle context, team policy, and workspace-visible history across agents and people.

## Lite/local vs full st4ck + workspace

| Capability | `st4ck-lite` / local | Full `st4ck` + workspace |
|---|:---:|:---:|
| Agent-driven browser exploration | Yes | Yes |
| Flat Markdown test recording | Yes | Yes |
| Deterministic local replay | Yes | Yes |
| Focused Browse discovery/assertion operations | Yes | Yes |
| Source-grounded local PRD authoring/review | Yes | Yes |
| Basic local reusable components | Intended OSS; registry not shipped in this alpha | Shared registry-backed reuse |
| Database-backed test/component catalog | No | Yes |
| MCP authoring and execution | No | Yes |
| PRD/spec/dev-task/test lifecycle links | Local documents only | Workspace-backed |
| Team policy, review state, and shared history | No | Yes |

The boundary is locality and shared lifecycle infrastructure—not whether reusable test components are philosophically “free” or “paid.”

## Why not a generic browser wrapper?

General browser tools are useful for ad-hoc navigation, scraping, and debugging. `st4ck browse` is optimized for a narrower loop:

1. The agent performs and verifies the journey against the real UI.
2. The runner captures typed primitives rather than free-form intent.
3. The resulting Markdown trace can be committed, reviewed, and replayed without asking an LLM to rediscover the journey.

For reactive controls, the skill uses an explicit escalation: ordinary `click`, then `click_native`, then `click_native --pointer-sequence` only when needed. Bubble-specific composite operations use their documented parsers rather than pretending every UI shares one selector shape.

## Repository layout

- `.claude-plugin/marketplace.json` — Claude marketplace catalog.
- `st4ck/.claude-plugin/plugin.json` — the single plugin-version source.
- `st4ck/commands/` — `/st4ck-lite:author`, `/st4ck-lite:browse`, and `/st4ck-lite:run`.
- `st4ck/skills/qa-record-test/` — canonical Claude recording procedure.
- `st4ck/skills/prd-*` and `st4ck/agents/` — local PRD authoring/review workflow.
- `codex/skills/st4ck-browse/` — checked-in Codex Browse skill source.
- `scripts/validate-plugin.mjs` — manifest, version, and cross-surface Browse drift checks.

## Versioning and validation

The Claude plugin version is declared only in `st4ck/.claude-plugin/plugin.json`; the marketplace entry must not declare a competing plugin version. The npm CLI is versioned separately. When reproducibility requires a pinned CLI, choose an explicit published version from `npm view st4ck versions` instead of copying a pin from these docs.

Before publishing a plugin change:

```bash
claude plugin validate .
claude plugin validate st4ck
node scripts/validate-plugin.mjs
```

## Status

`0.2.0-alpha.1`. Public alpha. Browser operation names and skill guidance can still evolve; use per-operation runtime help for the installed CLI contract.

License: Apache-2.0.
