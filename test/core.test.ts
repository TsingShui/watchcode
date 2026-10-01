import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defaultConfig,
  loadConfig,
  validateConfig,
  type WatchcodeConfig,
} from "../src/config.js";
import { WatchcodeNotifier } from "../src/notifier.js";
import { NotificationPolicy } from "../src/policy.js";
import { redact } from "../src/redact.js";
import type { NotificationProvider, SafeNotification } from "../src/types.js";

async function config(
  overrides: Partial<WatchcodeConfig> = {},
): Promise<WatchcodeConfig> {
  const root = await mkdtemp(join(tmpdir(), "watchcode-test-"));
  return {
    ...defaultConfig,
    stateFile: join(root, "state.json"),
    cooldownSeconds: 0,
    ...overrides,
  };
}

test("configuration rejects unknown providers and invalid numeric windows", () => {
  assert.throws(
    () => validateConfig({ ...defaultConfig, providers: ["unknown" as never] }),
    /provider/,
  );
  assert.throws(
    () => validateConfig({ ...defaultConfig, providers: "invalid" as never }),
    /provider/,
  );
  assert.throws(
    () => validateConfig({ ...defaultConfig, cooldownSeconds: -1 }),
    /cooldownSeconds/,
  );
});

test("configuration ignores obsolete unknown keys instead of retaining dead channel state", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchcode-config-"));
  const path = join(root, "config.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      path,
      JSON.stringify({
        enabledEvents: ["needs_input"],
        providers: ["apple-reminders"],
        obsoleteChannel: { token: "must-not-survive" },
      }),
    ),
  );
  const loaded = await loadConfig(path);
  assert.equal("obsoleteChannel" in loaded, false);
  assert.deepEqual(loaded.providers, ["apple-reminders"]);
});

test("policy accepts and minimizes a supported intent", async () => {
  const policy = new NotificationPolicy(await config(), {
    now: () => 1_700_000_000_000,
  });
  const result = await policy.evaluate({
    reason: "needs_input",
    agent: "Pi",
    project: "watchcode",
    title: "Need input",
    summary: "Choose A or B",
    durationSeconds: 91,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.notification?.urgency, "high");
  assert.equal(result.notification?.durationSeconds, 91);
  assert.match(result.notification?.createdAt ?? "", /^2023-/);
});

test("policy supplies zero duration when an adapter cannot measure it", async () => {
  const policy = new NotificationPolicy(await config());
  const result = await policy.evaluate({
    reason: "completed",
    agent: "Codex",
    project: "x",
    title: "done",
    summary: "done",
  });
  assert.equal(result.notification?.durationSeconds, 0);
});

test("policy rejects disabled events", async () => {
  const policy = new NotificationPolicy(
    await config({ enabledEvents: ["failed"] }),
  );
  const result = await policy.evaluate({
    reason: "completed",
    agent: "Codex",
    project: "x",
    title: "done",
    summary: "done",
  });
  assert.deepEqual(result, { accepted: false, reason: "disabled" });
});

test("policy deduplicates repeated intents and persists opaque keys", async () => {
  const cfg = await config({ dedupeWindowSeconds: 300 });
  let now = 10_000;
  const policy = new NotificationPolicy(cfg, { now: () => now });
  const intent = {
    reason: "failed" as const,
    agent: "Pi",
    project: "x",
    title: "failed",
    summary: "token sk-secretsecretsecret",
  };
  assert.equal((await policy.evaluate(intent)).accepted, true);
  now += 1_000;
  assert.equal((await policy.evaluate(intent)).reason, "duplicate");
  const state = await readFile(cfg.stateFile, "utf8");
  assert.doesNotMatch(state, /secretsecret/);
});

test("policy applies cooldown across distinct summaries", async () => {
  const cfg = await config({ cooldownSeconds: 60, dedupeWindowSeconds: 0 });
  let now = 20_000;
  const policy = new NotificationPolicy(cfg, { now: () => now });
  const base = {
    reason: "needs_input" as const,
    agent: "Codex",
    project: "x",
    title: "input",
  };
  assert.equal(
    (await policy.evaluate({ ...base, summary: "first" })).accepted,
    true,
  );
  now += 1_000;
  assert.equal(
    (await policy.evaluate({ ...base, summary: "second" })).reason,
    "cooldown",
  );
});

test("redaction removes common credentials and absolute paths", () => {
  const value = redact(
    "token=example-secret-value /private/example-user/file api-exampleexample",
  );
  assert.equal(value.includes("example-secret-value"), false);
  assert.equal(value.includes("/private/example-user"), false);
  assert.equal(value.includes("api-exampleexample"), false);
});

test("notifier routes to the Apple provider", async () => {
  const cfg = await config();
  const seen: SafeNotification[] = [];
  const apple: NotificationProvider = {
    name: "apple-reminders",
    async send(n) {
      seen.push(n);
      return { provider: this.name, ok: true };
    },
  };
  const notifier = new WatchcodeNotifier(cfg, new Map([[apple.name, apple]]));
  const report = await notifier.notify({
    reason: "completed",
    agent: "Pi",
    project: "x",
    title: "done",
    summary: "tests passed",
  });
  assert.equal(report.accepted, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(
    report.deliveries.map((d) => d.ok),
    [true],
  );
});

test("Apple provider failure releases dedupe reservation for retry", async () => {
  const cfg = await config({ dedupeWindowSeconds: 300 });
  const bad: NotificationProvider = {
    name: "apple-reminders",
    async send() {
      return { provider: this.name, ok: false, detail: "offline" };
    },
  };
  const notifier = new WatchcodeNotifier(cfg, new Map([[bad.name, bad]]));
  const intent = {
    reason: "failed" as const,
    agent: "Pi",
    project: "x",
    title: "failed",
    summary: "offline",
  };
  assert.equal((await notifier.notify(intent)).accepted, true);
  assert.equal((await notifier.notify(intent)).accepted, true);
});
