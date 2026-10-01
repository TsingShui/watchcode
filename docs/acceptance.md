# End-to-end acceptance checklist

## Automated gate

- [ ] `npm run check` exits 0.
- [ ] `npm audit --omit=dev` reports zero production vulnerabilities.
- [ ] Isolated-HOME install, reinstall, uninstall, backup, and restore tests pass, including restore preview, confirmation-before-write, and a safety backup of the pre-restore target.
- [ ] Repository and packed-artifact scans contain no unsupported notification provider implementation, configuration, credential variables, tests, or documentation.

## Apple Watch (manual)

- [ ] Same Apple Account and Reminders iCloud sync are enabled on Mac/iPhone/Watch.
- [ ] `watchcode diagnose` reports Apple Reminders OK.
- [ ] Run `watchcode test --reason needs_input` with the iPhone locked/asleep.
- [ ] A reminder appears in the dedicated WatchCode list.
- [ ] Apple Watch alerts; record observed delay: ______ seconds.
- [ ] Mark it complete and confirm old completed reminders are eligible for configured cleanup.

## Agent behavior (manual)

- [ ] Pi exposes `watchcode_notify`; `/watchcode-test` sends a manual test; semantic candidates are limited to `needs_input`, `completed`, or `failed` at documented boundaries.
- [ ] Codex exposes `mcp__watchcode__notify_user` and follows the WatchCode skill guidance.
- [ ] Codex `/hooks` shows the reviewed/trusted lifecycle hooks.
- [ ] A normal turn ending does not generate a completion notification.
- [ ] A notification failure does not fail or continue the Agent task.
