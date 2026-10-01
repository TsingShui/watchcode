# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue containing secrets, private file paths, notification contents, or personal information.

## Privacy model

WatchCode sends only a bounded, locally redacted summary to Apple Reminders. It does not require provider credentials or a hosted service. The reminder then follows the user's own iCloud synchronization settings.

Never commit local configuration, state, session transcripts, credentials, or generated reminder contents. The repository ignore rules exclude `.env*`, `.pi/`, build output, logs, and local state.
