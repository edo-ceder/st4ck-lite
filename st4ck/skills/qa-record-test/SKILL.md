---
name: qa-record-test
description: "Record a deterministic Markdown UI test by driving a site with the st4ck Browse CLI. Use for record-test, capture-flow, browser-QA, and st4ck-lite authoring requests."
---

# QA Recording — Local Markdown Test Authoring

Drive `npx st4ck@latest browse ...` one operation at a time in `--record` mode. Read each result before deciding the next action. On `close`, the runner writes the captured primitive sequence as a deterministic Markdown test in the user's repository.

The current recording skill emits one flat trace. Basic local reusable component authoring is intended to remain open source, but this alpha does not ship a local component registry or component-authoring workflow. Do not invent a component format. Shared database-backed tests/components, MCP authoring, lifecycle links, and workspace policy belong to the full `st4ck` plugin plus a st4ck workspace.

Never run `mkfifo`, start `st4ck-runner` directly, or write raw IPC. The Browse CLI owns the runner and session lifecycle.

## Confirm the runtime contract

```bash
npx -y st4ck@latest --help
npx -y st4ck@latest browse --help
npx -y st4ck@latest browse interactables --help
```

Use `browse <op> --help` for the exact flags of any operation. Runtime help is authoritative if installed skill prose ever drifts. For reproducible CI, replace `@latest` with a version returned by `npm view st4ck versions`.

## 1. Launch a recording

```bash
npx st4ck@latest browse launch <url> \
  --session <slug> \
  --record --out tests/<slug>.md \
  --instruction "<one-line behavior to verify>"
```

The wrapper opens a persistent named browser session and prints a `runner_ready` envelope. Inspect its final `page_url`, `redirected`, `page_errors`, and `blank_page_detected` fields before acting. For a slow but valid mount, raise `--blank-page-delay <ms>` or use `--no-blank-page-check`; do not assume a timed-out browser was closed without checking `browse list` and `~/.st4ck/sessions/<slug>/runner.log`.

Important launch options include:

| Need | Flag |
|---|---|
| Real device characteristics | `--device "iPhone 14 Pro"` |
| Viewport only | `--viewport 393x852` |
| Locale and timezone | `--locale he-IL --timezone-id Asia/Jerusalem` |
| Theme/accessibility media | `--color-scheme dark --reduced-motion reduce --forced-colors active` |
| Location | `--geolocation 32.0853,34.7818` |
| Additional Playwright context options | `--context-options '<json>'` |
| Seed authorized cookies/localStorage before navigation | `--storage-state <file>` |
| Headless execution | `--headless` |

### Authorized auth-state injection

For authorized ad-hoc driving, mint a Playwright storage-state file with the app's own trusted API. The file can impersonate the account, so create it with restricted permissions, never print or commit it, and remove it after the launch command:

```bash
AUTH_STATE="$(mktemp "${TMPDIR:-/tmp}/st4ck-auth.XXXXXX")"
chmod 600 "$AUTH_STATE"
trap 'rm -f "$AUTH_STATE"' EXIT

# Write valid Playwright storageState JSON to $AUTH_STATE without logging it.
npx st4ck@latest browse launch https://app.example.com \
  -s authed --record --out tests/authed.md --storage-state "$AUTH_STATE"
```

Only the temporary path appears in process arguments. Never pass an auth token through `--local-storage`; literal values and environment-variable expansions are visible in argv. Recorded tests should establish ordinary user state through the UI. Password, MFA, passkey, and authorization prompts require the user's explicit authorization; pause for human completion when needed.

## 2. Orient, narrow, act, verify

Use one snapshot to understand page structure, then use focused operations for local questions:

```bash
npx st4ck@latest browse snapshot -s <slug>
npx st4ck@latest browse interactables -s <slug> --filter buttons --grep "save|submit" --max 20
npx st4ck@latest browse locate -s <slug> --locator-by role --locator-value button --name "Save"
npx st4ck@latest browse get-text -s <slug> --locator-by css --locator-value ".toast" --format result
npx st4ck@latest browse assert-contains -s <slug> --locator-by css --locator-value ".toast" --contains "Saved"
```

