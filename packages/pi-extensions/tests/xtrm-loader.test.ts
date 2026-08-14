import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loader = await import("../extensions/xtrm-loader/index.ts");

const DOCTRINE = "# BD Memory Doctrine\n\nUse `bd memories <topic>` when history is relevant.\n";

function projectFixture() {
  const root = mkdtempSync(join(tmpdir(), "xtrm-loader-test-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakePi() {
  const handlers: Array<(event: any, ctx: any) => Promise<unknown>> = [];
  return {
    on(event: string, cb: (event: any, ctx: any) => Promise<unknown>) {
      if (event === "before_agent_start") handlers.push(cb);
    },
    handlers,
  };
}

describe("xtrm-loader memory doctrine (xtrm-3ljgz.3)", () => {
  test("injects the canonical doctrine verbatim and never injects memory.md", async () => {
    const fx = projectFixture();
    try {
      const instructions = join(fx.root, ".xtrm", "config", "instructions");
      mkdirSync(instructions, { recursive: true });
      writeFileSync(join(instructions, "memory-doctrine.md"), DOCTRINE);
      // A stale synthesized memory.md must NOT be injected even when present.
      mkdirSync(join(fx.root, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.root, ".xtrm", "memory.md"), "stale synthesized state that must not leak");

      const pi = fakePi();
      loader.default(pi as any);
      expect(pi.handlers).toHaveLength(1);

      const event = { systemPrompt: "base prompt" };
      const result = await pi.handlers[0](event, { cwd: fx.root });
      expect(result).not.toBeUndefined();
      expect(result.systemPrompt).toBe(`base prompt\n\n${DOCTRINE.trim()}`);
      expect(result.systemPrompt).not.toContain("stale synthesized state");
    } finally {
      fx.cleanup();
    }
  });

  test("fails open when the doctrine file is missing", async () => {
    const fx = projectFixture();
    try {
      const pi = fakePi();
      loader.default(pi as any);
      const result = await pi.handlers[0]({ systemPrompt: "base" }, { cwd: fx.root });
      expect(result).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("fails open on unreadable doctrine content", async () => {
    const fx = projectFixture();
    try {
      const instructions = join(fx.root, ".xtrm", "config", "instructions");
      mkdirSync(instructions, { recursive: true });
      writeFileSync(join(instructions, "memory-doctrine.md"), "   \n  ");

      const pi = fakePi();
      loader.default(pi as any);
      const result = await pi.handlers[0]({ systemPrompt: "base" }, { cwd: fx.root });
      expect(result).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });
});
