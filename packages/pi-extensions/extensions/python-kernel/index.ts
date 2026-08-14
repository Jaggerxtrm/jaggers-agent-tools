/**
 * Persistent Python Kernel Tool (managed, xtrm-3ljgz.1)
 *
 * Adds a `python` tool backed by one persistent python3 process per session.
 * State (variables, imports, functions) survives across calls — the
 * differentiator over `bash`, which is stateless per call.
 *
 * Transport: a small driver script runs as a JSON-lines RPC loop. Each tool
 * call sends a JSON-encoded cell; the driver exec()s it in a shared namespace
 * and replies with structured { stdout, stderr, error, duration_ms }. No pty,
 * no jupyter, no terminal noise.
 *
 * Semantics (mirror prime-agent's kernel doctrine):
 * - Python state persists across cells until reset: true.
 * - os.chdir() inside a cell persists; reset returns to the working directory.
 * - The process runs with user permissions — not a sandbox.
 *
 * Prerequisite: python3 must be on PATH (or configured via `pythonBin`). A
 * missing interpreter is reported as a structured tool error on every call —
 * the kernel never crashes the host.
 *
 * Migration: this extension replaced the user-local
 * ~/.pi/agent/extensions/python-kernel.ts. Copy any customisations forward,
 * then remove the loose file manually; xt never deletes user-owned files.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DRIVER = `
import json, sys, time, traceback, contextlib, io, os

_ns = {}

def run_cell(code, reset=False, cwd=None):
    if reset:
        _ns.clear()
        if cwd:
            os.chdir(cwd)
        return {"stdout": "", "stderr": "", "error": None, "duration_ms": 0}
    if cwd:
        os.chdir(cwd)
    out, err = io.StringIO(), io.StringIO()
    start = time.time()
    error = None
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                compiled = compile(code, "<cell>", "eval")
                result = eval(compiled, _ns)
                if result is not None:
                    print(repr(result))
            except SyntaxError:
                exec(compile(code, "<cell>", "exec"), _ns)
    except Exception:
        error = {"ename": type(sys.exc_info()[1]).__name__, "evalue": str(sys.exc_info()[1]), "traceback": traceback.format_exc().rstrip()}
    return {
        "stdout": out.getvalue(),
        "stderr": err.getvalue(),
        "error": error,
        "duration_ms": int((time.time() - start) * 1000),
    }

def main():
    sys.stdout.write(json.dumps({"ready": True, "python": sys.version.split()[0]}) + "\\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            sys.stdout.write(json.dumps({"seq": None, "stdout": "", "stderr": f"bad request: {e}", "error": None, "duration_ms": 0}) + "\\n")
            sys.stdout.flush()
            continue
        res = run_cell(req.get("code") or "", bool(req.get("reset")), req.get("cwd"))
        res["seq"] = req.get("seq")
        sys.stdout.write(json.dumps(res) + "\\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
`.trim();

const DEFAULT_PYTHON_BIN = "python3";
const DEFAULT_CELL_TIMEOUT_MS = 120_000;
const DEFAULT_START_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 200_000;

export interface CellResult {
	seq?: number;
	stdout: string;
	stderr: string;
	error: { ename: string; evalue: string; traceback: string } | null;
	duration_ms: number;
}

export interface PythonKernelOptions {
	/** Interpreter binary; default "python3" (must be on PATH). */
	pythonBin?: string;
	/** Per-cell timeout; default 120s. */
	cellTimeoutMs?: number;
	/** Driver-ready timeout; default 10s. */
	startTimeoutMs?: number;
}

export class PythonKernel {
	private proc: ChildProcessWithoutNullStreams | undefined;
	private tmpDir: string | undefined;
	private buf = "";
	private waiters: Array<(r: CellResult) => void> = [];
	private nextSeq = 1;
	private started: Promise<void> | undefined;
	private readyResolve: (() => void) | undefined;
	private readyReject: ((e: Error) => void) | undefined;
	private readyTimer: ReturnType<typeof setTimeout> | undefined;
	private stderrBuf = "";
	private crashed = false;
	private lastSpawnError: string | undefined;
	private readonly pythonBin: string;
	private readonly cellTimeoutMs: number;
	private readonly startTimeoutMs: number;

	constructor(
		private readonly cwd: string,
		private readonly onRestart: (message: string) => void,
		options: PythonKernelOptions = {},
	) {
		this.pythonBin = options.pythonBin ?? DEFAULT_PYTHON_BIN;
		this.cellTimeoutMs = options.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
		this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
	}

	ensureStarted(): Promise<void> {
		if (!this.started) {
			this.started = this.spawn();
		}
		return this.started;
	}

