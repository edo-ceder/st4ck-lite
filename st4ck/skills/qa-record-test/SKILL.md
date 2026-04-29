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

### Step 1 — Spawn the runner with a stdin FIFO

The runner emits an `agentic_pause` envelope on stdout and reads line-delimited JSON commands on stdin until you send `{"op":"continue"}` or `{"op":"abort"}`. Each command returns one `ActionResult` JSON object on stdout. To drive it incrementally from Claude Code's blocking Bash tool, spawn the runner with a stdin FIFO so you can send commands one at a time between observations:

```bash
mkfifo /tmp/st4ck-stdin-$$
npx @st4ck/runner@alpha record <url> \
  --instruction "<instruction>" \
  --out tests/<slug>.md \
  < /tmp/st4ck-stdin-$$ &
exec 9>/tmp/st4ck-stdin-$$
```

Run this with `run_in_background: true` so the FIFO stays open while you iterate. Capture the `shell_id`. From now on:

- **Read** runner responses with `BashOutput(shell_id)`.
- **Send** commands with `echo '<json>' >&9` (one JSON object per line).

Read the `agentic_pause` envelope before sending anything else — it confirms the page loaded and gives you `page_url`.

### Step 2 — Drive the browser via IPC

Send one command via `echo '<json>' >&9`. Read the result via `BashOutput(shell_id)`. Reason about it. Send the next command. Wait for each response before sending the next — never batch.

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

**Observation** (NOT recorded):

| Op | Use |
|---|---|
| Snapshot | `{"op":"snapshot"}` — get a11y tree of the page |
| URL | `{"op":"url"}` — current page URL |

**Control flow:**

| Op | Effect |
|---|---|
| Continue | `{"op":"continue"}` — finalize the recording, write the md, exit 0 |
| Abort | `{"op":"abort","reason":"..."}` — discard, exit 1 |

### Step 2.5 — No-code platform flags (per-call opt-ins)

Bubble, Retool, Webflow, n8n, Wix Velo, Glide, and FlutterFlow have reactive runtimes that ignore some of Playwright's native primitive calls. Three per-call flags handle the difference. Set them on every relevant primitive when working against a no-code platform.

- **`click({dispatch_chain: true})`** — Bubble swallows plain `loc.click()`. With `dispatch_chain:true`, the runner dispatches the full `pointerdown → pointerup → click` MouseEvent chain. Required on most Bubble button/icon clicks.

  ```json
  {"op":"click","locator":{"by":"text","value":"Submit"},"dispatch_chain":true}
  ```

- **`fill({dispatch_events: ["input","change","blur"]})`** — Bubble's reactive bindings only fire on dispatched events. After the value is set, the runner re-dispatches the named events with `bubbles:true`. Most Bubble text inputs need `["input","change"]`; some additionally need `["blur"]`.

  ```json
  {"op":"fill","locator":{"by":"label","value":"Email"},"value":"alice","dispatch_events":["input","change"]}
  ```

- **`select({atomic: true})`** — Defeats Bubble's "Element not found" race during re-render. Performs set-value-and-dispatch-change in a single synchronous evaluate. Single-value only.

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

### Step 3 — Strategy

1. **Snapshot first.** Send `{"op":"snapshot"}` to discover stable locators.
2. **Use stable locators.** `testid` > `role+name` > `label`.
3. **Wait deliberately.** After clicks that trigger navigation or modals, follow with `wait_until`.
4. **One block, one flow.** Don't add side-quests; capture the user's stated intent.
5. **Continue when satisfied.** When the page state matches the user's instruction, send `{"op":"continue"}`.

### Step 4 — Finish + verify the md file

When the page state matches the user's instruction, close out:

```bash
echo '{"op":"continue"}' >&9    # OR: echo '{"op":"abort","reason":"…"}' >&9
exec 9>&-
rm -f /tmp/st4ck-stdin-$$
```

`BashOutput(shell_id)` once more for the final `record_complete` envelope (on continue) or `agentic_aborted` (on abort) and the captured file path. The runner has written `tests/<slug>.md` and exited 0. Surface a 1-line summary:

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
