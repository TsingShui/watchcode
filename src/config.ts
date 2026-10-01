import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { NotificationReason, ProviderName } from "./types.js";

export interface WatchcodeConfig {
  enabledEvents: NotificationReason[];
  providers: ProviderName[];
  cooldownSeconds: number;
  dedupeWindowSeconds: number;
  maxTitleLength: number;
  maxSummaryLength: number;
  apple: {
    listName: string;
    dueInSeconds: number;
    cleanupAfterDays: number;
  };
  stateFile: string;
}

export const defaultConfig: WatchcodeConfig = {
  enabledEvents: ["needs_input", "completed", "failed"],
  providers: ["apple-reminders"],
  cooldownSeconds: 60,
  dedupeWindowSeconds: 300,
  maxTitleLength: 80,
  maxSummaryLength: 240,
  apple: {
    listName: "WatchCode",
    dueInSeconds: 15,
    cleanupAfterDays: 7,
  },
  stateFile: join(homedir(), ".watchcode", "state.json"),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(base: WatchcodeConfig, raw: unknown): WatchcodeConfig {
  if (!isObject(raw)) return base;
  const apple = isObject(raw.apple) ? raw.apple : {};
  return {
    enabledEvents: (raw.enabledEvents ??
      base.enabledEvents) as NotificationReason[],
    providers: (raw.providers ?? base.providers) as ProviderName[],
    cooldownSeconds: (raw.cooldownSeconds ?? base.cooldownSeconds) as number,
    dedupeWindowSeconds: (raw.dedupeWindowSeconds ??
      base.dedupeWindowSeconds) as number,
    maxTitleLength: (raw.maxTitleLength ?? base.maxTitleLength) as number,
    maxSummaryLength: (raw.maxSummaryLength ?? base.maxSummaryLength) as number,
    apple: { ...base.apple, ...apple },
    stateFile: (raw.stateFile ?? base.stateFile) as string,
  };
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.WATCHCODE_CONFIG ??
    join(env.HOME ?? homedir(), ".watchcode", "config.json")
  );
}

export async function loadConfig(
  path = configPath(),
): Promise<WatchcodeConfig> {
  const base = { ...defaultConfig, stateFile: join(path, "..", "state.json") };
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return validateConfig(mergeConfig(base, raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return base;
    throw error;
  }
}

export function validateConfig(config: WatchcodeConfig): WatchcodeConfig {
  const reasons = new Set(["needs_input", "completed", "failed"]);
  const providers = new Set(["apple-reminders"]);
  if (
    !Array.isArray(config.enabledEvents) ||
    !config.enabledEvents.every((event) => reasons.has(event))
  )
    throw new Error("Invalid enabledEvents value");
  if (
    !Array.isArray(config.providers) ||
    !config.providers.every((provider) => providers.has(provider))
  )
    throw new Error("Invalid provider value");
  for (const [name, value] of Object.entries({
    cooldownSeconds: config.cooldownSeconds,
    dedupeWindowSeconds: config.dedupeWindowSeconds,
    maxTitleLength: config.maxTitleLength,
    maxSummaryLength: config.maxSummaryLength,
  })) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Invalid ${name}`);
  }
  if (
    !config.apple ||
    typeof config.apple.listName !== "string" ||
    !config.apple.listName.trim()
  )
    throw new Error("apple.listName is required");
  if (
    !Number.isFinite(config.apple.dueInSeconds) ||
    config.apple.dueInSeconds < 1
  )
    throw new Error("apple.dueInSeconds must be positive");
  if (
    !Number.isFinite(config.apple.cleanupAfterDays) ||
    config.apple.cleanupAfterDays < 0
  )
    throw new Error("apple.cleanupAfterDays must be non-negative");
  return config;
}