	private async spawn(): Promise<void> {
		this.lastSpawnError = undefined;
		const tmpDir = await mkdtemp(join(tmpdir(), "pi-py-kernel-"));
		this.tmpDir = tmpDir;
		const driverPath = join(tmpDir, "driver.py");
		await writeFile(driverPath, DRIVER, "utf8");
		this.buf = "";
		this.waiters = [];
		this.stderrBuf = "";
		this.crashed = false;
		this.nextSeq = 1;

		const proc = spawn(this.pythonBin, ["-u", driverPath], {
			cwd: this.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			// Own process group so we can kill code-spawned children too.
			detached: true,
		});
		this.proc = proc;

		// Dead children (e.g. ENOENT) close their stdio streams; swallow the
		// resulting stream errors so they never become unhandled 'error' events.
		proc.stdin.on("error", () => {});
		proc.stdout.on("error", () => {});
		proc.stderr.on("error", () => {});

		// xtrm-3ljgz.1: a missing/unlaunchable interpreter surfaces as an
		// 'error' event on the child (ENOENT etc.). Without a handler this
		// would be an unhandled 'error' event crash; instead record the cause
		// and fail every pending call so it turns into a structured tool error.
		proc.on("error", (err) => {
			if (this.proc !== proc) return;
			this.proc = undefined;
			this.started = undefined;
			this.crashed = true;
			this.lastSpawnError = `${this.pythonBin} failed to start: ${err.message}`;
			this.failAll(new Error(this.lastSpawnError));
			this.rejectReady(new Error(this.lastSpawnError));
			this.removeTmpDir();
		});

		proc.stdout.on("data", (d: Buffer) => this.onData(d.toString()));
		proc.stderr.on("data", (d: Buffer) => {
			this.stderrBuf = (this.stderrBuf + d.toString()).slice(-16_384);
		});
		proc.on("exit", (code, signal) => {
			if (this.proc !== proc) return;
			this.proc = undefined;
			this.started = undefined;
			this.crashed = true;
			this.failAll(new Error(`python kernel exited (${signal ?? code})`));
			// Clear the pending start-timeout so a stale timer from this dead
			// spawn cannot kill a later, healthy kernel (xtrm-3ljgz review).
			if (this.readyTimer) {
				clearTimeout(this.readyTimer);
				this.readyTimer = undefined;
			}
			this.removeTmpDir();
		});

		this.readyTimer = setTimeout(() => {
			this.rejectReady(new Error(`${this.pythonBin} kernel did not start in time`));
		}, this.startTimeoutMs);
	}

	private onData(chunk: string): void {
		this.buf += chunk;
		let i: number;
		while ((i = this.buf.indexOf("\n")) >= 0) {
			const line = this.buf.slice(0, i).trim();
			this.buf = this.buf.slice(i + 1);
			if (!line) continue;
			let msg: { ready?: boolean; python?: string } | CellResult;
			try {
				msg = JSON.parse(line);
			} catch {
				continue; // not protocol JSON; ignore
			}
			if ("ready" in msg && msg.ready) {
				this.resolveReady();
				continue;
			}
			const waiter = this.waiters.shift();
			if (waiter) waiter(msg as CellResult);
		}
	}

	private resolveReady(): void {
		if (this.readyTimer) clearTimeout(this.readyTimer);
		this.readyResolve?.();
		this.readyResolve = undefined;
		this.readyReject = undefined;
	}

	private rejectReady(e: Error): void {
		this.readyReject?.(e);
		this.readyResolve = undefined;
		this.readyReject = undefined;
		this.kill();
	}

	private failAll(e: Error): void {
		this.readyReject?.(e);
		this.readyResolve = undefined;
		this.readyReject = undefined;
		const waiters = this.waiters;
		this.waiters = [];
		for (const w of waiters) {
			// Reject is not representable in the waiter tuple type; route through a
			// killed cell result instead so pending calls fail with the crash.
			w({
				seq: undefined,
				stdout: "",
				stderr: e.message,
				error: { ename: "KernelExited", evalue: e.message, traceback: "" },
				duration_ms: 0,
			});
		}
	}

	runCell(code: string, reset: boolean, cwd?: string): Promise<CellResult> {
		return this.ensureStarted().then(() => {
			if (this.lastSpawnError) throw new Error(this.lastSpawnError);
			if (!this.proc) {
				throw new Error(this.lastSpawnError ?? `${this.pythonBin} kernel is not running`);
			}
			const seq = this.nextSeq++;
			return new Promise<CellResult>((resolve) => {
				const timer = setTimeout(() => {
					const message = `python cell timed out after ${this.cellTimeoutMs / 1000}s`;
					// Report the timeout to THIS cell before kill() drains it, so the
					// caller sees a clear timed-out error instead of the generic killed
					// result (xtrm-3ljgz review residual).
					resolve({
						seq: undefined,
						stdout: "",
						stderr: `${message} (kernel killed; state lost — the next call restarts it)`,
						error: { ename: "KernelTimeout", evalue: message, traceback: "" },
						duration_ms: 0,
					});
					this.kill(); // cell still running; drop the kernel and its process group
				}, this.cellTimeoutMs);
				this.waiters.push((r) => {
					clearTimeout(timer);
					resolve(r);
				});
				this.proc!.stdin.write(JSON.stringify({ seq, code, reset, cwd }) + "\n");
			});
		});
	}

