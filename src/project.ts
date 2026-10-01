import { basename, resolve } from "node:path";

export function safeProjectName(cwd: string): string {
  const name = basename(resolve(cwd)).trim();
  return name || "project";
}
