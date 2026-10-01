import type { NotificationReason, Urgency } from "./types.js";

export interface ToolIntentInput {
  reason: NotificationReason;
  title: string;
  summary: string;
  urgency?: Urgency;
  dedupeKey?: string;
  durationSeconds?: number;
}

export const notifyToolDescription = `Submit a candidate user notification to WatchCode. Call this only when one of these is true:
- needs_input: work cannot continue without a user choice, credential, approval, or missing information;
- completed: the user's overall requested task is complete and verification is finished;
- failed: the task cannot recover automatically.
Do not call for ordinary turn completion, intermediate progress, recoverable errors, or status narration. Include only a short privacy-safe summary; never include code, prompts, logs, full paths, credentials, or secrets.`;

export function isNotificationReason(
  value: unknown,
): value is NotificationReason {
  return value === "needs_input" || value === "completed" || value === "failed";
}
