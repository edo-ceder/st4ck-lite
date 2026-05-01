---
name: qa-record-test
description: Record a deterministic md test file by walking through a site with the `st4ck browse` CLI primitive vocabulary. Triggers on phrases like "record this test", "capture this flow", "create a test for this site", or via the explicit `/st4ck-lite:author` slash command. Lite-tier: no account, no MCP key, no server connection — just md files.
---

# QA Recording — md File Authoring

You record a test by driving the `st4ck browse` CLI in `--record` mode. Every primitive command you issue lands in the runner's recording buffer; on `close`, the runner serializes the buffer to a markdown file in the user's repo.

You never run `mkfifo`. You never spawn a background runner. You never echo JSON into a FIFO. The `st4ck browse` CLI hides all of that — each primitive is one Bash call. Multi-session is built in: `-s alice` and `-s bob` route to independent runners.

> **Version.** Examples use `npx st4ck@latest` — npm always serves the current release. To pin (CI reproducibility, rollback), substitute an explicit version (e.g. `npx st4ck@0.2.0-alpha.1`); see `npm view st4ck versions` for the list.

## What you receive

From the `/st4ck-lite:author` slash command (or free-text trigger):
- `url` — the target site
- `instruction` — natural-language description of what the test verifies
- Optional `out` path / `name` slug

## First action — confirm the brand binary is available

```bash
npx -y st4ck@latest --help
```

If the user has `st4ck` installed locally, prefer the local binary; otherwise `npx` into the latest. If neither works, surface the install instructions to the user and stop.

## Recording loop — launch, act, close

### Step 1 — Launch the recording session

```bash
npx st4ck@latest browse launch <url> \
  --session <slug> \
  --record --out tests/<slug>.md \
  --instruction "<instruction>"
```

#### Browser-context emulation flags (mobile, locale, timezone, dark mode, geolocation)

For sites where viewport / touch / locale / timezone / color scheme / geolocation matter (mobile-responsive apps, locale-aware UIs, time-of-day-sensitive logic), add Playwright-style emulation flags to the launch:

| Flag | What it does |
|---|---|
| `--device "iPhone 14 Pro"` | Apply a Playwright device descriptor (viewport + UA + DPR + isMobile + hasTouch). The right way to test mobile — viewport-only emulation does NOT trigger `@media (pointer: coarse)` / mobile UA gating. See `npx playwright devices` for the full list. |
| `--viewport "393x852"` | Standalone viewport (no UA / touch change), or override the viewport from `--device`. |
| `--user-agent "..."` | Custom UA. Standalone or overrides `--device`'s UA. |
| `--locale "he-IL"` | BCP 47 locale. Drives `Intl.*`, `navigator.language`, `Accept-Language`. |
| `--timezone-id "Asia/Jerusalem"` | IANA timezone — drives `new Date()` and `Intl` timezone. Maps to Playwright's `timezoneId`. (`--timezone` is also accepted as alias for backward compat with alpha.5.) |
| `--color-scheme dark` | One of `light` / `dark` / `no-preference`. Drives `prefers-color-scheme`. |
| `--reduced-motion reduce` | One of `reduce` / `no-preference`. Drives `prefers-reduced-motion`. |
| `--forced-colors active` | One of `active` / `none`. Drives the `forced-colors` media query. |
| `--geolocation "lat,lon"` | Seeds `navigator.geolocation`. Auto-grants the geolocation permission so the prompt doesn't block. |
| `--permissions clipboard-read,notifications` | CSV of permissions to grant via `context.grantPermissions()`. |
| `--http-credentials "user:pass"` | HTTP Basic auth for staging environments. |
| `--offline` | Start the context offline. |
| `--bypass-csp` | Bypass the page's Content-Security-Policy. |
| `--context-options '<json>'` | **Escape hatch** — raw JSON `BrowserContextOptions` blob for fields not exposed as flags (`recordVideo`, `recordHar`, `extraHTTPHeaders`, `screen`, future Playwright additions). Validated as JSON pre-spawn. Merges as the BASE layer; `--device` overrides on top; explicit named flags win last. |

