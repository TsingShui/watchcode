# WatchCode

[![CI](https://github.com/TsingShui/watchcode/actions/workflows/ci.yml/badge.svg)](https://github.com/TsingShui/watchcode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

WatchCode sends privacy-minimized Apple Reminders when a coding agent **needs you**, **finishes the overall task**, or **cannot recover**. iCloud synchronizes those reminders to iPhone and Apple Watch. This MVP supports Pi and OpenAI Codex and has exactly one notification channel: Apple Reminders.

## What it sends

Only these event types are enabled by default:

- `needs_input` — work cannot continue without the user.
- `completed` — the user's overall request is complete and verification finished.
- `failed` — the task cannot recover automatically.

An ordinary model turn, Codex `Stop`, or `agent-turn-complete` is **not** treated as task completion. Agent tools submit notification candidates; the local policy applies event filters, redaction, length limits, cooldown, and deduplication before Apple automation runs.

Default payload: project basename, agent, state, elapsed time, and a short summary. Prompts, code, logs, full paths, and credentials are intentionally excluded and common secret patterns are redacted.

## Requirements

- macOS with Reminders enabled in iCloud for Apple Watch delivery.
- Node.js 22 or newer.
- Pi and/or Codex CLI.

No server, account, API key, or third-party notification application is required.

## Install

Clone and build the project:

```bash
git clone https://github.com/TsingShui/watchcode.git
cd watchcode
npm ci
npm run build
npm link                       # optional: exposes `watchcode`
watchcode install --target all # previews and asks before writing
```

Pi can also install the public Git repository directly after the project has been built in a persistent local checkout:

```bash
pi install git:github.com/TsingShui/watchcode
```

> Keep this checkout (including `dist/`) at the same absolute path after installation. Moving or deleting it breaks the configured Pi extension and Codex MCP/hook commands; rerun the installer after moving it. A published npm install will use its installed package path.

The installer:

- adds this package path to `~/.pi/agent/settings.json`;
- adds the WatchCode MCP server to `~/.codex/config.toml`;
- merges a small `SessionStart` policy hook and asynchronous `PermissionRequest` hook into `~/.codex/hooks.json`;
- preserves existing settings and creates timestamped backups before every changed existing file;
- is idempotent and supports `watchcode uninstall` and `watchcode restore`;
- previews every restore, asks for confirmation unless `--yes` was supplied, and first makes a timestamped safety backup of the current target so the restore itself can be undone.

Use `--yes` only after reviewing the printed plan. Restart Pi/Codex after installation. In Codex, run `/hooks` and explicitly review/trust the installed command hook. Project-local Codex configuration is not used because user-level machine commands are the supported location.

### Codex plugin alternative

The repository also contains a portable `plugin.json`, `mcp.json`, `skills/`, and bundled `hooks/` layout. It can be placed under a Codex marketplace's plugin directory and listed as a local plugin. The bundled MCP server is self-contained; npm dependencies are not required at runtime in the plugin cache. Codex plugin support and trust behavior vary by client; the interactive installer above is the tested CLI path.

## Configure

Create `~/.watchcode/config.json`:

```json
{
  "enabledEvents": ["needs_input", "completed", "failed"],
  "providers": ["apple-reminders"],
  "cooldownSeconds": 60,
  "dedupeWindowSeconds": 300,
  "maxTitleLength": 80,
  "maxSummaryLength": 240,
  "apple": {
    "listName": "WatchCode",
    "dueInSeconds": 15,
    "cleanupAfterDays": 7
  }
}
```

Or create defaults without overwriting an existing file:

```bash
watchcode init --yes
```

Notification failures are reported but never interrupt the agent task.

## Apple Reminders and Apple Watch

WatchCode creates a time-based reminder in a dedicated `WatchCode` list in the default Reminders account. The first run asks macOS for Automation permission. Old **completed** reminders in that list are cleaned after the configured number of days; incomplete notifications are never silently deleted.

Prerequisites:

1. Use the same Apple Account on Mac, iPhone, and Apple Watch.
2. Enable **System Settings → Apple Account → iCloud → Reminders** on Mac and iPhone.
3. On iPhone, open **Watch → Notifications → Reminders → Allow Notifications**.
4. Ensure the Watch is worn/unlocked and the iPhone is locked or asleep when testing (Apple normally alerts one device, not both).

Test:

```bash
watchcode diagnose
watchcode test --reason needs_input
```

Within roughly 15–60 seconds, confirm that a `WatchCode` reminder appears and the Watch alerts. iCloud synchronization is not a hard real-time delivery guarantee. The MVP acceptance run has already been confirmed on a physical Apple Watch; see `docs/acceptance-results.md`.

If denied, enable the terminal/Node host under **System Settings → Privacy & Security → Automation → Reminders**, then retry.

## CLI

```bash
watchcode notify \
  --reason needs_input \
  --agent Pi \
  --project watchcode \
  --title 'Need a decision' \
  --summary 'Choose migration strategy A or B' \
  --dedupe-key migration-choice

watchcode diagnose
# In Pi, `/watchcode-test` exercises the same configured provider.
watchcode install --target pi
watchcode install --target codex
watchcode uninstall --target all
watchcode restore --file ~/.codex/config.toml.watchcode-backup-...
```

Exit code `0` means Apple Reminders delivered an accepted notification. Exit code `2` means policy suppressed it or delivery failed. Invalid commands/configuration return `1`.

## Privacy and security

- WatchCode never lets the model select a recipient or automation target.
- The Agent can submit only a bounded candidate with three reasons; local policy decides delivery.
- Default messages contain no source text, prompt, log, full path, environment value, or tool output.
- Provider errors are shortened before returning to an Agent.
- The dedupe state contains only hashes and timestamps at `~/.watchcode/state.json` (mode `0600`).
- Reminder content synchronizes through the user's iCloud account. Disable the extension if that data flow is inappropriate.
- Review Pi packages and Codex hooks/MCP servers before trusting them.

## Development and verification

The source repository is public at [github.com/TsingShui/watchcode](https://github.com/TsingShui/watchcode).

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

```bash
npm run format
npm run check
npm audit --omit=dev
```

Tests exercise the public notification, provider, adapter, CLI, and installer seams: policy filtering, redaction, deduplication, cooldown and retry, Apple command argument safety, Pi events/tool registration, Codex event mapping, and isolated-HOME install/reinstall/uninstall/restore.

## Troubleshooting

- **Apple reminder created but Watch is silent:** lock the iPhone, check Watch/Reminders notification settings and Focus mode, and verify iCloud sync.
- **Automation permission denied:** enable the terminal/Node host under **System Settings → Privacy & Security → Automation → Reminders**.
- **Codex tool missing:** restart Codex and inspect `codex mcp list`; review `/hooks` separately for deterministic permission notifications.
- **Pi tool missing:** restart Pi and run `pi list`; confirm this checkout's absolute path is present.
- **Duplicate or noisy notifications:** increase `cooldownSeconds`/`dedupeWindowSeconds`, or remove an event from `enabledEvents`.
