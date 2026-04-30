---
name: qa-record-test
description: Record a deterministic md test file by walking through a site with the IPC primitive vocabulary. Triggers on phrases like "record this test", "capture this flow", "create a test for this site", or via the explicit `/st4ck-lite:author` slash command. Lite-tier: no account, no MCP key, no server connection — just md files.
---

# QA Recording — md File Authoring

You record a test by spawning the `@st4ck/runner` in record mode and driving it via IPC. Every primitive command you issue lands in the recording buffer; on `continue`, the runner serializes the buffer to a markdown file in the user's repo.

## What you receive

From the `/st4ck-lite:author` slash command (or free-text trigger):
- `url` — the target site
- `instruction` — natural-language description of what the test verifies
- Optional `out` path / `name` slug

## First action — confirm the runner is available

```bash
npx -y @st4ck/cli@alpha --help
```

If the user has `@st4ck/runner` installed locally, prefer the local binary; otherwise `npx` into the alpha. If neither works, surface the install instructions to the user and stop.

## Recording loop

### Step 1 — Spawn the runner — recommended one-line recipe

```bash
npx @st4ck/runner@alpha record <url> \
  --instruction "<instruction>" \
  --out tests/<slug>.md \
  --ipc-fifo /tmp/st4ck.fifo &
```

Run this with `run_in_background: true` so the runner stays alive while you iterate. The runner creates `/tmp/st4ck.fifo`, opens it `O_RDWR` (so external writers can come and go without the FIFO seeing EOF), reads commands from it, and unlinks it automatically on exit. Capture the `shell_id`. From now on:

- **Read** runner responses with `BashOutput(shell_id)`.
- **Send** commands by appending to the FIFO from any other Bash call: `echo '<json>' > /tmp/st4ck.fifo`.

The runner's first stdout envelope is the `runner_ready` envelope:

```json
{
  "type": "runner_ready",
  "page_url": "<url>",
  "page_errors": [],
  "blank_page_detected": false
}
```

`page_errors` is the buffer of uncaught exceptions thrown during page load (the listener attaches before navigation, so module-load throws are caught). `blank_page_detected: true` means `#root` (or sibling SPA mount points) is empty after a configurable delay (`--blank-page-delay <ms>`, default 4000) — usually correlates with non-empty `page_errors`. Disable detection with `--no-blank-page-check`.

### Step 1 (alternative) — without `--ipc-fifo`

If `mkfifo` isn't available (rare — plain Windows without WSL / Git Bash), the legacy 3-line recipe still works:

```bash
mkfifo /tmp/st4ck-stdin-$$
npx @st4ck/runner@alpha record <url> --instruction "<instruction>" --out tests/<slug>.md < /tmp/st4ck-stdin-$$ &
exec 9>/tmp/st4ck-stdin-$$
```

`exec 9>` keeps the FIFO writer-side open in the calling shell. Subsequent `echo '<json>' >&9` calls send commands. Fragile — `&` in the wrong place causes a deadlock. Prefer `--ipc-fifo` whenever you can.

### Step 2 — Drive the browser via IPC

Send one command via `echo '<json>' > /tmp/st4ck.fifo`. Read the result via `BashOutput(shell_id)`. Reason about it. Send the next command. Wait for each response before sending the next — never batch.

**Heredoc-friendly multi-line JSON.** `evaluate` JS strings with embedded quotes routinely produce JSON-escape pain when sent on a single line. The runner accumulates lines until JSON.parse succeeds, so heredocs work natively:

```bash
cat <<'EOF' > /tmp/st4ck.fifo
{"op":"evaluate",
 "js":"document.querySelectorAll('a, button').length"}
EOF
```

Single-line JSON parses on the first line (fast path). Multi-line JSON parses when the final `}` arrives.

**Locator priority** (always prefer earlier shapes):
1. `{by: 'testid', value: 'sign-in-button'}` — most stable
2. `{by: 'role', value: 'button', options: {name: 'Sign in'}}` — accessible name
3. `{by: 'label', value: 'Email address'}` — form label
4. `{by: 'placeholder', value: 'you@example.com'}` — placeholder text
5. `{by: 'text', value: 'Forgot password?'}` — link/button text
6. `{by: 'css', value: 'form > .submit'}` — last resort

**Actions** (each captured into the recording):