Composite mobile-Hebrew-Tel Aviv example:

```bash
npx st4ck@latest browse launch https://app.example.com \
  --session plenty-mobile --record --out tests/plenty-mobile.md \
  --device "iPhone 14 Pro" \
  --locale "he-IL" \
  --timezone-id "Asia/Jerusalem" \
  --color-scheme dark \
  --geolocation "32.0853,34.7818"
```

Escape-hatch example for capturing video + HAR alongside iPhone emulation:

```bash
npx st4ck@latest browse launch https://app.example.com \
  --session plenty-recorded --record --out tests/plenty-recorded.md \
  --device "iPhone 14 Pro" \
  --context-options '{"recordVideo":{"dir":"/tmp/v"},"recordHar":{"path":"/tmp/h.har"}}'
```

Wrapper-side validation rejects bad strings (`--viewport foo`, `--geolocation 91,0`, etc.) in <100ms BEFORE Chromium spawns.

The wrapper spawns the runner in the background, opens a session under `~/.st4ck/sessions/<slug>/`, and returns the `runner_ready` envelope on stdout:

```json
{
  "type": "runner_ready",
  "page_url": "<url>",
  "page_errors": [],
  "blank_page_detected": false
}
```

`page_errors` carries any uncaught exceptions thrown during page load (the listener attaches before navigation, so module-load throws are caught). `blank_page_detected: true` means `#root` (or sibling SPA mount points) is empty after a configurable delay (`--blank-page-delay <ms>`, default 4000) — usually correlates with non-empty `page_errors`. Disable detection with `--no-blank-page-check`.

The session stays alive between Bash calls; from now on every primitive is one invocation.

### Step 2 — Drive the browser, one primitive per Bash call

Send one command, read the response envelope, reason about it, send the next. **Never batch primitives blind** — you defeat the point of live verification.

**Locator priority** (always prefer earlier shapes):
1. `--by testid --value <id>` — most stable
2. `--by role --value <role> --name "<accname>"` — accessible name
3. `--by label --value "<label>"` — form label
4. `--by placeholder --value "<text>"` — placeholder text
5. `--by text --value "<text>"` — link/button text
6. `--by css --value "<sel>"` — last resort

Use `--exact` to demand string equality on `--value` (default is substring).

**Actions** (each captured into the recording):

| Subcommand | Example |
|---|---|
| Navigate | `npx st4ck@latest browse navigate -s <slug> --url "https://example.com/dashboard"` |
| Click | `npx st4ck@latest browse click -s <slug> --by role --value button --name "Sign in"` |
| Fill | `npx st4ck@latest browse fill -s <slug> --by label --value "Email" --text "alice@example.com"` |
| Press | `npx st4ck@latest browse press -s <slug> --key Enter` (locator optional) |
| Select | `npx st4ck@latest browse select -s <slug> --by label --value "Country" --option-value "NL"` (one of `--option-value` / `--option-label` / `--option-index`) |
| Check_box | `npx st4ck@latest browse check_box -s <slug> --by label --value "I agree" --checked` (or `--unchecked`) |
| Hover | `npx st4ck@latest browse hover -s <slug> --by testid --value "tooltip-trigger"` |
| Upload | `npx st4ck@latest browse upload -s <slug> --by testid --value "file-input" --file /abs/path/photo.jpg` (`--file` repeats for multi-file) |
| Wait until | `npx st4ck@latest browse wait_until -s <slug> --js "document.querySelectorAll('[data-row]').length > 0" --timeout-ms 10000` |
| Evaluate | `npx st4ck@latest browse evaluate -s <slug> --js "document.title"` |

**Scope** — every locator-bearing action accepts `--scope-by <kind> --scope-value <v>` to constrain the locator to a container element (e.g. `--scope-by role --scope-value dialog` to disambiguate inside a modal).

