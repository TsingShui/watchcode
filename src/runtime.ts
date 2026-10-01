import { loadConfig } from "./config.js";
import { WatchcodeNotifier } from "./notifier.js";
import { AppleRemindersProvider } from "./providers/apple-reminders.js";

export async function createNotifier(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WatchcodeNotifier> {
  const config = await loadConfig(env.WATCHCODE_CONFIG);
  const providers = new Map();
  providers.set("apple-reminders", new AppleRemindersProvider(config.apple));
  return new WatchcodeNotifier(config, providers);
}
