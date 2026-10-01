export const notificationReasons = [
  "needs_input",
  "completed",
  "failed",
] as const;
export type NotificationReason = (typeof notificationReasons)[number];

export const urgencyLevels = ["normal", "high"] as const;
export type Urgency = (typeof urgencyLevels)[number];

export interface NotificationIntent {
  reason: NotificationReason;
  agent: string;
  project: string;
  title: string;
  summary: string;
  durationSeconds?: number;
  urgency?: Urgency;
  dedupeKey?: string;
  sessionId?: string;
  createdAt?: string;
}

export interface SafeNotification extends Required<
  Pick<
    NotificationIntent,
    | "reason"
    | "agent"
    | "project"
    | "title"
    | "summary"
    | "durationSeconds"
    | "urgency"
    | "dedupeKey"
    | "createdAt"
  >
> {
  sessionId?: string;
}

export type ProviderName = "apple-reminders";

export interface DeliveryResult {
  provider: ProviderName;
  ok: boolean;
  detail?: string;
}

export interface NotificationDecision {
  accepted: boolean;
  reason: "accepted" | "disabled" | "duplicate" | "cooldown" | "invalid";
  notification?: SafeNotification;
}

export interface SendReport {
  accepted: boolean;
  reason: NotificationDecision["reason"];
  deliveries: DeliveryResult[];
  notification?: SafeNotification;
}

export interface NotificationProvider {
  readonly name: ProviderName;
  send(notification: SafeNotification): Promise<DeliveryResult>;
  diagnose?(): Promise<DeliveryResult>;
}
