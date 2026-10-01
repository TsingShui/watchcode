#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configPath, defaultConfig, loadConfig } from "./config.js";
import { isMainModule } from "./is-main.js";
import {
  applyChanges,
  planInstall,
  planUninstall,
  restoreBackup,
  type InstallTarget,
} from "./installer.js";
import { createNotifier } from "./runtime.js";
import { AppleRemindersProvider } from "./providers/apple-reminders.js";
import { safeProjectName } from "./project.js";
import {
  notificationReasons,
  type NotificationIntent,
  type NotificationReason,
} from "./types.js";

export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "notify":
        return await notifyCommand(args, env);
      case "test":
        return await testCommand(args, env);
      case "diagnose":
        return await diagnoseCommand(env);
      case "init":
        return await initCommand(args, env);
      case "install":
      case "uninstall":
        return await installCommand(command, args, env);
      case "restore":
        return await restoreCommand(args);
      case "help":
      case "--help":
      case "-h":
      case undefined:
        console.log(helpText());
        return 0;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(
      `watchcode: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return 1;
  }
}

async function notifyCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const flags = parseFlags(args);
  const reason = flags.reason;
  if (!reason || !notificationReasons.includes(reason as NotificationReason))
    throw new Error("--reason must be needs_input, completed, or failed");
  if (!flags.summary) throw new Error("--summary is required");
  const intent: NotificationIntent = {
    reason: reason as NotificationReason,
    agent: flags.agent ?? "CLI",
    project: flags.project ?? safeProjectName(process.cwd()),
    title: flags.title ?? reason,
    summary: flags.summary,
    ...(flags.urgency === "high" || flags.urgency === "normal"
      ? { urgency: flags.urgency }
      : {}),
    ...(flags["dedupe-key"] ? { dedupeKey: flags["dedupe-key"] } : {}),
    durationSeconds: flags.duration
      ? parsePositive(flags.duration, "duration")
      : 0,
  };
  const report = await (await createNotifier(env)).notify(intent);
  console.log(JSON.stringify(report, null, 2));
  return report.accepted && report.deliveries.some((delivery) => delivery.ok)
    ? 0
    : 2;
}

async function testCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const flags = parseFlags(args);
  const reason = (flags.reason ?? "needs_input") as NotificationReason;
  return notifyCommand(
    [
      "--reason",
      reason,
      "--agent",
      "WatchCode",
      "--project",
      "watchcode",
      "--title",
      "WatchCode 测试通知",
      "--summary",
      "如果你看到这条消息，通知通道配置成功。",
      "--dedupe-key",
      `test-${Date.now()}`,
    ],
    env,
  );
}

async function diagnoseCommand(env: NodeJS.ProcessEnv): Promise<number> {
  const config = await loadConfig(env.WATCHCODE_CONFIG);
  const providers = [new AppleRemindersProvider(config.apple)].filter(
    (provider) => config.providers.includes(provider.name),
  );
  const results = await Promise.all(
    providers.map((provider) => provider.diagnose()),
  );
  for (const result of results)
    console.log(
      `${result.ok ? "OK" : "FAIL"} ${result.provider}: ${result.detail ?? ""}`,
    );
  return results.every((result) => result.ok) ? 0 : 2;
}

async function initCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const flags = parseFlags(args);
  const path = env.WATCHCODE_CONFIG ?? configPath(env);
  const content = `${JSON.stringify({ ...defaultConfig, stateFile: undefined }, null, 2)}\n`;
  if (existsSync(path))
    throw new Error(`Configuration already exists: ${path}`);
  console.log(
    `CREATE ${path}\n  Initialize Apple Reminders defaults; no existing file will be overwritten.`,
  );
  if (flags.yes !== "true" && !(await terminalConfirm(`Create ${path}?`)))
    throw new Error("Initialization cancelled");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { flag: "wx", mode: 0o600 });
  console.log(`Created ${path}`);
  return 0;
}

async function installCommand(
  command: "install" | "uninstall",
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const flags = parseFlags(args);
  const targets = parseTargets(flags.target ?? "all");
  const options = {
    ...(env.HOME ? { home: env.HOME } : {}),
    yes: flags.yes === "true",
  };
  const changes =
    command === "install"
      ? await planInstall(targets, options)
      : await planUninstall(targets, options);
  const results = await applyChanges(changes, {
    ...options,
    preview: (text) => console.log(text),
  });
  for (const result of results) {
    if (result.backup) console.log(`Backup: ${result.backup}`);
  }
  if (command === "install" && targets.includes("codex"))
    console.log(
      "Codex: restart, open /hooks, review and trust the WatchCode hook.",
    );
  return 0;
}

async function restoreCommand(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const path = flags.file ?? args.find((arg) => !arg.startsWith("-"));
  if (!path) throw new Error("restore requires --file <backup>");
  const result = await restoreBackup(path, { yes: flags.yes === "true" });
  console.log(`Restored ${result.path}`);
  return 0;
}

function parseTargets(value: string): InstallTarget[] {
  if (value === "all") return ["pi", "codex"];
  if (value === "pi" || value === "codex") return [value];
  throw new Error("--target must be pi, codex, or all");
}

function parseFlags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]!;
    if (!item.startsWith("--")) continue;
    const [rawKey, inline] = item.slice(2).split("=", 2);
    if (!rawKey) continue;
    if (inline !== undefined) result[rawKey] = inline;
    else if (args[index + 1] && !args[index + 1]!.startsWith("--"))
      result[rawKey] = args[++index]!;
    else result[rawKey] = "true";
  }
  return result;
}

function parsePositive(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`--${name} must be a non-negative number`);
  return parsed;
}

async function terminalConfirm(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      "Interactive confirmation requires a TTY; pass --yes after reviewing the preview",
    );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return /^y(?:es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function helpText(): string {
  return `watchcode — meaningful coding-agent notifications\n\nCommands:\n  watchcode init --yes\n  watchcode notify --reason <needs_input|completed|failed> --summary <text> [options]\n  watchcode test [--reason needs_input]\n  watchcode diagnose\n  watchcode install --target <pi|codex|all> [--yes]\n  watchcode uninstall --target <pi|codex|all> [--yes]\n  watchcode restore --file <backup> [--yes]\n\nNo provider credentials are required.`;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
