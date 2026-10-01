import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export type InstallTarget = "pi" | "codex";

export interface PlannedChange {
  target: InstallTarget;
  path: string;
  description: string;
  preview: string;
  before?: string;
  after: string;
  changed: boolean;
}

export interface ApplyResult {
  path: string;
  changed: boolean;
  backup?: string;
  restoredFrom?: string;
}

export interface InstallerOptions {
  home?: string;
  packageRoot?: string;
  yes?: boolean;
  now?: () => Date;
  ask?: (question: string) => Promise<boolean>;
  preview?: (text: string) => void;
}

const WATCHCODE_START = "# >>> watchcode >>>";
const WATCHCODE_END = "# <<< watchcode <<<";

export function packageRootFromModule(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

export async function planInstall(
  targets: InstallTarget[],
  options: InstallerOptions = {},
): Promise<PlannedChange[]> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const root = resolve(options.packageRoot ?? packageRootFromModule());
  const changes: PlannedChange[] = [];
  if (targets.includes("pi")) changes.push(await planPi(home, root, false));
  if (targets.includes("codex")) {
    changes.push(await planCodexConfig(home, root, false));
    changes.push(await planCodexHooks(home, root, false));
  }
  return changes;
}

export async function planUninstall(
  targets: InstallTarget[],
  options: InstallerOptions = {},
): Promise<PlannedChange[]> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const root = resolve(options.packageRoot ?? packageRootFromModule());
  const changes: PlannedChange[] = [];
  if (targets.includes("pi")) changes.push(await planPi(home, root, true));
  if (targets.includes("codex")) {
    changes.push(await planCodexConfig(home, root, true));
    changes.push(await planCodexHooks(home, root, true));
  }
  return changes;
}

export async function applyChanges(
  changes: PlannedChange[],
  options: InstallerOptions = {},
): Promise<ApplyResult[]> {
  (options.preview ?? console.log)(renderPlan(changes));
  const changed = changes.filter((change) => change.changed);
  if (!changed.length)
    return changes.map((change) => ({ path: change.path, changed: false }));
  if (!options.yes) {
    const ask = options.ask ?? terminalConfirm;
    const accepted = await ask(
      `Apply the ${changed.length} previewed WatchCode configuration change(s)?`,
    );
    if (!accepted) throw new Error("Installation cancelled");
  }
  const stamp = formatTimestamp((options.now ?? (() => new Date()))());
  const results: ApplyResult[] = [];
  for (const change of changes) {
    if (!change.changed) {
      results.push({ path: change.path, changed: false });
      continue;
    }
    await mkdir(dirname(change.path), { recursive: true, mode: 0o700 });
    let backup: string | undefined;
    if (change.before !== undefined) {
      backup = uniqueBackupPath(`${change.path}.watchcode-backup-${stamp}`);
      await copyFile(change.path, backup);
    }
    await writeFile(change.path, change.after, { mode: 0o600 });
    results.push({
      path: change.path,
      changed: true,
      ...(backup ? { backup } : {}),
    });
  }
  return results;
}

export async function restoreBackup(
  backupPath: string,
  options: InstallerOptions = {},
): Promise<ApplyResult> {
  const marker = ".watchcode-backup-";
  const index = backupPath.lastIndexOf(marker);
  if (index < 0) throw new Error("Not a WatchCode backup path");
  const target = backupPath.slice(0, index);
  if (!existsSync(backupPath)) throw new Error("Backup does not exist");

  const stamp = formatTimestamp((options.now ?? (() => new Date()))());
  const currentExists = existsSync(target);
  const safetyBackup = currentExists
    ? uniqueBackupPath(`${target}.watchcode-backup-restore-${stamp}`)
    : undefined;
  const preview = [
    `RESTORE ${target}`,
    `  Source: ${backupPath}`,
    currentExists
      ? `  Safety backup of current file: ${safetyBackup}`
      : "  Current file is absent; restore will create it.",
  ].join("\n");
  (options.preview ?? console.log)(preview);

  if (!options.yes) {
    const ask = options.ask ?? terminalConfirm;
    if (!(await ask(`Apply the previewed restore to ${target}?`)))
      throw new Error("Restore cancelled");
  }

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if (safetyBackup) await copyFile(target, safetyBackup);
  await copyFile(backupPath, target);
  return {
    path: target,
    changed: true,
    ...(safetyBackup ? { backup: safetyBackup } : {}),
    restoredFrom: backupPath,
  };
}

export function renderPlan(changes: PlannedChange[]): string {
  return changes
    .map(
      (change) =>
        `${change.changed ? "CHANGE" : "UNCHANGED"} ${change.path}\n  ${change.description}\n  ${change.preview}`,
    )
    .join("\n");
}

async function planPi(
  home: string,
  root: string,
  remove: boolean,
): Promise<PlannedChange> {
  const path = resolve(home, ".pi/agent/settings.json");
  const before = await optionalRead(path);
  const data = before ? (JSON.parse(before) as Record<string, unknown>) : {};
  const packages = Array.isArray(data.packages) ? [...data.packages] : [];
  const hasWatchcode = packages.includes(root);
  if (remove && !hasWatchcode) {
    return {
      target: "pi",
      path,
      description: `WatchCode package entry (${root}) is already absent; preserve settings.`,
      preview: `= packages[] does not contain ${root}`,
      ...(before === undefined ? {} : { before }),
      after: before ?? "",
      changed: false,
    };
  }
  const filtered = packages.filter((value) => value !== root);
  if (!remove) filtered.push(root);
  data.packages = filtered;
  const after = `${JSON.stringify(data, null, 2)}\n`;
  return {
    target: "pi",
    path,
    description: remove
      ? `Remove only the WatchCode package entry (${root}); preserve all other settings.`
      : `Add the WatchCode Pi package (${root}); preserve all other settings.`,
    preview: `${remove ? "-" : "+"} packages[] = ${root}`,
    ...(before === undefined ? {} : { before }),
    after,
    changed: normalize(before) !== normalize(after),
  };
}

