---
description: Replay a recorded md test file deterministically. Zero LLM calls, zero cost, ~10× faster than the recording.
argument-hint: <path/to/test.md> [--headless]
---

# /st4ck-lite:run

Replays an md test file via the `st4ck` brand binary — pure Playwright execution, no LLM. The wrapper resolves the underlying runner on your behalf.

```bash
npx st4ck@latest run <file.md> [--headless]
```

`@latest` resolves to the current release at invocation time. Pin to an explicit version (e.g. `npx st4ck@0.2.0-alpha.1`) only when reproducibility matters.

## What to do

Spawn the runner with:
```bash
npx st4ck@latest run "$ARGUMENTS"
```

Stream stdio; mirror exit code. Surface the runner's `replay_complete` envelope in the response.

The md format is documented in the runner package. Files have YAML frontmatter (name, base_url, created_at) plus a `## Blocks` section with a fenced JSON code block carrying the primitive sequence.
