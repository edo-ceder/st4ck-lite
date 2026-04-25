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

### Step 1 — Spawn the runner in record mode

```bash
npx @st4ck/cli@alpha author <url> "<instruction>" --out tests/<slug>.md
```

The CLI writes `.st4ck/session.md` (the skill, you're reading the runtime version of it) and prints a one-liner. Then run:

```bash
npx @st4ck/runner@alpha record <url> --instruction "<instruction>" --out tests/<slug>.md
```

The runner emits an `agentic_pause` envelope on stdout and waits for IPC commands on stdin.

### Step 2 — Drive the browser via IPC

Send line-delimited JSON commands. Wait for each response before sending the next.

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
| Click | `{"op":"click","locator":{...}}` |
| Fill | `{"op":"fill","locator":{...},"value":"alice@example.com"}` |
| Press | `{"op":"press","key":"Enter","locator":{...}}` |
| Select | `{"op":"select","locator":{...},"value":"opt-1"}` |
| Check | `{"op":"check_box","locator":{...},"checked":true}` |
| Hover | `{"op":"hover","locator":{...}}` |
| Upload | `{"op":"upload","locator":{...},"files":["/abs/path"]}` |
| Wait | `{"op":"wait_until","args":{"kind":"visible","locator":{...}}}` |
| Eval | `{"op":"evaluate","js":"location.pathname"}` |

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

### Step 3 — Strategy

1. **Snapshot first.** Send `{"op":"snapshot"}` to discover stable locators.
2. **Use stable locators.** `testid` > `role+name` > `label`.
3. **Wait deliberately.** After clicks that trigger navigation or modals, follow with `wait_until`.
4. **One block, one flow.** Don't add side-quests; capture the user's stated intent.
5. **Continue when satisfied.** When the page state matches the user's instruction, send `{"op":"continue"}`.

### Step 4 — Verify the md file

After `continue`, the runner writes `tests/<slug>.md` and exits 0. Verify the file exists; show the user a 1-line summary:

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
