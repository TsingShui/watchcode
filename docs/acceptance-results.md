# MVP acceptance results

Date: 2026-10-01

## Apple Reminders → Apple Watch

- `watchcode diagnose` reported Apple Reminders automation available.
- `watchcode test --reason needs_input` created a reminder in the dedicated WatchCode list.
- The user confirmed the reminder reached Apple Watch.

Result: **passed**.

## Automated and packaging gates

- `npm run check`: passed; formatting, strict type checking, clean build, and 30 tests all succeeded.
- `npm audit --omit=dev`: zero production vulnerabilities.
- Clean-checkout `npm ci --ignore-scripts` followed by `npm run check`: passed.
- Isolated HOME: install, idempotent reinstall, configuration preservation, restore preview, restore safety backup, restore undo, and uninstall all passed.
- Pi extension load and Codex MCP packaged-tool discovery passed.
- Packed MCP bundle ran without `node_modules`.
- Source, build output, and packed artifact scans found no removed notification-channel implementation, configuration, credential variables, tests, or documentation.
- The AppleScript compiled successfully and live diagnostics reported Reminders automation available.

No prompt, code, log, full path, credential, or secret is recorded in the reminder payload or this evidence file.
