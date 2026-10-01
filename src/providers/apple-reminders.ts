import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { formatNotificationBody, formatNotificationTitle } from "../format.js";
import type {
  DeliveryResult,
  NotificationProvider,
  SafeNotification,
} from "../types.js";

const execFile = promisify(execFileCallback);

export interface AppleRemindersConfig {
  listName: string;
  dueInSeconds: number;
  cleanupAfterDays: number;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

const APPLE_SCRIPT = String.raw`
on run argv
  if (count of argv) is not 5 then error "watchcode: expected 5 arguments"
  set listName to item 1 of argv
  set reminderName to item 2 of argv
  set reminderBody to item 3 of argv
  set dueSeconds to (item 4 of argv) as integer
  set cleanupDays to (item 5 of argv) as integer
  set dueAt to (current date) + dueSeconds
  set cutoff to (current date) - (cleanupDays * days)

  tell application "Reminders"
    set targetAccount to default account
    set matchingLists to every list of targetAccount whose name is listName
    if (count of matchingLists) is 0 then
      set targetList to make new list at end of lists of targetAccount with properties {name:listName}
    else
      set targetList to item 1 of matchingLists
    end if

    set createdReminder to make new reminder at end of reminders of targetList with properties {name:reminderName, body:reminderBody, due date:dueAt, remind me date:dueAt, priority:1, flagged:true}

    repeat with oldReminder in (every reminder of targetList whose completed is true)
      try
        if modification date of oldReminder < cutoff then delete oldReminder
      end try
    end repeat
    return id of createdReminder
  end tell
end run
`;

const DIAGNOSE_SCRIPT = String.raw`
tell application "Reminders"
  set accountName to name of default account
  return accountName
end tell
`;

export class AppleRemindersProvider implements NotificationProvider {
  readonly name = "apple-reminders" as const;

  constructor(
    private readonly config: AppleRemindersConfig,
    private readonly run: CommandRunner = defaultRunner,
    private readonly platform = process.platform,
  ) {}

  async send(notification: SafeNotification): Promise<DeliveryResult> {
    if (this.platform !== "darwin")
      return {
        provider: this.name,
        ok: false,
        detail: "Apple Reminders requires macOS",
      };
    try {
      const { stdout } = await this.run("/usr/bin/osascript", [
        "-e",
        APPLE_SCRIPT,
        "--",
        this.config.listName,
        formatNotificationTitle(notification),
        formatNotificationBody(notification),
        String(this.config.dueInSeconds),
        String(this.config.cleanupAfterDays),
      ]);
      return {
        provider: this.name,
        ok: true,
        detail: stdout.trim() ? "Reminder created" : "Reminder created",
      };
    } catch (error) {
      return { provider: this.name, ok: false, detail: appleError(error) };
    }
  }

  async diagnose(): Promise<DeliveryResult> {
    if (this.platform !== "darwin")
      return {
        provider: this.name,
        ok: false,
        detail: "Apple Reminders requires macOS",
      };
    try {
      await this.run("/usr/bin/osascript", ["-e", DIAGNOSE_SCRIPT]);
      return {
        provider: this.name,
        ok: true,
        detail: "Reminders automation is available",
      };
    } catch (error) {
      return { provider: this.name, ok: false, detail: appleError(error) };
    }
  }
}

async function defaultRunner(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFile(file, [...args], { timeout: 10_000, maxBuffer: 64 * 1024 });
}

function appleError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unable to access Reminders";
  if (/Not authorized|not permitted|-1743/i.test(message)) {
    return "Reminders automation permission denied; allow your terminal or WatchCode in System Settings > Privacy & Security > Automation";
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}

export const appleScriptsForTest = {
  create: APPLE_SCRIPT,
  diagnose: DIAGNOSE_SCRIPT,
};
