---
name: watchcode-notify
description: Send a user notification only when Codex needs user intervention, has completed the user's overall task with verification, or has reached an unrecoverable failure.
---

Use the `watchcode` MCP server tool `notify_user` only at meaningful boundaries:

- `needs_input`: no useful work can continue without a user choice, credential, approval, or missing information.
- `completed`: the user's overall requested task is done and the promised verification has finished.
- `failed`: recovery is not possible without the user returning.

Do not notify for ordinary turn completion, intermediate steps, status narration, or recoverable errors. Do not equate Codex `Stop` / `agent-turn-complete` with task completion.

Keep `title` under 80 characters and `summary` under 500 characters. Include only a short result or requested action. Never include source code, prompts, logs, full paths, environment variables, tokens, passwords, or other secrets. Use a stable `dedupeKey` for retries of the same event.