**Text disambiguation** (when "Save" / "OK" / "Cancel" appears in multiple places):

| Subcommand | Example |
|---|---|
| Click by text | `npx st4ck@latest browse click-by-text -s <slug> --text "Save" --within-by role --within-value dialog` |
| Hover by text | `npx st4ck@latest browse hover-by-text -s <slug> --text "Settings" --role button` |
| Type by text | `npx st4ck@latest browse type-by-text -s <slug> --text "Search" --value "my query" --within-by role --within-value dialog` |

`--within-by` + `--within-value` accept any locator shape. `--role` narrows resolution without needing an ancestor. Use `--exact` to demand string equality.

**Conditional dispatch** — for "if X is visible, do A; else do B":

```bash
npx st4ck@latest browse branch -s <slug> --json '{"condition":{"kind":"visible","locator":{"by":"text","value":"Welcome back"},"timeout_ms":3000},"then":[],"else":[{"primitive":"click","args":{"locator":{"by":"role","value":"button","options":{"name":"Sign in"}}}},{"primitive":"wait_until","args":{"kind":"visible","locator":{"by":"text","value":"Welcome back"}}}]}'
```

`condition` uses the same grammar as `wait_until` (kind / locator / url / js). Sub-steps inside `then` / `else` use the saved-step shape `{primitive, args, opts?}`.

**Observation + diagnostic subcommands** (NOT recorded):

| Subcommand | Use |
|---|---|
| Snapshot | `npx st4ck@latest browse snapshot -s <slug>` — get the a11y tree of the page |
| URL | `npx st4ck@latest browse url -s <slug>` — get the current page URL |
| Page errors | `npx st4ck@latest browse page-errors -s <slug> [--no-clear]` — drain (default) or peek the buffer of uncaught exceptions thrown by the page since session start. Listener attaches before navigation, so module-load throws are caught. |

**Multi-session** — open two browsers under different `--session` names and interleave commands:

```bash
npx st4ck@latest browse launch https://app.com -s alice --record --out tests/alice.md
npx st4ck@latest browse launch https://app.com -s bob   --record --out tests/bob.md
npx st4ck@latest browse click -s alice --by role --value button --name "Login"
npx st4ck@latest browse fill  -s bob   --by label --value "Email" --text "bob@..."
npx st4ck@latest browse list   # see alive vs stale sessions
```

Each `-s <name>` routes to its own runner + browser context. `npx st4ck@latest browse list` enumerates active sessions.

### Step 2.5 — Reactive UIs (Bubble, Radix, Headless UI, MUI menus, etc.)

Some UIs need pointer-event chains rather than synthesized clicks: **Radix UI** dropdowns / popovers / menus, **Headless UI** menus + listboxes, **MUI menus** with custom-styled triggers, **shadcn/ui** components (Radix root underneath), and most no-code platforms (**Bubble**, **Retool**, **Webflow**, **n8n**, **Wix Velo**, **Glide**, **FlutterFlow**).

Symptom: `click` returns `status: "passed"` but the UI doesn't react. The result envelope's `evidence.result` carries `body_changed: false` — confirming the click hit a no-op.

**Fix:** launch with `--platform=<v>`. The wrapper forwards the flag to the runner, which (when supported) flips per-call reactive flags (`dispatch_chain`, `dispatch_events`, `atomic`) on as defaults for the whole session.

```bash
npx st4ck@latest browse launch https://app.bubbleapps.io --platform=bubble -s <slug> --record --out tests/<slug>.md
npx st4ck@latest browse launch https://radix-app.example.com --platform=auto -s <slug> --record --out tests/<slug>.md
```

Recognized values: `auto` | `web` | `bubble` | `retool` | `webflow` | `n8n` | `wix-velo` | `glide` | `flutterflow`. With `auto`, the runner detects via response headers > DOM probes > URL pattern.

Per-call `--dispatch-chain` / `--dispatch-events` / `--atomic` flags on individual subcommands are not yet first-class in the wrapper CLI; use session-level `--platform` for now.

