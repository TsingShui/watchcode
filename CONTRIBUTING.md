# Contributing

1. Use Node.js 22 or newer.
2. Install dependencies with `npm ci`.
3. Run `npm run check` and `npm audit --omit=dev` before opening a pull request.
4. Add tests through public seams: notification policy, provider, adapter, CLI, or installer behavior.
5. Do not include personal paths, names, emails, device identifiers, session transcripts, credentials, or real notification content in commits, issues, fixtures, or screenshots.
6. Keep the MVP's notification channel limited to Apple Reminders unless the project scope is explicitly revised.
