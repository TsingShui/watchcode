import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyChanges,
  planInstall,
  planUninstall,
  restoreBackup,
} from "../src/installer.js";

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "watchcode-home-"));
  await mkdir(join(home, ".pi/agent"), { recursive: true });
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(
    join(home, ".pi/agent/settings.json"),
    JSON.stringify({ theme: "dark", packages: ["npm:existing"] }, null, 2),
  );
  await writeFile(
    join(home, ".codex/config.toml"),
    'model = "gpt-test"\n\n[mcp_servers.existing]\ncommand = "existing"\n',
  );
  await writeFile(
    join(home, ".codex/hooks.json"),
    JSON.stringify(
      { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } },
      null,
      2,
    ),
  );
  return home;
}

test("installer previews before confirmation and cancellation leaves files untouched", async () => {
  const home = await fixture();
  const path = join(home, ".pi/agent/settings.json");
  const before = await readFile(path, "utf8");
  const events: string[] = [];
  const changes = await planInstall(["pi"], {
    home,
    packageRoot: "/opt/watchcode",
  });

  await assert.rejects(
    applyChanges(changes, {
      preview: (text) => events.push(`preview:${text}`),
      ask: async (question) => {
        events.push(`ask:${question}`);
        return false;
      },
    }),
    /cancelled/,
  );
  assert.match(events[0] ?? "", /^preview:/);
  assert.match(events[1] ?? "", /^ask:/);
  assert.equal(await readFile(path, "utf8"), before);
  const siblings = await readdir(join(home, ".pi/agent"));
  assert.equal(
    siblings.some((name) => name.includes("watchcode-backup")),
    false,
  );
});

test("installer preserves existing config, backs up, and is idempotent", async () => {
  const home = await fixture();
  const options = {
    home,
    packageRoot: "/opt/watchcode",
    yes: true,
    now: () => new Date("2026-01-01T00:00:00Z"),
    preview: () => undefined,
  };
  const first = await planInstall(["pi", "codex"], options);
  assert.match(
    first.map((change) => change.preview).join("\n"),
    /mcp_servers\.watchcode/,
  );
  assert.match(
    first.map((change) => change.preview).join("\n"),
    /SessionStart/,
  );
  const applied = await applyChanges(first, options);
  assert.equal(applied.filter((result) => result.changed).length, 3);
  assert.equal(
    applied.every((result) => Boolean(result.backup)),
    true,
  );
  const pi = JSON.parse(
    await readFile(join(home, ".pi/agent/settings.json"), "utf8"),
  );
  assert.equal(pi.theme, "dark");
  assert.deepEqual(pi.packages, ["npm:existing", "/opt/watchcode"]);
  const toml = await readFile(join(home, ".codex/config.toml"), "utf8");
  assert.match(toml, /mcp_servers\.existing/);
  assert.match(toml, /mcp_servers\.watchcode/);
  const hooks = await readFile(join(home, ".codex/hooks.json"), "utf8");
  assert.match(hooks, /PreToolUse/);
  assert.match(hooks, /PermissionRequest/);
  assert.match(hooks, /SessionStart/);
  assert.match(hooks, /watchcode-codex-hook/);
  const second = await planInstall(["pi", "codex"], options);
  assert.equal(
    second.every((change) => !change.changed),
    true,
  );
});

test("same-timestamp writes never overwrite an existing safety backup", async () => {
  const home = await fixture();
  const options = {
    home,
    packageRoot: "/opt/watchcode",
    yes: true,
    now: () => new Date("2026-01-01T00:00:00Z"),
    preview: () => undefined,
  };
  const install = await planInstall(["pi"], options);
  const first = (await applyChanges(install, options))[0]!;
  await applyChanges(await planUninstall(["pi"], options), options);
  assert.ok(first.backup);
  assert.equal(existsSync(first.backup!), true);
  const backups = (await readdir(join(home, ".pi/agent"))).filter((name) =>
    name.includes("watchcode-backup-2026-01-01T00-00-00-000Z"),
  );
  assert.equal(backups.length, 2);
  assert.notEqual(backups[0], backups[1]);
});

