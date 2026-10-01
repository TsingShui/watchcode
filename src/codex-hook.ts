#!/usr/bin/env node
import { isMainModule } from "./is-main.js";
import { createNotifier } from "./runtime.js";
import { safeProjectName } from "./project.js";
import { notifyToolDescription } from "./tool-schema.js";
import type { NotificationIntent } from "./types.js";

interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  turn_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export function mapCodexHook(input: HookInput): NotificationIntent | undefined {
  if (input.hook_event_name !== "PermissionRequest") return undefined;
  const description =
    typeof input.tool_input?.description === "string"
      ? input.tool_input.description
      : undefined;
  return {
    reason: "needs_input",
    agent: "Codex",
    project: safeProjectName(input.cwd ?? process.cwd()),
    title: "Codex 需要批准",
    summary: description
      ? `等待批准：${description}`
      : `等待批准工具调用：${input.tool_name ?? "unknown"}`,
    urgency: "high",
    durationSeconds: 0,
    dedupeKey: `codex-permission:${input.session_id ?? "session"}:${input.turn_id ?? "turn"}:${input.tool_name ?? "tool"}`,
    ...(input.session_id ? { sessionId: input.session_id } : {}),
  };
}

export function codexHookOutput(input: HookInput): string | undefined {
  if (input.hook_event_name !== "SessionStart") return undefined;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `WatchCode notification policy: ${notifyToolDescription} Use the MCP tool mcp__watchcode__notify_user when a qualifying semantic boundary occurs.`,
    },
  });
}

export async function runCodexHook(
  raw: string,
  output: (text: string) => void = (text) => process.stdout.write(text),
): Promise<void> {
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    return;
  }
  const hookOutput = codexHookOutput(input);
  if (hookOutput) {
    output(hookOutput);
    return;
  }
  const intent = mapCodexHook(input);
  if (!intent) return;
  try {
    await (await createNotifier()).notify(intent);
  } catch {
    // Hook failures must not block approvals or agent execution.
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

if (isMainModule(import.meta.url)) {
  runCodexHook(await readStdin()).catch(() => undefined);
}
