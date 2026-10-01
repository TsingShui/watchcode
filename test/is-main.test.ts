import assert from "node:assert/strict";
import { symlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isMainModule } from "../src/is-main.js";

test("main-module detection tolerates symlinked executable paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchcode-main-"));
  const target = join(root, "target.js");
  const link = join(root, "link.js");
  await writeFile(target, "");
  await symlink(target, link);
  assert.equal(isMainModule(pathToFileURL(target).href, link), true);
  assert.equal(
    isMainModule(pathToFileURL(target).href, join(root, "other.js")),
    false,
  );
});
