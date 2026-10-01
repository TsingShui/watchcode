import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(
  metaUrl: string,
  argv1 = process.argv[1],
): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return fileURLToPath(metaUrl) === argv1;
  }
}
