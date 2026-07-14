---
name: st4ck-browse
description: "Use the st4ck Browse CLI for browser driving, live UI verification, QA recording, Bubble exploration, and deterministic local test authoring."
---

# st4ck Browse

Use `npx st4ck@latest browse ...` when the user says “st4ck browse” or “st4ck browser,” or asks for st4ck-driven browser QA. Prefer this surface over generic browser automation unless the user explicitly asks for another tool.

## Verify the installed contract

```bash
npx -y st4ck@latest --help
npx -y st4ck@latest browse --help
npx -y st4ck@latest browse interactables --help
```

Any operation supports `browse <op> --help`. Runtime help is authoritative if this skill ever drifts.

## Launch and drive

```bash
npx st4ck@latest browse launch "https://example.com" \
  -s session-name \
  --instruction "Open the app and verify the requested behavior."
```

For recording, add `--record --out tests/flow-name.md`. Then observe and act one primitive at a time:

```bash
npx st4ck@latest browse snapshot -s session-name
npx st4ck@latest browse click -s session-name --locator-by role --locator-value button --name "Sign in"
npx st4ck@latest browse fill -s session-name --locator-by label --locator-value "Email" --text "user@example.com"
npx st4ck@latest browse wait_until -s session-name --locator-by role --locator-value main --kind visible
npx st4ck@latest browse page-errors -s session-name --no-clear
```

Use canonical locator kinds only: `testid`, `role`, `label`, `placeholder`, `text`, and `css`. Prefer them in that order, add `--name` for accessible role names, and use `--locator-index <n>` only when a collision-free handle returned by `interactables` includes it. Do not use legacy locator aliases in commands.

Use one snapshot to orient, then re-snapshot after navigation or structural UI changes. Do not keep using stale locators.

## Focused, low-token operations

```bash
npx st4ck@latest browse interactables -s session-name --filter buttons --grep "save|submit" --max 20
npx st4ck@latest browse locate -s session-name --locator-by role --locator-value button --name "Save"
npx st4ck@latest browse get-text -s session-name --locator-by css --locator-value ".toast" --format result
npx st4ck@latest browse assert-contains -s session-name --locator-by css --locator-value ".toast" --contains "Saved"
npx st4ck@latest browse scroll -s session-name --locator-by css --locator-value ".left-panel" --to bottom
npx st4ck@latest browse fill -s session-name --focused --text "Hebrew"
npx st4ck@latest browse click -s session-name --locator-by role --locator-value button --name "Submit" --settle
npx st4ck@latest browse list
npx st4ck@latest browse prune
```

`assert-contains` also supports `--equals` and `--matches`. `click --settle` stops at the first URL/body change; follow it with a final-state `wait_until` or assertion when intermediate renders are possible. Use `--format quiet` for repeated scripted operations and the default envelope while diagnosing failures.

## Reactive UI clicks

Use standard `click` first. If it passes without triggering a document-delegated, trust-gated, Bubble, Radix, or similar control, retry the same locator with `click_native`. Add the realistic pointer trail only if plain native click still fails:

```bash
npx st4ck@latest browse click_native -s session-name --locator-by role --locator-value button --name "Open menu"
npx st4ck@latest browse click_native -s session-name --locator-by css --locator-value ".bubble-element.Button" --pointer-sequence
```

The launch-level `--platform=auto|bubble|...` flag is for forward compatibility only. The current runner does not use it to alter click behavior, so do not rely on this launch flag today.

## Bubble exploration

```bash
npx st4ck@latest browse bubble_runtime_info -s session-name
npx st4ck@latest browse bubble_app_info -s session-name
npx st4ck@latest browse bubble_notifier_health -s session-name

npx st4ck@latest browse bubble_click -s session-name \
  --locator-by text --locator-value "Continue" \
  --refuse-if-conditional-disabled --verify-body-change

npx st4ck@latest browse bubble_fill -s session-name \
  --selector ".bubble-element.Input.email" --value "user@example.com" --wait-for-settled

npx st4ck@latest browse bubble_select -s session-name \
  --selector ".bubble-element.Dropdown.country" --value Israel --wait-for-settled
```

`bubble_fill` and `bubble_select` use their own CSS `--selector` plus data `--value` parser. `bubble_click` uses the standard locator flags and should include appropriate refusal/verification guards.

## Authorized auth state

For authorized ad-hoc driving, inject a Playwright storage-state file before first navigation. The file can impersonate the account, so restrict and remove it:

```bash
AUTH_STATE="$(mktemp "${TMPDIR:-/tmp}/st4ck-auth.XXXXXX")"
chmod 600 "$AUTH_STATE"
trap 'rm -f "$AUTH_STATE"' EXIT
# Write valid Playwright storageState JSON to $AUTH_STATE without logging it.
npx st4ck@latest browse launch "https://app.example.com" -s session-name --storage-state "$AUTH_STATE"
```

Never pass auth tokens through `--local-storage`; literal values and environment-variable expansions appear in process arguments. Do not submit passwords, passkeys, MFA, or account authorization prompts unless the user authorized that exact action. Pause for the user when human completion is required.

If launch reports `startup_timeout` on an auth page, inspect before abandoning the session:

```bash
npx st4ck@latest browse list
tail -n 80 ~/.st4ck/sessions/session-name/runner.log
```

Retry with `--no-blank-page-check` or a fresh session name when appropriate. Do not close unrelated browser windows.

## Finish and replay

```bash
npx st4ck@latest browse close -s session-name
npx st4ck@latest run tests/flow-name.md
```

Use `browse abort -s session-name --reason "<short>"` to discard an unsafe or incomplete recording.

## Product boundary

The current Lite recording skill emits a flat trace. Basic local reusable components are intended to remain open source, but no local component registry or component-authoring workflow ships in this alpha; do not invent a format. The full `st4ck` plugin plus a st4ck workspace adds shared database-backed tests/components, MCP authoring and execution, lifecycle links, governance, and team-visible history.
