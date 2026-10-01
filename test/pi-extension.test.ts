import assert from "node:assert/strict";
import test from "node:test";
import { registerPiExtension } from "../src/pi-extension.js";

interface RegisteredTool {
  execute: (...args: any[]) => Promise<any>;
}

test("Pi extension registers a constrained semantic notification tool", async () => {
  let tool: RegisteredTool | undefined;
  const handlers = new Map<string, Function>();
  const commands = new Map<string, unknown>();
  const pi = {
    registerTool(value: RegisteredTool) {
      tool = value;
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    on(name: string, handler: Function) {
      handlers.set(name, handler);
      return () => undefined;
    },
  };
  const seen: any[] = [];
  registerPiExtension(pi as any, async () => ({
    async notify(intent: any) {
      seen.push(intent);
      return {
        accepted: true,
        reason: "accepted",
        deliveries: [{ provider: "apple-reminders", ok: true }],
      };
    },
  }));
  assert.ok(tool);
  assert.ok(commands.has("watchcode-test"));
  assert.ok(handlers.has("session_start"));
  assert.ok(handlers.has("ui_prompt_start"));
  assert.ok(handlers.has("agent_before_settle"));

  const ctx = {
    cwd: "/tmp/watchcode",
    sessionManager: { getSessionId: () => "pi-session" },
  };
  const result = await tool!.execute(
    "call",
    { reason: "completed", title: "Done", summary: "Tests passed" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(seen[0].reason, "completed");
  assert.equal(seen[0].agent, "Pi");
  assert.equal(seen[0].project, "watchcode");
  assert.match(result.content[0].text, /Sent: apple-reminders/);
});

test("Pi native UI wait and unrecoverable error provide deterministic fallbacks", async () => {
  const handlers = new Map<string, Function>();
  const seen: any[] = [];
  registerPiExtension(
    {
      registerTool() {},
      registerCommand() {},
      on(name: string, handler: Function) {
        handlers.set(name, handler);
        return () => undefined;
      },
    } as any,
    async () => ({
      async notify(intent: any) {
        seen.push(intent);
        return { accepted: true, reason: "accepted", deliveries: [] };
      },
    }),
  );
  const ctx = { cwd: "/tmp/x", sessionManager: { getSessionId: () => "s" } };
  await handlers.get("session_start")?.({}, ctx);
  await handlers.get("ui_prompt_start")?.(
    { title: "Allow deploy?", kind: "confirm" },
    ctx,
  );
  await handlers.get("agent_before_settle")?.({ outcome: "error" }, ctx);
  assert.deepEqual(
    seen.map((i) => i.reason),
    ["needs_input", "failed"],
  );
});
