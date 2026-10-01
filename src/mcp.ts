#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { createNotifier } from "./runtime.js";
import { isMainModule } from "./is-main.js";
import { safeProjectName } from "./project.js";
import { notifyToolDescription } from "./tool-schema.js";

export function createWatchcodeMcpServer() {
  const serverStartedAt = Date.now();
  const server = new McpServer({ name: "watchcode", version: "0.1.0" });
  server.registerTool(
    "notify_user",
    {
      title: "Notify user with WatchCode",
      description: notifyToolDescription,
      inputSchema: {
        reason: z.enum(["needs_input", "completed", "failed"]),
        title: z.string().min(1).max(80),
        summary: z.string().min(1).max(500),
        urgency: z.enum(["normal", "high"]).optional(),
        dedupeKey: z.string().max(120).optional(),
        durationSeconds: z.number().nonnegative().optional(),
        agent: z.string().max(40).default("Codex"),
        project: z.string().max(80).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const notifier = await createNotifier();
        const report = await notifier.notify({
          reason: input.reason,
          agent: input.agent,
          project: input.project || safeProjectName(process.cwd()),
          title: input.title,
          summary: input.summary,
          ...(input.urgency ? { urgency: input.urgency } : {}),
          ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
          durationSeconds:
            input.durationSeconds ??
            Math.max(0, (Date.now() - serverStartedAt) / 1000),
          ...(process.env.CODEX_THREAD_ID
            ? { sessionId: process.env.CODEX_THREAD_ID }
            : {}),
        });
        const sent = report.deliveries
          .filter((item) => item.ok)
          .map((item) => item.provider);
        const failed = report.deliveries
          .filter((item) => !item.ok)
          .map((item) => item.provider);
        return {
          content: [
            {
              type: "text" as const,
              text: report.accepted
                ? `WatchCode accepted. Sent: ${sent.join(", ") || "none"}. Failed: ${failed.join(", ") || "none"}.`
                : `WatchCode suppressed: ${report.reason}.`,
            },
          ],
          structuredContent: {
            accepted: report.accepted,
            reason: report.reason,
            sent,
            failed,
          },
        };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "WatchCode notification failed, but the task should continue normally.",
            },
          ],
          structuredContent: {
            accepted: false,
            reason: "notification_error",
            sent: [],
            failed: [],
          },
        };
      }
    },
  );
  return server;
}

async function main(): Promise<void> {
  const server = createWatchcodeMcpServer();
  await server.connect(new StdioServerTransport());
}

if (isMainModule(import.meta.url)) {
  main().catch(() => (process.exitCode = 1));
}
