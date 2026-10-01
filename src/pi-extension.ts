import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createNotifier } from "./runtime.js";
import { safeProjectName } from "./project.js";
import { notifyToolDescription } from "./tool-schema.js";
import type { NotificationReason } from "./types.js";

export interface PiNotifierLike {
  notify(intent: {
    reason: NotificationReason;
    agent: string;
    project: string;
    title: string;
    summary: string;
    urgency?: "normal" | "high";
    dedupeKey?: string;
    durationSeconds?: number;
    sessionId?: string;
  }): Promise<{
    accepted: boolean;
    reason: string;
    deliveries: Array<{ provider: string; ok: boolean; detail?: string }>;
  }>;
}

export function registerPiExtension(
  pi: ExtensionAPI,
  load: () => Promise<PiNotifierLike> = () => createNotifier(),
): void {
  let sessionStartedAt = Date.now();
  let lastCwd = process.cwd();
  let lastSessionId: string | undefined;
  let failureNotified = false;
  let notifierPromise: Promise<PiNotifierLike> | undefined;
  const notifier = () => (notifierPromise ??= load());

  const tool = defineTool({
    name: "watchcode_notify",
    label: "WatchCode Notify",
    description: notifyToolDescription,
    parameters: Type.Object({
      reason: Type.Unsafe<NotificationReason>({
        type: "string",
        enum: ["needs_input", "completed", "failed"],
      }),
      title: Type.String({
        minLength: 1,
        maxLength: 80,
        description: "Short notification title without secrets",
      }),
      summary: Type.String({
        minLength: 1,
        maxLength: 500,
        description: "Privacy-safe result or required user action",
      }),
      urgency: Type.Optional(
        Type.Unsafe<"normal" | "high">({
          type: "string",
          enum: ["normal", "high"],
        }),
      ),
      dedupeKey: Type.Optional(Type.String({ maxLength: 120 })),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) {
      try {
        const durationSeconds = Math.max(
          0,
          (Date.now() - sessionStartedAt) / 1000,
        );
        const report = await (
          await notifier()
        ).notify({
          reason: params.reason,
          agent: "Pi",
          project: safeProjectName(ctx.cwd),
          title: params.title,
          summary: params.summary,
          ...(params.urgency ? { urgency: params.urgency } : {}),
          ...(params.dedupeKey ? { dedupeKey: params.dedupeKey } : {}),
          durationSeconds,
          sessionId: ctx.sessionManager.getSessionId(),
        });
        return {
          content: [{ type: "text", text: conciseReport(report) }],
          details: {
            accepted: report.accepted,
            reason: report.reason,
            deliveries: report.deliveries.map(({ provider, ok }) => ({
              provider,
              ok,
            })),
          },
        };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "WatchCode notification failed, but continue the task normally.",
            },
          ],
          details: {
            accepted: false,
            reason: "notification_error",
            deliveries: [],
          },
        };
      }
    },
  });
  pi.registerTool(tool);

  pi.registerCommand("watchcode-test", {
    description:
      "Send a WatchCode test notification through configured providers",
    handler: async (_args, ctx) => {
      try {
        const report = await (
          await notifier()
        ).notify({
          reason: "needs_input",
          agent: "Pi",
          project: safeProjectName(ctx.cwd),
          title: "WatchCode 测试通知",
          summary: "如果你看到这条消息，Pi 通知集成配置成功。",
          urgency: "high",
          dedupeKey: `pi-test:${Date.now()}`,
          durationSeconds: Math.max(0, (Date.now() - sessionStartedAt) / 1000),
          sessionId: ctx.sessionManager.getSessionId(),
        });
        ctx.ui.notify(
          conciseReport(report),
          report.deliveries.some((delivery) => delivery.ok)
            ? "info"
            : "warning",
        );
      } catch {
        ctx.ui.notify(
          "WatchCode test failed; the Pi session is unaffected.",
          "warning",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionStartedAt = Date.now();
    lastCwd = ctx.cwd;
    lastSessionId = ctx.sessionManager.getSessionId();
    failureNotified = false;
  });

  pi.on("ui_prompt_start", async (event, ctx) => {
    if (
      !/permission|approval|confirm|input|select|editor/i.test(
        `${event.title ?? ""} ${event.kind}`,
      )
    )
      return;
    await safeNotify(
      ctx,
      "needs_input",
      "Pi 需要你介入",
      event.title || `Pi 正在等待 ${event.kind}`,
    );
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "error" || failureNotified) return;
    failureNotified = true;
    await safeNotify(
      ctx,
      "failed",
      "Pi 任务失败",
      "Agent 运行发生不可恢复错误，请返回终端查看。",
      "high",
    );
  });

  async function safeNotify(
    ctx: ExtensionContext,
    reason: NotificationReason,
    title: string,
    summary: string,
    urgency: "normal" | "high" = "high",
  ): Promise<void> {
    try {
      const sessionId = ctx.sessionManager.getSessionId() || lastSessionId;
      await (
        await notifier()
      ).notify({
        reason,
        agent: "Pi",
        project: safeProjectName(ctx.cwd || lastCwd),
        title,
        summary,
        urgency,
        durationSeconds: Math.max(0, (Date.now() - sessionStartedAt) / 1000),
        ...(sessionId ? { sessionId } : {}),
        dedupeKey: `${reason}:${ctx.sessionManager.getSessionId()}:${title}`,
      });
    } catch {
      // Notifications are advisory and must never break the agent run.
    }
  }
}

function conciseReport(
  report: Awaited<ReturnType<PiNotifierLike["notify"]>>,
): string {
  if (!report.accepted) return `WatchCode did not send: ${report.reason}.`;
  const sent = report.deliveries
    .filter((delivery) => delivery.ok)
    .map((delivery) => delivery.provider);
  const failed = report.deliveries
    .filter((delivery) => !delivery.ok)
    .map((delivery) => delivery.provider);
  return `WatchCode candidate accepted. Sent: ${sent.join(", ") || "none"}.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`;
}

export default registerPiExtension;
