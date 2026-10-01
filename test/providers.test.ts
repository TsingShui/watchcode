import assert from "node:assert/strict";
import test from "node:test";
import {
  AppleRemindersProvider,
  appleScriptsForTest,
} from "../src/providers/apple-reminders.js";
import type { SafeNotification } from "../src/types.js";

const notification: SafeNotification = {
  reason: "needs_input",
  agent: "Pi",
  project: "watchcode",
  title: "Need input",
  summary: "Choose A or B",
  urgency: "high",
  dedupeKey: "abc",
  createdAt: "2026-01-01T00:00:00Z",
  durationSeconds: 0,
};

test("Apple provider passes data as argv instead of interpolating AppleScript", async () => {
  let called: { file: string; args: readonly string[] } | undefined;
  const provider = new AppleRemindersProvider(
    { listName: 'WatchCode " unsafe', dueInSeconds: 15, cleanupAfterDays: 7 },
    async (file, args) => {
      called = { file, args };
      return { stdout: "id", stderr: "" };
    },
    "darwin",
  );
  const result = await provider.send({
    ...notification,
    summary: 'quote " and newline\nkept safely',
  });
  assert.equal(result.ok, true);
  assert.equal(called?.file, "/usr/bin/osascript");
  assert.equal(called?.args[0], "-e");
  assert.equal(called?.args[2], "--");
  assert.equal(called?.args[3], 'WatchCode " unsafe');
  assert.match(called?.args[5] ?? "", /quote/);
  assert.equal(appleScriptsForTest.create.includes("item 3 of argv"), true);
  assert.match(appleScriptsForTest.create, /whose name is listName/);
  assert.match(appleScriptsForTest.create, /whose completed is true/);
  assert.match(
    appleScriptsForTest.create,
    /modification date of oldReminder < cutoff/,
  );
});

test("Apple provider reports unsupported platforms", async () => {
  const provider = new AppleRemindersProvider(
    { listName: "WatchCode", dueInSeconds: 15, cleanupAfterDays: 7 },
    async () => ({ stdout: "", stderr: "" }),
    "linux",
  );
  assert.equal((await provider.send(notification)).ok, false);
});

test("Apple provider translates automation permission errors", async () => {
  const provider = new AppleRemindersProvider(
    { listName: "WatchCode", dueInSeconds: 15, cleanupAfterDays: 7 },
    async () => {
      throw new Error("Not authorized to send Apple events. (-1743)");
    },
    "darwin",
  );
  const result = await provider.send(notification);
  assert.match(result.detail ?? "", /permission denied/i);
});