| Op | Shape |
|---|---|
| Navigate | `{"op":"navigate","url":"https://...","timeout_ms":30000}` |
| Click | `{"op":"click","locator":{...},"scope":"dialog"}` |
| Fill | `{"op":"fill","locator":{...},"value":"alice@example.com"}` |
| Press | `{"op":"press","key":"Enter","locator":{...}}` |
| Select | `{"op":"select","locator":{...},"value":"opt-1"}` |
| Check | `{"op":"check_box","locator":{...},"checked":true}` |
| Hover | `{"op":"hover","locator":{...}}` |
| Upload | `{"op":"upload","locator":{...},"files":["/abs/path"]}` |
| Wait | `{"op":"wait_until","args":{"kind":"visible","locator":{...}}}` |
| Eval | `{"op":"evaluate","js":"location.pathname"}` |

**Text disambiguation** (when "Save" / "OK" / "Cancel" appears in multiple places):

| Op | Shape |
|---|---|
| Click by text | `{"op":"click_by_text","text":"Save","within":"dialog"}` |
| Hover by text | `{"op":"hover_by_text","text":"Settings","role":"button"}` |
| Type by text | `{"op":"type_by_text","text":"Search","value":"my query","within":"dialog"}` |

`within` accepts `"dialog"` or any LocatorSpec. `role` narrows resolution without needing an ancestor.

**Conditional dispatch** — for "if X is visible, do A; else do B":

```json
{
  "op": "branch",
  "args": {
    "condition": {"kind":"visible","locator":{"by":"text","value":"Welcome back"},"timeout_ms":3000},
    "then": [],
    "else": [
      {"primitive":"click","args":{"locator":{"by":"role","value":"button","options":{"name":"Sign in"}}}},
      {"primitive":"wait_until","args":{"kind":"visible","locator":{"by":"text","value":"Welcome back"}}}
    ]
  }
}
```

`condition` uses the same grammar as `wait_until`. Sub-steps inside `then` / `else` use the saved-step shape `{primitive, args, opts?}` — not the IPC `op` shape.

**Observation + diagnostic** (NOT recorded):

| Op | Use |
|---|---|
| Snapshot | `{"op":"snapshot"}` — get a11y tree of the page |
| URL | `{"op":"url"}` — current page URL |
| Page errors | `{"op":"page_errors","clear":true}` — drain the buffer of uncaught exceptions thrown by the page since session start. The listener attaches before navigation, so module-load throws are caught. Pass `clear:false` to peek without clearing. |

**Control flow:**

| Op | Effect |
|---|---|
| Continue | `{"op":"continue"}` — finalize the recording, write the md, exit 0 |
| Abort | `{"op":"abort","reason":"..."}` — discard, exit 1 |

stdin closing (writer-side disappears, e.g. Ctrl-C in the holder shell, agent process dies) is treated as `eof` — the trace IS saved (same as `continue`), not discarded. Only an explicit `{"op":"abort",...}` discards.

### Step 2.5 — Reactive-UI flags (NOT just no-code platforms)

Three per-call flags handle frameworks that listen for full pointer event chains rather than Playwright's native synthesized events. **They apply to ANY reactive UI**, not just no-code platforms:

- **Radix UI** dropdowns / popovers / menus / context menus
- **Headless UI** menus + listboxes
- **MUI menus** with custom-styled triggers
- **shadcn/ui** components (same Radix root)
- **FlutterFlow**, **Bubble**, **Retool**, **Webflow**, **n8n**, **Wix Velo**, **Glide**

Set the relevant flag whenever a click visibly succeeds but the component doesn't react.

- **`click({dispatch_chain: true})`** — Plain `loc.click()` produces a synthetic click that reactive frameworks ignore. With `dispatch_chain:true`, the runner dispatches the full `pointerdown → pointerup → click` MouseEvent chain. Required on most Bubble button/icon clicks AND most Radix-driven UI.

  ```json
  {"op":"click","locator":{"by":"text","value":"Submit"},"dispatch_chain":true}
  ```

- **`fill({dispatch_events: ["input","change","blur"]})`** — Reactive bindings (Bubble, Radix-controlled inputs, Headless UI combobox values) only fire on dispatched events. After the value is set, the runner re-dispatches the named events with `bubbles:true`. Most reactive text inputs need `["input","change"]`; some additionally need `["blur"]`.

  ```json
  {"op":"fill","locator":{"by":"label","value":"Email"},"value":"alice","dispatch_events":["input","change"]}
  ```