### Step 2.6 — Fail-fast on 0-match locators

By default, `click` / `fill` / `select` / `hover` / `check_box` pre-check element count at issue time and fail immediately if zero elements match — rather than burning the full 30s timeout in Playwright's auto-wait. Auto-wait is for actionability (visible / enabled / stable), not existence; for "wait for an element to appear" first send `wait_until`. The fail-fast saves ~30s per typo'd selector.

### Step 2.7 — Click change-evidence

Every successful `click` returns evidence of whether the click changed page state. The result envelope's `evidence.result` carries `url_before` / `url_after` / `title_before` / `title_after` / `body_changed`. `body_changed: false` after a click you expected to do something signals a no-op — usually a Radix/Bubble component needing `--platform=<v>`, an invisible overlay, or an unbound handler.

### Step 3 — Strategy

1. **Snapshot first.** `npx st4ck@latest browse snapshot -s <slug>` to discover stable locators.
2. **Use stable locators.** `testid` > `role+name` > `label`.
3. **Wait deliberately.** After clicks that trigger navigation or modals, follow with `wait_until`.
4. **One block, one flow.** Don't add side-quests; capture the user's stated intent.
5. **Close when satisfied.** When the page state matches the user's instruction, close the session — the wrapper saves the recording.

### Step 4 — Finish + verify the md file

```bash
# Saves the trace (because launch was --record), exits 0.
npx st4ck@latest browse close -s <slug>

# OR — discard the session entirely.
npx st4ck@latest browse abort -s <slug> --reason "<short>"
```

`close` waits for the runner's `record_complete` envelope before cleaning up the session directory. The wrapper writes `tests/<slug>.md` (or wherever you set via `--out`) and exits 0. Surface a 1-line summary:

```
Recorded N primitives in tests/<slug>.md. Replay with: npx st4ck@latest run tests/<slug>.md
```

`abort` is **idempotent** — re-running it on a session that's already gone returns an `abort_noop` envelope and exits 0.

## Exit codes — per subcommand

| Code | Meaning |
|---|---|
| `0` | Action succeeded; envelope on stdout has `status: "passed"` (or `runner_ready` for launch). |
| `1` | Action failed; envelope on stdout has `status: "failed"` plus `error.class` + `error.detail`. |
| `2` | Session lock contention — couldn't acquire within 5s. Retry the command once. |
| `3` | Session is dead — runner PID gone. `browse abort -s <name>` then re-launch. |
| `4` | Runner protocol error — corrupt envelope, unexpected stream close, startup timeout. |
| `5` | Bad CLI input — unknown flag, malformed value, invalid session name. |

`launch` and `close` follow the same contract. `list` always exits `0`.

## Hard rules

- **No MCP. No key. No server connection.** Lite-tier means everything works offline against md files. If you find yourself reaching for `app.st4ck.io` tools — wrong skill; you're in the paid plugin's territory.
- **No human-click recording.** The agent drives. Human-click codegen frames the product as "yet another recorder"; agent-driven IS the differentiation.
- **No `mkfifo`. No `--ipc-fifo`. No `exec 9>FIFO`. No background `st4ck-runner record` with raw FIFO mechanics.** The `st4ck browse` CLI is the abstraction; the wrapper handles every layer below it. If you find yourself writing FIFO recipes, STOP — you're working at the wrong layer.
- **Don't author components.** Lite tier records flat primitive sequences into a single test md. The component layer (TRIAD, KB, intent_sources, signing) is the paid plugin's surface.
- **Don't sign tests.** Lite tier has no signing concept. The md file replays as-is.
- **Don't run the test from this skill.** Recording produces the md file; the user runs it via `/st4ck-lite:run` when ready.

## Replay

Replay is a separate skill — `/st4ck-lite:run <path>`:

```bash
npx st4ck@latest run tests/<slug>.md
```

Zero LLM. Pure Playwright. Reports pass/fail per block. Caller decides what to do with the verdict.
