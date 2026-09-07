import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "../src/manifest.json" with { type: "json" };

mock.module("@earendil-works/pi-ai", () => ({ complete: async () => ({}) }));
mock.module("@earendil-works/pi-coding-agent", () => ({
  BorderedLoader: class {},
  CustomEditor: class {},
  VERSION: "test",
  createBashTool: () => ({}),
  createEditTool: () => ({}),
  createFindTool: () => ({}),
  createGrepTool: () => ({}),
  createLsTool: () => ({}),
  createReadTool: () => ({}),
  createWriteTool: () => ({}),
  isBashToolResult: () => false,
  isReadToolResult: (event: { toolName: string }) => event.toolName === "read",
  isToolCallEventType: () => false,
}));
mock.module("@earendil-works/pi-tui", () => ({
  Box: class {},
  Text: class {},
  matchesKey: () => false,
  truncateToWidth: (value: string) => value,
  visibleWidth: (value: string) => value.length,
}));
mock.module("@mariozechner/pi-coding-agent", () => ({}));

const repoRoot = join(import.meta.dir, "../../..");
const extensionsRoot = join(repoRoot, "packages/pi-extensions/extensions");

function activeIds(): string[] {
  return manifest.active.map((extension) => extension.id);
}

describe("Pi extension ownership parity", () => {
  test("package registry and global inventory use the same active IDs", async () => {
    const [{ managedPiExtensions }, { inventoryPiRuntime, resolveManagedPiExtensionsSourceDir }] = await Promise.all([
      import("../src/registry.ts"),
      import("../../../cli/src/core/pi-runtime.ts"),
    ]);
    const packageIds = managedPiExtensions.map((extension) => extension.id);
    const sourceDir = resolveManagedPiExtensionsSourceDir(repoRoot);
    if (!sourceDir) throw new Error("Managed Pi extension source is missing");

    const globalPlan = await inventoryPiRuntime(sourceDir, sourceDir);

    expect(packageIds).toEqual(activeIds());
    expect(globalPlan.extensions.map((status) => status.ext.id)).toEqual(activeIds());
  });

  test("active entries have source directories and disabled entries have reasons", () => {
    for (const extension of manifest.active) {
      expect(existsSync(join(extensionsRoot, extension.id, "package.json"))).toBe(true);
    }

    for (const [id, reason] of Object.entries(manifest.disabled)) {
      expect(reason.length, `missing disabled reason for ${id}`).toBeGreaterThan(0);
    }
  });

  test("read-line-numbers is enrolled as a required active extension", () => {
    const entry = manifest.active.find((extension) => extension.id === "read-line-numbers");
    expect(entry).toBeDefined();
    expect(entry?.required).toBe(true);
  });
});