test("uninstall removes only WatchCode entries", async () => {
  const home = await fixture();
  const options = { home, packageRoot: "/opt/watchcode", yes: true };
  await applyChanges(await planInstall(["pi", "codex"], options), options);
  await applyChanges(await planUninstall(["pi", "codex"], options), options);
  const pi = JSON.parse(
    await readFile(join(home, ".pi/agent/settings.json"), "utf8"),
  );
  assert.deepEqual(pi.packages, ["npm:existing"]);
  const toml = await readFile(join(home, ".codex/config.toml"), "utf8");
  assert.match(toml, /mcp_servers\.existing/);
  assert.doesNotMatch(toml, /mcp_servers\.watchcode/);
  const hooks = await readFile(join(home, ".codex/hooks.json"), "utf8");
  assert.match(hooks, /PreToolUse/);
  assert.doesNotMatch(hooks, /watchcode-codex-hook/);
  assert.doesNotMatch(hooks, /SessionStart/);
});

test("restore previews the write, backs up current content, and remains undoable", async () => {
  const home = await fixture();
  const path = join(home, ".pi/agent/settings.json");
  const beforeInstall = await readFile(path, "utf8");
  const install = (
    await applyChanges(
      await planInstall(["pi"], { home, packageRoot: "/opt/watchcode" }),
      { yes: true, now: () => new Date("2026-01-01T00:00:00Z") },
    )
  )[0]!;
  const installed = await readFile(path, "utf8");
  const previews: string[] = [];
  const questions: string[] = [];
  const restored = await restoreBackup(install.backup!, {
    now: () => new Date("2026-01-02T00:00:00Z"),
    preview: (text) => previews.push(text),
    ask: async (question) => {
      questions.push(question);
      return true;
    },
  });

  assert.equal(await readFile(path, "utf8"), beforeInstall);
  assert.equal(restored.restoredFrom, install.backup);
  assert.match(restored.backup ?? "", /watchcode-backup-restore-/);
  assert.equal(await readFile(restored.backup!, "utf8"), installed);
  assert.match(previews[0] ?? "", /RESTORE/);
  assert.match(previews[0] ?? "", /Safety backup of current file/);
  assert.equal(questions.length, 1);

  const undoPreview: string[] = [];
  await restoreBackup(restored.backup!, {
    yes: true,
    now: () => new Date("2026-01-03T00:00:00Z"),
    preview: (text) => undoPreview.push(text),
  });
  assert.equal(await readFile(path, "utf8"), installed);
  assert.match(undoPreview[0] ?? "", /RESTORE/);
});

test("restore cancellation occurs after preview and before any write or safety backup", async () => {
  const home = await fixture();
  const path = join(home, ".pi/agent/settings.json");
  const before = await readFile(path, "utf8");
  const source = `${path}.watchcode-backup-source`;
  await writeFile(source, "replacement\n");
  const previews: string[] = [];

  await assert.rejects(
    restoreBackup(source, {
      now: () => new Date("2026-01-04T00:00:00Z"),
      preview: (text) => previews.push(text),
      ask: async () => false,
    }),
    /cancelled/,
  );
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal(
    existsSync(`${path}.watchcode-backup-restore-2026-01-04T00-00-00-000Z`),
    false,
  );
  assert.equal(previews.length, 1);
});

test("uninstall is a no-op when WatchCode is absent and does not create files", async () => {
  const home = await mkdtemp(join(tmpdir(), "watchcode-empty-home-"));
  const changes = await planUninstall(["pi", "codex"], {
    home,
    packageRoot: "/opt/watchcode",
  });
  assert.equal(
    changes.every((change) => !change.changed),
    true,
  );
  await applyChanges(changes, { yes: true });
  await assert.rejects(
    readFile(join(home, ".pi/agent/settings.json")),
    /ENOENT/,
  );
  await assert.rejects(readFile(join(home, ".codex/hooks.json")), /ENOENT/);
});

test("installer refuses malformed managed blocks", async () => {
  const home = await fixture();
  await writeFile(
    join(home, ".codex/config.toml"),
    "# >>> watchcode >>>\nbroken\n",
  );
  await assert.rejects(
    planInstall(["codex"], { home, packageRoot: "/opt/watchcode" }),
    /Malformed/,
  );
});
