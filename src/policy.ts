import { createHash } from "node:crypto";
import type { WatchcodeConfig } from "./config.js";
import { normalizeText } from "./redact.js";
import { readState, writeState } from "./state.js";
import type {
  NotificationDecision,
  NotificationIntent,
  SafeNotification,
} from "./types.js";

export interface PolicyOptions {
  now?: () => number;
}

export class NotificationPolicy {
  private readonly now: () => number;

  constructor(
    private readonly config: WatchcodeConfig,
    options: PolicyOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async evaluate(intent: NotificationIntent): Promise<NotificationDecision> {
    if (!this.config.enabledEvents.includes(intent.reason))
      return { accepted: false, reason: "disabled" };
    if (
      !intent.agent?.trim() ||
      !intent.project?.trim() ||
      !intent.summary?.trim()
    ) {
      return { accepted: false, reason: "invalid" };
    }

    const createdAt = intent.createdAt ?? new Date(this.now()).toISOString();
    const title = normalizeText(
      intent.title || intent.reason,
      this.config.maxTitleLength,
    );
    const summary = normalizeText(intent.summary, this.config.maxSummaryLength);
    const agent = normalizeText(intent.agent, 40);
    const project = normalizeText(intent.project, 80);
    const rawDedupe =
      intent.dedupeKey || `${intent.reason}:${agent}:${project}:${summary}`;
    const dedupeKey = createHash("sha256")
      .update(rawDedupe)
      .digest("hex")
      .slice(0, 24);
    const notification: SafeNotification = {
      reason: intent.reason,
      agent,
      project,
      title,
      summary,
      urgency:
        intent.urgency ?? (intent.reason === "completed" ? "normal" : "high"),
      dedupeKey,
      createdAt,
      durationSeconds: Math.max(0, intent.durationSeconds ?? 0),
      ...(intent.sessionId
        ? { sessionId: normalizeText(intent.sessionId, 80) }
        : {}),
    };

    const now = this.now();
    const state = await readState(this.config.stateFile);
    const dedupeAt = state.dedupe[dedupeKey];
    if (
      dedupeAt !== undefined &&
      now - dedupeAt < this.config.dedupeWindowSeconds * 1000
    ) {
      return { accepted: false, reason: "duplicate" };
    }
    const cooldownKey = `${notification.reason}:${notification.agent}:${notification.project}`;
    const cooldownAt = state.cooldown[cooldownKey];
    if (
      cooldownAt !== undefined &&
      now - cooldownAt < this.config.cooldownSeconds * 1000
    ) {
      return { accepted: false, reason: "cooldown" };
    }

    const oldestUseful =
      now -
      Math.max(this.config.cooldownSeconds, this.config.dedupeWindowSeconds) *
        2000;
    state.dedupe = Object.fromEntries(
      Object.entries(state.dedupe).filter(([, at]) => at >= oldestUseful),
    );
    state.cooldown = Object.fromEntries(
      Object.entries(state.cooldown).filter(([, at]) => at >= oldestUseful),
    );
    state.dedupe[dedupeKey] = now;
    state.cooldown[cooldownKey] = now;
    await writeState(this.config.stateFile, state);
    return { accepted: true, reason: "accepted", notification };
  }

  async release(notification: SafeNotification): Promise<void> {
    const state = await readState(this.config.stateFile);
    delete state.dedupe[notification.dedupeKey];
    delete state.cooldown[
      `${notification.reason}:${notification.agent}:${notification.project}`
    ];
    await writeState(this.config.stateFile, state);
  }
}
