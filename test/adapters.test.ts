import assert from "node:assert/strict";
import test from "node:test";
import { codexHookOutput, mapCodexHook } from "../src/codex-hook.js";

// These tests exercise adapters at their public event-to-intent seam.
test("Codex SessionStart injects bounded semantic notification guidance", () => {
  const output = codexHookOutput({ hook_event_name: "SessionStart" });
  const parsed = JSON.parse(output ?? "{}") as {
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.match(
    parsed.hookSpecificOutput?.additionalContext ?? "",
    /mcp__watchcode__notify_user/,
  );
  assert.match(
    parsed.hookSpecificOutput?.additionalContext ?? "",
    /ordinary turn completion/,
  );
});

test("Codex permission hook maps to needs_input", () => {
  const intent = mapCodexHook({
    hook_event_name: "PermissionRequest",
    session_id: "thread-1",
    turn_id: "turn-1",
    cwd: "/tmp/project-a",
    tool_name: "Bash",
    tool_input: { description: "Run deployment" },
  });
  assert.equal(intent?.reason, "needs_input");
  assert.equal(intent?.project, "project-a");
  assert.match(intent?.summary ?? "", /Run deployment/);
});

test("Codex Stop is deliberately not mapped to completed", () => {
  assert.equal(
    mapCodexHook({ hook_event_name: "Stop", cwd: "/tmp/x" }),
    undefined,
  );
});

test("Codex ordinary agent-turn-complete payload is ignored", () => {
  assert.equal(
    mapCodexHook({ hook_event_name: "agent-turn-complete", cwd: "/tmp/x" }),
    undefined,
  );
});