`interactables` returns ready-to-paste handles. When role/name matches collide, the handle includes `--locator-index <n>`; paste it rather than guessing. `assert-contains` also accepts `--equals` or `--matches` and exits nonzero on a miss. For repeated scripted reads, `--format quiet` retains status and key evidence; keep the default envelope while diagnosing a failure.

### Canonical locator flags

Locator-bearing operations use:

| Flag | Meaning |
|---|---|
| `--locator-by <kind>` | `testid`, `role`, `label`, `placeholder`, `text`, or `css` |
| `--locator-value <value>` | Value matched by the locator kind |
| `--name "<accessible name>"` | Accessible name for a role locator |
| `--exact` | Require exact string matching |
| `--locator-index <n>` | Choose the zero-based Nth match |
| `--scope-by <kind> --scope-value <value>` | Restrict resolution to a container |

Prefer `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. Those six are the complete supported locator set. Do not use legacy locator aliases in authored commands.

### Recorded actions

```bash
# Navigate only when navigation itself is not the behavior under test.
npx st4ck@latest browse navigate -s <slug> --url "https://example.com/dashboard"

npx st4ck@latest browse click -s <slug> --locator-by role --locator-value button --name "Sign in"
npx st4ck@latest browse fill -s <slug> --locator-by label --locator-value "Email" --text "alice@example.com"
npx st4ck@latest browse press -s <slug> --key Enter
npx st4ck@latest browse select -s <slug> --locator-by label --locator-value "Country" --option-value NL
npx st4ck@latest browse check_box -s <slug> --locator-by label --locator-value "I agree" --checked
npx st4ck@latest browse hover -s <slug> --locator-by testid --locator-value tooltip-trigger
npx st4ck@latest browse upload -s <slug> --locator-by testid --locator-value file-input --file fixtures/photo.jpg
```

Upload inputs must resolve inside the repository working directory unless `ST4CK_ALLOWED_FILE_ROOTS` was explicitly set before launch. Prefer repo-relative test fixtures.

Use `fill --focused` when opening a reactive picker focuses an otherwise unstable search input:

```bash
npx st4ck@latest browse fill -s <slug> --focused --text "Hebrew"
```

Scroll the document, a nested scroller, or a target into view explicitly:

```bash
npx st4ck@latest browse scroll -s <slug> --to bottom
npx st4ck@latest browse scroll -s <slug> --locator-by css --locator-value ".left-panel" --to bottom
npx st4ck@latest browse scroll -s <slug> --locator-by role --locator-value button --name "Submit" --to element
```

### Waits and final-state proof

```bash
npx st4ck@latest browse wait_until -s <slug> --url "**/dashboard"
npx st4ck@latest browse wait_until -s <slug> --locator-by role --locator-value main --kind visible
npx st4ck@latest browse wait_until -s <slug> --kind networkidle --idle-window-ms 1500
npx st4ck@latest browse wait_until -s <slug> --js "document.querySelectorAll('[data-row]').length > 0"
```

Use `click --settle` when an async click may delay its first URL/body mutation:

```bash
npx st4ck@latest browse click -s <slug> --locator-by role --locator-value button --name "Submit" --settle
```

`--settle` stops after the first observed URL/body change. It does not prove the final state; follow it with a specific `wait_until` or deterministic assertion when intermediate renders are possible. Network idle is likewise not a business assertion.

### Reactive UI click escalation

Start with standard `click`; it is cheaper and correct for ordinary buttons and links. If it passes without triggering a document-delegated, `event.isTrusted`-gated, Bubble, or Radix-style control, retry the same locator with `click_native`. Add the realistic pointer trail only if the plain native click still fails:

```bash
npx st4ck@latest browse click -s <slug> --locator-by role --locator-value button --name "Open menu"
npx st4ck@latest browse click_native -s <slug> --locator-by role --locator-value button --name "Open menu"
npx st4ck@latest browse click_native -s <slug> --locator-by css --locator-value ".bubble-element.Button" --pointer-sequence
```

The launch-level `--platform=auto|bubble|...` flag is for forward compatibility only. The current runner does not use it to change click behavior, so do not rely on this launch flag today. A `body_changed: false` result is a diagnostic signal—not proof of the cause; inspect overlays/handlers if native click also does nothing.

### Bubble-aware operations

Run Bubble diagnostics before a Bubble flow, then use the purpose-built operations where they fit:

```bash
npx st4ck@latest browse bubble_runtime_info -s <slug>
npx st4ck@latest browse bubble_app_info -s <slug>
npx st4ck@latest browse bubble_notifier_health -s <slug>

