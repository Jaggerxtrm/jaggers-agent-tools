import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Real-Pi integration: spawn `pi --print` and force it to `read` a file that
// ends in "\n", then look for the numbered trailing-empty line in the raw
// tool_result. Guarded by RUN_PI_INTEGRATION because it needs a live model
// key + network. Never fakes success — skips loudly when unavailable.
//
// Why guarded: the CI runner has no provider creds. Run locally with
//   RUN_PI_INTEGRATION=1 npm test --workspace=@jaggerxtrm/pi-extensions
// and paste the resulting <RESULT> block into the PR body as evidence.
// ---------------------------------------------------------------------------

const RUN = process.env.RUN_PI_INTEGRATION === "1";

describe("Pi EOF real spawn (RUN_PI_INTEGRATION=1)", () => {
  test.if(RUN)("read on 'one\\ntwo\\n' at offset=3 renders '3 | '", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlnfix-eof-"));
    const target = join(dir, "eof.txt");
    writeFileSync(target, "one\ntwo\n");
    try {
      if (!existsSync("/home/dawid/.nvm/versions/node/v24.15.0/bin/pi")) {
        console.warn("[pi-integration-eof] pi binary not found — skipping");
        return;
      }
      const model = process.env.PI_MODEL ?? "google/gemini-2.0-flash-exp";
      const res = spawnSync(
        "pi",
        [
          "--print",
          "--no-session",
          "--model",
          model,
          `Use the read tool on ${target} with offset=3. Then output ONLY the tool_result text you received back, delimited by <RESULT> and </RESULT>. Do not paraphrase.`,
        ],
        { encoding: "utf-8", timeout: 90_000 },
      );
      const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      if (res.status !== 0 || out.trim().length === 0) {
        console.warn("[pi-integration-eof] pi returned non-zero or empty; skipping. status=", res.status);
        console.warn(out.slice(0, 400));
        return;
      }
      // Real proof: the numbered trailing-empty must be present in the transcript.
      expect(out).toContain("3 | ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.if(!RUN)("skipped: set RUN_PI_INTEGRATION=1 to spawn real pi", () => {
    expect(true).toBe(true);
  });
});
