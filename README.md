# st4ck-lite

> **Record tests with your AI agent. Replay them forever, for free.**

The free Claude Code plugin for st4ck. Captures agent-driven sessions as deterministic Playwright test files stored as plain markdown in your repo. No account, no key, no service.

```bash
# Inside Claude Code:
/st4ck-lite:author https://app.example.com "Sign in as alice and verify the dashboard loads"
# Agent walks the site, runner captures every primitive, writes ./tests/sign-in-as-alice.md

# Replay anytime — zero LLM, zero cost:
/st4ck-lite:run tests/sign-in-as-alice.md
```

That's the whole product. Two slash commands. Two npm packages underneath (`st4ck` brand binary + the runner it wraps). Zero magic.

---

## Three beats

**1. Agent ergonomics.** A focused IPC vocabulary — actions (`navigate`, `click`, `fill`, `press`, `select`, `check_box`, `hover`, `upload`, `wait_until`, `evaluate`), text-based disambiguation (`click_by_text`, `hover_by_text`, `type_by_text`), conditional dispatch (`branch`), observation (`snapshot`, `url`), control (`continue`, `abort`) — over line-delimited JSON on stdin/stdout. Per-call opt-in flags (`dispatch_chain`, `dispatch_events`, `atomic`) handle no-code platform runtimes (Bubble, Retool, Webflow, n8n, Wix Velo, Glide, FlutterFlow). Your agent already drives a browser; this is the smallest surface that lets it.

**2. Authoring-by-use.** Your agent isn't writing a test — it's using the site. The recording **is** the test. Walk through the flow once; you get a markdown file you can rerun, version, share.

**3. Deterministic free replay.** Recorded md files have zero LLM calls. Reruns are pure Playwright, 10–15× faster than the recording, $0 marginal cost. Run them in CI, on a cron, or whenever you push.

---

## Free vs paid

| Capability | `st4ck-lite` (this plugin) | `st4ck` paid platform |
|---|:---:|:---:|
| 10-primitive IPC vocab | ✓ | ✓ |
| Agent-driven recording | ✓ | ✓ |
| Deterministic markdown replay | ✓ | ✓ |
| Locator-priority ladder (Tier-1 self-heal) | ✓ | ✓ |
| Auto-wait + strict locators (Playwright-grade) | ✓ | ✓ |
| Block-format teaching methodology | ✓ | ✓ |
| **LLM self-heal on selector drift (Tier-2)** | — | ✓ |
| **Cross-project knowledge base** | — | ✓ |
| **TRIAD attestation + server-enforced review** | — | ✓ |
| **13-point review checklist with cross-validation** | — | ✓ |
| **Agent Teams authoring orchestration** | — | ✓ |
| **PRD/spec/dev-task binding + impact analysis** | — | ✓ |
| **Coverage reporting against intent sources** | — | ✓ |
| **Security test generation pipeline (4-phase)** | — | ✓ |
| **Multi-project + multi-environment orchestration** | — | ✓ |

→ Full platform: [st4ck.io](https://st4ck.io)

---

## What lives in this repo

- `.claude-plugin/plugin.json` — Claude Code marketplace metadata
- `st4ck/skills/` — record + replay skills + **PRD authoring skills** (see below)
- `st4ck/commands/` — slash command aliases (`/st4ck-lite:author`, `/st4ck-lite:browse`, `/st4ck-lite:run`)
- `st4ck/agents/` — recording sub-agent + **three independent PRD reviewer agents** (PO / QA / Dev angles)

The runner itself is the `st4ck-runner` npm package — same binary the paid plugin uses. The lite plugin doesn't fork the runner; it constrains the SKILL set to what works without an `app.st4ck.io` connection.

## PRD authoring (bundled)

Two complementary skills ship with the plugin for reverse-engineering Product Requirements Documents from existing codebases or unpacked low-code exports. Useful when a platform has been live for a while and the test/spec layer needs an intent anchor.

| Skill | Purpose |
|---|---|
| `prd-from-source` | Author a PRD by reading source code rather than asking the user. Four iron rules (code is the spec; cite sources with attestation; memory is hint not truth; subagents must attest). Phase 0 preliminaries check `get_project_users` when connected, or ask the user for the role anchor + extra docs. Two-pass mechanical-scaffold + curated-intent approach with audience triple-target (non-technical / QA / dev). |
| `prd-review` | Four-phase review pipeline — self-review → 3 parallel independent reviewers (PO / QA / Dev) → known-gaps-vs-code → bug-routing to dev tasks. Converges on diminishing returns. |

Three reviewer subagents (`prd-reviewer-po`, `prd-reviewer-qa`, `prd-reviewer-dev`) encode each angle as a stable agent type so the review loop is consistent across sessions.

The skills are project-agnostic: any source-grounded PRD authored under the conventional `docs/prd/` shape works. No `app.st4ck.io` connection required — they operate on local files.

---

## Install

In Claude Code:

```bash
/plugin marketplace add edo-ceder/st4ck-lite
/plugin install st4ck-lite@st4ck-lite-marketplace
```

Then `/reload-plugins` to activate.

Or use the standalone CLI without a plugin (`@latest` always resolves to the current release):

```bash
npx st4ck@latest author https://example.com "Sign in as alice and verify the dashboard loads"
npx st4ck@latest browse launch https://example.com --record --out ./tests/sign-in-as-alice.md
npx st4ck@latest run ./tests/sign-in-as-alice.md
```

The npm package is `st4ck` (binary name `st4ck`). For CI / reproducibility, pin to a specific version (e.g. `npx st4ck@0.2.0-alpha.1 …`); see `npm view st4ck versions` for the list. The plugin manifest schema has no version-pinning field, so pinning happens at invocation time.

---

## Status

`0.1.0-alpha.0`. Public alpha; the CLI surface + md format are stable. Skill content + recording UX iterates through `0.1.x` based on alpha feedback.

License: Apache-2.0.
