import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";

test("init --yes previews then creates a private Apple-only config", async () => {
  const home = await mkdtemp(join(tmpdir(), "watchcode-cli-home-"));
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    assert.equal(await runCli(["init", "--yes"], { HOME: home }), 0);
  } finally {
    console.log = original;
  }
  assert.match(lines[0] ?? "", /^CREATE /);
  const path = join(home, ".watchcode/config.json");
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    providers: string[];
    apple: { listName: string };
  };
  assert.deepEqual(parsed.providers, ["apple-reminders"]);
  assert.equal(parsed.apple.listName, "WatchCode");
});

test("init refuses to overwrite an existing config", async () => {
  const home = await mkdtemp(join(tmpdir(), "watchcode-cli-home-"));
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    assert.equal(await runCli(["init", "--yes"], { HOME: home }), 0);
    assert.equal(await runCli(["init", "--yes"], { HOME: home }), 1);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});
