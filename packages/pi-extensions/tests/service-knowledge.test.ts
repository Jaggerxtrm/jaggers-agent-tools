import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The Pi host provides typebox at runtime; unused by this extension but kept for
// parity with the other extension tests' module mocks.
mock.module("typebox", () => ({
  Type: {
    Object: (shape: unknown) => ({ kind: "object", shape }),
    String: (opts: unknown) => ({ kind: "string", opts }),
    Boolean: (opts: unknown) => ({ kind: "boolean", opts }),
    Optional: (t: unknown) => ({ kind: "optional", t }),
  },
}));

const extension = await import("../extensions/service-knowledge/index.ts");

function tmpBase() {
  const dir = mkdtempSync(join("/tmp", "pi-sk-ext-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write a canonical service-knowledge registry: .xtrm/skills/<pack>/service-knowledge/. */
function writeRegistry(packDir: string, services: Record<string, Record<string, unknown>>) {
  const umbrella = join(packDir, "service-knowledge");
  mkdirSync(umbrella, { recursive: true });
  writeFileSync(join(umbrella, "service-registry.json"), JSON.stringify({ services }, null, 2));
  return umbrella;
}

/** The canonical service registry location the extension must find (xtrm-6z6.1). */
function canonicalPackDir(cwd: string, pack: string) {
  return join(cwd, ".xtrm", "skills", pack);
}

function fakePi() {
  const commands: any[] = [];
  const listeners = new Map<string, Array<(event: any, ctx: any) => Promise<void>>>();
  return {
    registerCommand(name: string, def: any) {
      commands.push({ name, ...def });
    },
    on(event: string, cb: (event: any, ctx: any) => Promise<void>) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    commands,
    listeners,
  };
}

describe("service-knowledge ext v1 (xtrm-6z6.1)", () => {
  test("self-gating: no registry anywhere → zero surface (no command, no handlers)", () => {
    const fx = tmpBase();
    try {
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.commands).toHaveLength(0);
      expect(pi.listeners.size).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: canonical .xtrm/skills/<pack>/service-knowledge layout is found", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].umbrellaName).toBe("service-knowledge");
      expect(packs[0].registryPath).toContain(".xtrm/skills/infra/service-knowledge/service-registry.json");
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: NEW service-knowledge wins over LEGACY service-skills per pack", () => {
    const fx = tmpBase();
    try {
      const pack = canonicalPackDir(fx.dir, "infra");
      // Legacy umbrella first.
      const legacy = join(pack, "service-skills");
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, "service-registry.json"), JSON.stringify({ services: { a: {} } }));
      // New umbrella wins when present.
      writeRegistry(pack, { "db-expert": { description: "db" } });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].umbrellaName).toBe("service-knowledge");
      expect(packs[0].registryPath).toContain("service-knowledge");
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: reserved pack names are skipped", () => {
    const fx = tmpBase();
    try {
      // 'default' is reserved — must not be treated as a service pack.
      writeRegistry(canonicalPackDir(fx.dir, "default"), { x: {} });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: user/packs root is scanned too", () => {
    const fx = tmpBase();
    try {
      const userPack = join(fx.dir, ".xtrm", "skills", "user", "packs", "team-a");
      writeRegistry(userPack, { svc: {} });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].packDir).toContain("user/packs/team-a");
    } finally {
      fx.cleanup();
    }
  });

  test("layout validation: exact mercury/infra canonical shape is found", () => {
    const fx = tmpBase();
    try {
      // .xtrm/skills/infra/service-knowledge/service-registry.json (mercury/infra).
      const umb = join(fx.dir, ".xtrm", "skills", "infra", "service-knowledge");
      mkdirSync(umb, { recursive: true });
      writeFileSync(join(umb, "service-registry.json"), JSON.stringify({ services: { "db-expert": { description: "db" } } }));
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].umbrellaName).toBe("service-knowledge");
      expect(packs[0].registryPath).toBe(join(umb, "service-registry.json"));
      expect(packs[0].packDir.endsWith(join(".xtrm", "skills", "infra"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("layout validation: legacy .claude/skills/service-skills is deliberately NOT found", () => {
    const fx = tmpBase();
    try {
      mkdirSync(join(fx.dir, ".claude", "skills", "service-skills"), { recursive: true });
      writeFileSync(join(fx.dir, ".claude", "skills", "service-skills", "service-registry.json"), JSON.stringify({ services: {} }));
      // The canonical resolver does not fall back to .claude/skills — that was
      // the stale ext's behavior and is deliberately dropped.
      expect(extension.findUmbrellaPacks(fx.dir)).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("registry present → registers command + before_agent_start handler", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db", last_sync_ref: "abc12345" } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.commands).toHaveLength(1);
      expect(pi.commands[0].name).toBe("service-knowledge:status");
      expect(pi.listeners.has("before_agent_start")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("before_agent_start emits a context note with service count + drift state", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("before_agent_start")![0];
      const result = await handler({}, { cwd: fx.dir });
      expect(result?.message?.content).toContain("1 pack(s), 1 service(s)");
      expect(result?.message?.content).toContain("drift: none detected");
      // Drift marker present flips the notice.
      mkdirSync(join(fx.dir, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.dir, ".xtrm", ".service-knowledge-drift-pending"), "drift");
      const result2 = await handler({}, { cwd: fx.dir });
      expect(result2?.message?.content).toContain("drift: PENDING marker present");
    } finally {
      fx.cleanup();
    }
  });

  test("status command golden: services, last_sync_ref vs HEAD, marker, suggested action", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), {
        "db-expert": { description: "db", last_sync_ref: "0000000" }, // deliberately != HEAD
        "auth-svc": { description: "auth" }, // never synced
      });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: fx.dir, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain("service-knowledge status");
      expect(out).toContain("db-expert: last_sync_ref 0000000");
      expect(out).toContain("auth-svc: last_sync_ref (never)");
      expect(out).toContain("git HEAD:");
      expect(out).toContain("drift marker");
      expect(out).toContain("suggested action: run /updating-service-knowledge");
    } finally {
      fx.cleanup();
    }
  });

  test("status command: no drift when every service matches HEAD", async () => {
    const fx = tmpBase();
    try {
      // No last_sync_ref at all + no marker → nothing to reconcile.
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: fx.dir, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain("suggested action: none — registry is in sync with HEAD");
    } finally {
      fx.cleanup();
    }
  });

  test("status command: in-sync refs (7-char, matching git HEAD short sha) are NOT flagged (xtrm-vs7f8)", async () => {
    const fx = tmpBase();
    try {
      // Point the command's cwd at the real core repo so gitHead resolves, and
      // give a service a last_sync_ref equal to the current HEAD short sha.
      const coreRoot = join(import.meta.dir, "../../..");
      const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db", last_sync_ref: head } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: coreRoot, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain(`db-expert: last_sync_ref ${head}`);
      expect(out).toContain("suggested action: none — registry is in sync with HEAD");
    } finally {
      fx.cleanup();
    }
  });
});