npx st4ck@latest browse bubble_click -s <slug> \
  --locator-by text --locator-value "Continue" \
  --refuse-if-conditional-disabled --verify-body-change

npx st4ck@latest browse bubble_fill -s <slug> \
  --selector ".bubble-element.Input.email" --value "alice@example.com" --wait-for-settled

npx st4ck@latest browse bubble_select -s <slug> \
  --selector ".bubble-element.Dropdown.country" --value Israel --wait-for-settled
```

`bubble_fill` and `bubble_select` intentionally use their own CSS `--selector` plus data `--value` parser. `bubble_click` uses the standard locator flags and should include the relevant refusal/verification guard.

### Observation and multi-session control

```bash
npx st4ck@latest browse url -s <slug>
npx st4ck@latest browse page-errors -s <slug> --no-clear
mkdir -p .st4ck/screenshots
npx st4ck@latest browse screenshot -s <slug> --out .st4ck/screenshots/page.png --full-page
npx st4ck@latest browse screenshot -s <slug> --out .st4ck/screenshots/save.png --locator-by role --locator-value button --name "Save"
npx st4ck@latest browse list
npx st4ck@latest browse prune
```

`snapshot`, `url`, `page-errors`, `screenshot`, `interactables`, `locate`, and `get-text` observe the page without becoming recorded test steps. Re-orient after navigation or structural UI changes rather than reusing stale locators.

For two roles, launch separate names and interleave commands deliberately:

```bash
npx st4ck@latest browse launch https://app.example.com -s alice --record --out tests/alice.md
npx st4ck@latest browse launch https://app.example.com -s bob --record --out tests/bob.md
npx st4ck@latest browse click -s alice --locator-by role --locator-value button --name "Login"
npx st4ck@latest browse fill -s bob --locator-by label --locator-value "Email" --text "bob@example.com"
```

## 3. Close or abort

After the expected state is explicitly proven:

```bash
npx st4ck@latest browse close -s <slug>
```

If the journey cannot safely continue, discard the recording:

```bash
npx st4ck@latest browse abort -s <slug> --reason "<short reason>"
```

`close` waits for `record_complete`, writes the requested Markdown file, and cleans the session. `abort` is idempotent.

Report the artifact and replay command:

```text
Recorded the verified flow in tests/<slug>.md.
Replay: npx st4ck@latest run tests/<slug>.md
```

## Current local component boundary

- This skill records a flat primitive trace; it does not silently split the trace into components.
- Basic local reusable components are intended for the open-source surface, not reserved as a paid-only concept.
- No local component registry or authoring format ships in this alpha. Until one exists, do not invent files, schemas, or commands.
- The full `st4ck` + workspace surface adds shared database-backed reuse, MCP operations, lifecycle context, governance, and team-visible history.

## Hard rules

- No MCP, account, API key, or server connection is required for this Lite recording/replay path.
- One browser operation per Bash call; read its result before the next action.
- Never drive below `st4ck browse`, never write FIFO recipes, and never start the runner manually.
- Do not mutate page state with `evaluate` to make a test pass; use user-visible operations.
- Do not claim success from a mechanical click alone; prove the user-visible final state.
- Do not sign or attest local traces. The local runner replays the Markdown as-is.