async function planCodexConfig(
  home: string,
  root: string,
  remove: boolean,
): Promise<PlannedChange> {
  const path = resolve(home, ".codex/config.toml");
  const before = await optionalRead(path);
  const clean = stripManagedBlock(before ?? "");
  const command = JSON.stringify(process.execPath);
  const args = JSON.stringify([resolve(root, "dist/src/mcp-bundle.js")]);
  const block = `${WATCHCODE_START}\n[mcp_servers.watchcode]\ncommand = ${command}\nargs = ${args}\n${WATCHCODE_END}`;
  const after = remove
    ? ensureTrailingNewline(clean)
    : `${clean.trimEnd()}${clean.trim() ? "\n\n" : ""}${block}\n`;
  return {
    target: "codex",
    path,
    description: remove
      ? "Remove only the managed WatchCode MCP block."
      : "Add a managed WatchCode stdio MCP server block; preserve existing TOML verbatim.",
    preview: `${remove ? "-" : "+"} [mcp_servers.watchcode] -> ${resolve(root, "dist/src/mcp-bundle.js")}`,
    ...(before === undefined ? {} : { before }),
    after,
    changed: normalize(before) !== normalize(after),
  };
}

async function planCodexHooks(
  home: string,
  root: string,
  remove: boolean,
): Promise<PlannedChange> {
  const path = resolve(home, ".codex/hooks.json");
  const before = await optionalRead(path);
  const data = before
    ? (JSON.parse(before) as {
        description?: string;
        hooks?: Record<string, unknown[]>;
      })
    : {};
  const hooks = data.hooks ?? {};
  const command = `${shellQuote(process.execPath)} ${shellQuote(resolve(root, "dist/src/codex-hook.js"))} --watchcode-codex-hook`;
  const permissionGroups = Array.isArray(hooks.PermissionRequest)
    ? hooks.PermissionRequest
    : [];
  const sessionGroups = Array.isArray(hooks.SessionStart)
    ? hooks.SessionStart
    : [];
  const withoutPermissionHook = permissionGroups.filter(
    (group) => !JSON.stringify(group).includes("watchcode-codex-hook"),
  );
  const withoutSessionHook = sessionGroups.filter(
    (group) => !JSON.stringify(group).includes("watchcode-codex-hook"),
  );
  const hasPermissionHook =
    withoutPermissionHook.length !== permissionGroups.length;
  const hasSessionHook = withoutSessionHook.length !== sessionGroups.length;
  if (remove && !hasPermissionHook && !hasSessionHook) {
    return {
      target: "codex",
      path,
      description:
        "WatchCode hooks are already absent; preserve hooks configuration.",
      preview:
        "= hooks.SessionStart and hooks.PermissionRequest contain no WatchCode handlers",
      ...(before === undefined ? {} : { before }),
      after: before ?? "",
      changed: false,
    };
  }
  if (!remove) {
    withoutPermissionHook.push({
      hooks: [
        {
          type: "command",
          command,
          async: true,
          timeout: 15,
          statusMessage: "Notifying through WatchCode",
        },
      ],
    });
    withoutSessionHook.push({
      matcher: "startup|resume|clear|compact",
      hooks: [
        {
          type: "command",
          command,
          timeout: 15,
          statusMessage: "Loading WatchCode notification policy",
          additionalContextLimit: 600,
        },
      ],
    });
  }
  if (withoutPermissionHook.length)
    hooks.PermissionRequest = withoutPermissionHook;
  else delete hooks.PermissionRequest;
  if (withoutSessionHook.length) hooks.SessionStart = withoutSessionHook;
  else delete hooks.SessionStart;
  data.hooks = hooks;
  if (!data.description) data.description = "User lifecycle hooks";
  const after = `${JSON.stringify(data, null, 2)}\n`;
  return {
    target: "codex",
    path,
    description: remove
      ? "Remove only WatchCode's SessionStart and PermissionRequest hooks."
      : "Add a bounded SessionStart policy hook and asynchronous PermissionRequest hook; Codex will require review/trust via /hooks.",
    preview: `${remove ? "-" : "+"} hooks.SessionStart + hooks.PermissionRequest -> ${resolve(root, "dist/src/codex-hook.js")}`,
    ...(before === undefined ? {} : { before }),
    after,
    changed: normalize(before) !== normalize(after),
  };
}

function stripManagedBlock(text: string): string {
  const start = text.indexOf(WATCHCODE_START);
  if (start < 0) return text;
  const end = text.indexOf(WATCHCODE_END, start);
  if (end < 0)
    throw new Error(
      "Malformed WatchCode block in Codex config; refusing to overwrite",
    );
  return `${text.slice(0, start).trimEnd()}\n${text.slice(end + WATCHCODE_END.length).trimStart()}`.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function optionalRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function normalize(value: string | undefined): string {
  return (value ?? "").trimEnd();
}

function ensureTrailingNewline(value: string): string {
  return value.trim() ? `${value.trimEnd()}\n` : "";
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function uniqueBackupPath(base: string): string {
  let candidate = base;
  let suffix = 1;
  while (existsSync(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

async function terminalConfirm(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      "Interactive confirmation requires a TTY; pass --yes after reviewing the plan",
    );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
