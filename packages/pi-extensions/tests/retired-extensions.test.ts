import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const retiredAutoUpdatePaths = [
  "packages/pi-extensions/extensions/auto-update",
  "packages/pi-extensions/src/extensions/auto-update.ts",
  ".xtrm/packages/pi-extensions/extensions/auto-update",
  ".xtrm/packages/pi-extensions/src/extensions/auto-update.ts",
  ".xtrm/ext-src/auto-update",
];

describe("retired Pi extensions", () => {
  test("auto-update is absent from shipped sources and runtime inventories", () => {
    for (const relativePath of retiredAutoUpdatePaths) {
      expect(existsSync(join(repoRoot, relativePath))).toBe(false);
    }

    for (const relativePath of [
      "packages/pi-extensions/src/shared/legacy-path-map.ts",
      "packages/pi-extensions/MIGRATION_NOTES.md",
      "packages/pi-extensions/extensions/xtprompt/index.test.ts",
      "cli/src/core/pi-runtime.ts",
    ]) {
      expect(readFileSync(join(repoRoot, relativePath), "utf8")).not.toContain("auto-update");
    }
  });
});
