import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DeliveryState {
  dedupe: Record<string, number>;
  cooldown: Record<string, number>;
}

const emptyState = (): DeliveryState => ({ dedupe: {}, cooldown: {} });

export async function readState(path: string): Promise<DeliveryState> {
  try {
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<DeliveryState>;
    return { dedupe: parsed.dedupe ?? {}, cooldown: parsed.cooldown ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    return emptyState();
  }
}

export async function writeState(
  path: string,
  state: DeliveryState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
