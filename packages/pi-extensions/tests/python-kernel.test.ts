import { describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Pi host provides typebox at runtime; tests substitute a structural
// stand-in that records the parameter schema shape (xtrm-3ljgz.1).
mock.module("typebox", () => ({
  Type: {
    Object: (shape: unknown) => ({ kind: "object", shape }),
    String: (opts: unknown) => ({ kind: "string", opts }),
    Boolean: (opts: unknown) => ({ kind: "boolean", opts }),
    Optional: (t: unknown) => ({ kind: "optional", t }),
  },
}));

const extension = await import("../extensions/python-kernel/index.ts");
const { PythonKernel } = extension;

function tmpBase() {
  const dir = mkdtempSync(join(tmpdir(), "pi-py-kernel-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function fakePi() {
  const tools: any[] = [];
  const listeners = new Map<string, Array<(event: any, ctx: any) => Promise<void>>>();
  return {
    registerTool(def: any) {
      tools.push(def);
    },
    on(event: string, cb: (event: any, ctx: any) => Promise<void>) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    tools,
    listeners,
  };
}

function runViaExecute(tool: any, params: any, signal?: AbortSignal) {
  const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "test-session" } };
  return tool.execute("test-call", params, signal, () => {}, ctx);
}

describe("python-kernel managed extension", () => {
  test("registers exactly one sequential python tool with kernel doctrine", () => {
    const pi = fakePi();
    extension.default(pi as any);

    expect(pi.tools).toHaveLength(1);
    const tool = pi.tools[0];
    expect(tool.name).toBe("python");
    expect(tool.executionMode).toBe("sequential");
    expect(tool.promptSnippet).toContain("state survives across calls");
    expect(tool.promptGuidelines.join("\n")).toContain("python state persists across calls");
    expect(tool.promptGuidelines.join("\n")).toContain("reset: true");
    // Review residual: metadata must state the trust boundary explicitly.
    expect(tool.description).toContain("user permissions");
    expect(tool.description).toContain("not sandboxed");
    expect(tool.promptGuidelines.join("\n")).toContain("user permissions");
    expect(tool.promptGuidelines.join("\n")).toContain("not sandboxed");
    expect(tool.parameters.kind).toBe("object");
    expect(tool.parameters.shape.code.kind).toBe("string");
    expect(tool.parameters.shape.reset.kind).toBe("optional");
  });

  test("kernel state persists across cells and reset clears it", async () => {
    const fx = tmpBase();
    try {
      const kernel = new PythonKernel(fx.dir, () => {});
      const first = await kernel.runCell("x = 41", false);
      expect(first.error).toBeNull();
      const second = await kernel.runCell("x + 1", false);
      expect(second.stdout.trim()).toBe("42");
      expect(second.error).toBeNull();
      const reset = await kernel.runCell("x = 0", true, fx.dir);
      expect(reset.error).toBeNull();
      expect(reset.stdout).toBe(""); // reset clears without executing the cell
      const afterReset = await kernel.runCell("x + 1", false);
      expect(afterReset.error?.ename).toBe("NameError");
      kernel.kill();
    } finally {
      fx.cleanup();
    }
  });

  test("eval and exec semantics both work and exceptions carry traceback details", async () => {
    const fx = tmpBase();
    try {
      const kernel = new PythonKernel(fx.dir, () => {});
      const expr = await kernel.runCell("1 + 1", false);
      expect(expr.stdout.trim()).toBe("2");
      const stmt = await kernel.runCell("y = [i * i for i in range(3)]", false);
      expect(stmt.error).toBeNull();
      const boom = await kernel.runCell("raise ValueError('kernel boom')", false);
      expect(boom.error).not.toBeNull();
      expect(boom.error?.ename).toBe("ValueError");
      expect(boom.error?.traceback).toContain("ValueError");
      kernel.kill();
    } finally {
      fx.cleanup();
    }
  });

  test("os.chdir persists and reset returns to the working directory", async () => {
    const fx = tmpBase();
    try {
      const kernel = new PythonKernel(fx.dir, () => {});
      const chdir = await kernel.runCell("import os; os.chdir('/tmp')", false);
      expect(chdir.error).toBeNull();
      const where = await kernel.runCell("os.getcwd()", false);
      expect(where.stdout.trim()).toBe("'/tmp'"); // eval path reprs string results
      await kernel.runCell("x_cwd = os.getcwd()", false);
      const reset = await kernel.runCell("x_cwd", true, fx.dir);
      expect(reset.error).toBeNull(); // reset does not execute the cell
      const cleared = await kernel.runCell("x_cwd", false);
      expect(cleared.error?.ename).toBe("NameError"); // namespace was cleared
      const back = await kernel.runCell("import os", false);
      expect(back.error).toBeNull();
      const backCwd = await kernel.runCell("os.getcwd()", false);
      expect(backCwd.stdout.trim()).toBe(`'${fx.dir}'`); // cwd reset to the working directory
      kernel.kill();
    } finally {
      fx.cleanup();
    }
  });

  test("missing python3 yields a structured tool error, never a crash", async () => {
    const fx = tmpBase();
    try {
      const pi = fakePi();
      const missingBin = join(fx.dir, "definitely-missing-python3");
      extension.default(pi as any, {
        kernelFactory: () => new PythonKernel(fx.dir, () => {}, {
          pythonBin: missingBin,
          startTimeoutMs: 2_000,
        }),
      });
      const tool = pi.tools[0];
      const result = await runViaExecute(tool, { code: "1 + 1" });
      expect(result.isError).toBe(true);
      expect(result.details.status).toBe("error");
      expect(result.content[0].text).toMatch(/failed to start|python/i);
    } finally {
      fx.cleanup();
    }
  });

  test("abort kills the kernel and pending cells fail immediately", async () => {
    const fx = tmpBase();
    try {
      const pi = fakePi();
      extension.default(pi as any);
      const tool = pi.tools[0];
      const controller = new AbortController();
      const pending = runViaExecute(tool, { code: "import time; time.sleep(30)" }, controller.signal);
      // Give the kernel a beat to start and begin the long cell.
      await new Promise((resolve) => setTimeout(resolve, 300));
      controller.abort();
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/kernel killed|timed out|exited/i);
    } finally {
      fx.cleanup();
    }
  });

  test("long cells time out with a clear structured error and drop the kernel", async () => {
    const fx = tmpBase();
    try {
      const kernel = new PythonKernel(fx.dir, () => {}, { cellTimeoutMs: 250 });
      const result = await kernel.runCell("import time; time.sleep(30)", false);
      // Review residual: the timed-out cell must report a timeout, not the
      // generic killed result that kill() would otherwise produce.
      expect(result.error?.ename).toBe("KernelTimeout");
      expect(result.stderr).toContain("timed out after 0.25s");
      // The next call must spawn a fresh kernel instead of reusing a dead one.
      const next = await kernel.runCell("1 + 1", false);
      expect(next.stdout.trim()).toBe("2");
      kernel.kill();
    } finally {
      fx.cleanup();
    }
  });

  test("driver exit removes the temp dir and a later call retries on a fresh spawn", async () => {
    const fx = tmpBase();
    try {
      // Deterministic fail-once bin: exits 3 on the first spawn (marker
      // absent), then delegates to the real python3. No sleeps.
      const marker = join(fx.dir, "fail-marker");
      const bin = join(fx.dir, "python3-fail-once");
      writeFileSync(bin, `#!/bin/sh\nif [ -f "${marker}" ]; then exec python3 "$@"; fi\ntouch "${marker}"\nexit 3\n`);
      chmodSync(bin, 0o755);
      const kernel = new PythonKernel(fx.dir, () => {}, { pythonBin: bin, startTimeoutMs: 5_000 });

      const first = await kernel.runCell("1 + 1", false);
      expect(first.error?.ename).toBe("KernelExited");
      expect(first.stderr).toContain("exited (3)");
      // Crash/exit must remove the temp driver dir and reset startup state.
      expect((kernel as any).tmpDir).toBeUndefined();
      // The start-timeout timer from the dead spawn must be cleared too, so a
      // stale timer can never kill a later healthy kernel.
      expect((kernel as any).readyTimer).toBeUndefined();

      // A later call must retry from scratch and succeed.
      const second = await kernel.runCell("2 + 2", false);
      expect(second.error).toBeNull();
      expect(second.stdout.trim()).toBe("4");
      kernel.kill();
    } finally {
      fx.cleanup();
    }
  });

  test("session_shutdown cleans up kernels", async () => {
    const fx = tmpBase();
    try {
      const pi = fakePi();
      extension.default(pi as any);
      const tool = pi.tools[0];
      const first = await runViaExecute(tool, { code: "x = 1" });
      expect(first.isError).toBe(false);
      const shutdown = pi.listeners.get("session_shutdown");
      expect(shutdown).toBeDefined();
      await shutdown![0]({}, {});
      const after = await runViaExecute(tool, { code: "x" });
      expect(after.isError).toBe(true); // state was cleared by shutdown
      expect(after.content[0].text).toMatch(/NameError|python error/i);
    } finally {
      fx.cleanup();
    }
  });

  test("output truncation guards unbounded tool results", async () => {
    const fx = tmpBase();
    try {
      const pi = fakePi();
      extension.default(pi as any);
      const tool = pi.tools[0];
      const result = await runViaExecute(tool, { code: "print('x' * 300_000)" });
      expect(result.isError).toBe(false);
      expect(result.content[0].text.length).toBeLessThan(205_000);
      expect(result.content[0].text.endsWith("... [output truncated]")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});