- **`select({atomic: true})`** — Defeats the "Element not found" race that Bubble / Radix re-renders trigger during select. Performs set-value-and-dispatch-change in a single synchronous evaluate. Single-value only.

  ```json
  {"op":"select","locator":{"by":"label","value":"Country"},"value":"NL","atomic":true}
  ```

These are explicit per-call opt-ins — never silent autodetect on the page level.

### Step 2.6 — Session-level platform mode (forthcoming)

A session-level `--platform` flag is shipping in a near-term runner update. When set to a closed-loop platform, the per-call flags above flip on as **defaults** so you don't have to pass them on every primitive:

```bash
npx @st4ck/runner@alpha record <url> --platform=auto
npx @st4ck/runner@alpha record <url> --platform=bubble
```

Detection precedence when `--platform=auto`: explicit flag > response headers > DOM probe > URL pattern > `web` fallback.

Recognized values: `auto` | `web` | `bubble` | `retool` | `webflow` | `n8n` | `wix-velo` | `glide` | `flutterflow`. Until this ships in the runner you're using, set the per-call flags explicitly on every Bubble click/fill/select.

### Step 2.7 — Fail-fast on 0-match locators

By default, `click` / `fill` / `select` / `hover` / `check_box` pre-check `loc.count()` at issue time and fail immediately if zero elements match — rather than burning the full 30s timeout in Playwright's auto-wait. Auto-wait is for actionability (visible / enabled / stable), not existence; for "wait for an element to appear" use `{"op":"wait_until",...}` first. The fail-fast saves ~30s per typo'd selector or wrong role guess.

To restore Playwright's wait-for-element behavior on a specific call, set `fail_fast: false` in the args.

### Step 2.8 — Click change-evidence

Every successful `click` returns evidence of whether the click changed page state. The result envelope's `evidence.result` carries `url_before` / `url_after` / `title_before` / `title_after` / `body_changed`. `body_changed: false` after a click you expected to do something signals a no-op click — usually a missing `dispatch_chain: true` on a Radix/Bubble component, an invisible overlay, or an unbound handler.

### Step 3 — Strategy

1. **Snapshot first.** Send `{"op":"snapshot"}` to discover stable locators.
2. **Use stable locators.** `testid` > `role+name` > `label`.
3. **Wait deliberately.** After clicks that trigger navigation or modals, follow with `wait_until`.
4. **One block, one flow.** Don't add side-quests; capture the user's stated intent.
5. **Continue when satisfied.** When the page state matches the user's instruction, send `{"op":"continue"}`.

### Step 4 — Finish + verify the md file

When the page state matches the user's instruction, close out by appending the control command to the FIFO:

```bash
echo '{"op":"continue"}' > /tmp/st4ck.fifo    # saves the trace, exits 0
# OR
echo '{"op":"abort","reason":"<short>"}' > /tmp/st4ck.fifo   # discards, exits 1
```

The runner unlinks the FIFO automatically on exit. If you used the legacy recipe (no `--ipc-fifo`), also clean up the holder shell's writer end: `exec 9>&-; rm -f /tmp/st4ck-stdin-$$`.

`BashOutput(shell_id)` once more for the final `record_complete` envelope (on continue / EOF) or `agentic_aborted` (on abort) and the captured file path. The runner has written `tests/<slug>.md` and exited 0. Surface a 1-line summary:

```
Recorded N primitives in tests/<slug>.md. Replay with: npx @st4ck/cli run tests/<slug>.md
```

## Hard rules

- **No MCP. No key. No server connection.** Lite-tier means everything works offline against md files. If you find yourself reaching for `app.st4ck.io` tools — wrong skill; you're in the paid plugin's territory.
- **No human-click recording.** The agent drives. Human-click codegen frames the product as "yet another recorder"; agent-driven IS the differentiation.
- **Don't author components.** Lite tier records flat primitive sequences into a single test md. The component layer (TRIAD, KB, intent_sources, signing) is the paid plugin's surface.
- **Don't sign tests.** Lite tier has no signing concept. The md file replays as-is.
- **Don't run the test from this skill.** Recording produces the md file; the user runs it via `/st4ck-lite:run` when ready.

## Replay

Replay is a separate skill — `/st4ck-lite:run <path>`:

```bash
npx @st4ck/cli@alpha run tests/<slug>.md
```

Zero LLM. Pure Playwright. Reports pass/fail per block. Caller decides what to do with the verdict.
