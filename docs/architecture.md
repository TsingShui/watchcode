# Architecture

WatchCode is split at three stable seams:

1. **Adapter seam** — Pi Extension, Codex hook, Codex MCP tool, or CLI converts host data to a `NotificationIntent`.
2. **Policy seam** — `NotificationPolicy.evaluate()` validates the three semantic reasons, minimizes/redacts text, and enforces cooldown/deduplication. Agent tools submit candidates; they cannot bypass policy.
3. **Provider seam** — `NotificationProvider.send()` delivers a `SafeNotification` through the sole MVP adapter, Apple Reminders. This seam keeps delivery replaceable without retaining dead implementations for unsupported channels.

This keeps host-specific lifecycle semantics out of delivery code and Apple automation details out of Agent-facing interfaces.

## Deterministic versus semantic events

- Pi `ui_prompt_start` gives a deterministic `needs_input` fallback; `agent_before_settle` produces `failed` once per session only when the fully settling run outcome is `error`.
- Codex `PermissionRequest` gives a deterministic `needs_input` fallback.
- Overall `completed`, semantic blockers, and semantic failures are declared through the constrained tool by the Agent.
- Pi `agent_settled`, Codex `Stop`, and Codex legacy `agent-turn-complete` are intentionally not completion signals.

## State

No daemon or queue exists in this MVP. Dedupe/cooldown state is a small local JSON file containing only hashes and timestamps. Notification delivery is best effort and never controls Agent execution.
