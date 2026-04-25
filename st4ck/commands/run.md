---
description: Replay a recorded md test file deterministically. Zero LLM calls, zero cost, ~10× faster than the recording.
argument-hint: <path/to/test.md> [--headless]
---

# /st4ck-lite:run

Replays an md test file via the `@st4ck/runner` npm package — pure Playwright execution, no LLM. Equivalent to:

```bash
npx @st4ck/cli run <file.md> [--headless]
```

## What to do

Spawn the runner with:
```bash
npx @st4ck/cli run "$ARGUMENTS"
```

Or if `@st4ck/runner` is available locally:
```bash
npx @st4ck/runner run --test-file "$ARGUMENTS" --no-mcp
```

Stream stdio; mirror exit code. Surface the runner's `replay_complete` envelope in the response.

The md format is documented in the `@st4ck/runner` package. Files have YAML frontmatter (name, base_url, created_at) plus a `## Blocks` section with a fenced JSON code block carrying the primitive sequence.