	kill(): void {
		const proc = this.proc;
		this.proc = undefined;
		this.started = undefined;
		if (this.readyTimer) clearTimeout(this.readyTimer);
		// Drain pending cells so an aborted call fails immediately, not at the timeout.
		const waiters = this.waiters;
		this.waiters = [];
		const killed: CellResult = {
			seq: undefined,
			stdout: "",
			stderr: "kernel killed",
			error: { ename: "KernelKilled", evalue: "kernel killed", traceback: "" },
			duration_ms: 0,
		};
		for (const w of waiters) w(killed);
		if (proc?.pid) {
			try {
				process.kill(-proc.pid, "SIGKILL"); // process group: kills code-spawned children
			} catch {
				// already gone
			}
		}
		this.removeTmpDir();
	}

	private removeTmpDir(): void {
		if (this.tmpDir) {
			void rm(this.tmpDir, { recursive: true, force: true });
			this.tmpDir = undefined;
		}
	}

	get crashedState(): boolean {
		return this.crashed;
	}

	get stderrDiagnostics(): string {
		return this.stderrBuf;
	}
}

export type KernelFactory = (cwd: string, sessionId: string) => PythonKernel;

export default function pythonKernelExtension(pi: ExtensionAPI, opts: { kernelFactory?: KernelFactory } = {}) {
	const kernels = new Map<string, PythonKernel>();

	function kernelFor(cwd: string, sessionId: string): PythonKernel {
		let k = kernels.get(sessionId);
		if (!k) {
			k = opts.kernelFactory ? opts.kernelFactory(cwd, sessionId) : new PythonKernel(cwd, () => {});
			kernels.set(sessionId, k);
		}
		return k;
	}

	pi.registerTool({
		name: "python",
		label: "Python (persistent kernel)",
		description:
			"Execute Python code in a persistent interpreter. Variables, imports, and functions persist across calls until reset: true. Code runs with your user permissions and is not sandboxed — treat a cell like any shell command. Run shell commands with subprocess when needed; for a project's own tests, scripts, and CLIs use the project's documented environment instead.",
		promptSnippet: "python - run code in a persistent kernel; state survives across calls",
		promptGuidelines: [
			"Use python for multi-step processing, parsing, aggregation, and fan-out: one cell replaces many round trips, and named variables persist across cells.",
			"python state persists across calls (variables, imports, functions); pass reset: true to clear it.",
			"os.chdir() inside a cell persists; reset returns to the working directory.",
			"Code runs with your user permissions and is not sandboxed; treat a cell like a shell command.",
			"For a project's own tests, scripts, and CLIs, use the project's documented environment (uv run, .venv/bin/python, npm run) rather than the kernel.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			code: Type.String({ description: "Python code to execute in the persistent kernel." }),
			reset: Type.Optional(
				Type.Boolean({ description: "Clear the kernel namespace and return to the working directory." }),
			),
		}),
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const kernel = kernelFor(ctx.cwd, sessionId);
			const onAbort = () => kernel.kill();
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				const result = await kernel.runCell(params.code, params.reset === true, params.reset ? ctx.cwd : undefined);

				let text = result.stdout;
				if (result.stderr) text += (text ? "\n" : "") + result.stderr;
				if (result.error) {
					text += (text ? "\n" : "") + result.error.traceback;
				}
				if (text.length > MAX_OUTPUT) {
					text = text.slice(0, MAX_OUTPUT) + "\n... [output truncated]";
				}
				if (kernel.crashedState && result.error?.ename === "KernelExited") {
					text = `[python kernel crashed; prior state is lost — it restarts on the next call]\n\n` + text;
				}

				return {
					content: [{ type: "text", text: text || "(no output)" }],
					details: {
						status: result.error ? "error" : "ok",
						stdout: result.stdout,
						stderr: result.stderr,
						durationMs: result.duration_ms,
						error: result.error ?? undefined,
					},
					isError: result.error !== null,
				};
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				const diag = kernel.stderrDiagnostics ? `\n[kernel stderr] ${kernel.stderrDiagnostics}` : "";
				return {
					content: [{ type: "text", text: `python error: ${message}${diag}` }],
					details: { status: "error", error: { ename: "ToolError", evalue: message, traceback: "" } },
					isError: true,
				};
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	});

	// Clean up kernels when the session ends.
	pi.on("session_shutdown", async () => {
		for (const kernel of kernels.values()) {
			kernel.kill();
		}
		kernels.clear();
	});
}
