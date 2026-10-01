import type { WatchcodeConfig } from "./config.js";
import { NotificationPolicy } from "./policy.js";
import type {
  NotificationIntent,
  NotificationProvider,
  SendReport,
} from "./types.js";

export class WatchcodeNotifier {
  constructor(
    private readonly config: WatchcodeConfig,
    private readonly providers: Map<string, NotificationProvider>,
    private readonly policy = new NotificationPolicy(config),
  ) {}

  async notify(intent: NotificationIntent): Promise<SendReport> {
    const decision = await this.policy.evaluate(intent);
    if (!decision.accepted || !decision.notification) {
      return { accepted: false, reason: decision.reason, deliveries: [] };
    }

    const selected = this.config.providers
      .map((name) => this.providers.get(name))
      .filter((p): p is NotificationProvider => Boolean(p));
    const deliveries = await Promise.all(
      selected.map(async (provider) => {
        try {
          return await provider.send(decision.notification!);
        } catch (error) {
          return {
            provider: provider.name,
            ok: false,
            detail: safeError(error),
          };
        }
      }),
    );
    if (!deliveries.some((delivery) => delivery.ok)) {
      await this.policy.release(decision.notification);
    }
    return {
      accepted: true,
      reason: "accepted",
      deliveries,
      notification: decision.notification,
    };
  }
}

function safeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown provider error";
  return message.replace(/https?:\/\/\S+/g, "[REDACTED_URL]").slice(0, 200);
}
