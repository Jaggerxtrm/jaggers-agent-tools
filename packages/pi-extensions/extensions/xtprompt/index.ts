/**
 * xtprompt - context aware prompt improver.
 *
 * Global Pi extension. Shortcut: alt+m  (alt+p intentionally avoided to not
 * collide with pi-promptsmith if both are installed). Command: /msmith
 *
 * Rewrites the current editor draft via a standalone model call (the active
 * model), using anthropic + xtrm/planning-aware intent templates + hard style rules, then writes
 * the improved prompt back into the editor. The main agent turn never runs
 * during the rewrite.
 */
import { complete } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  UserMessage,
} from "@earendil-works/pi-ai";
import {
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = "mercury-smith";
const COMMAND = "msmith";
const DEFAULT_SHORTCUT = "alt+m";

const SENTINEL_OPEN = "<mercury-smith>";
const SENTINEL_CLOSE = "</mercury-smith>";

const ENHANCER_MAX_OUTPUT_TOKENS = 1600;
const DEFAULT_TIMEOUT_MS = 45_000;

type Intent =
  | "pane-dispatch"
  | "specialist"
  | "bead"
  | "scope-plan"
  | "debug"
  | "generic";

interface SmithState {
  enabled: boolean;
}

function createState(): SmithState {
  return { enabled: true };
}

export default function mercurySmith(pi: ExtensionAPI): void {
  const state = createState();

  const enhance = async (ctx: ExtensionContext): Promise<void> => {
    if (!state.enabled) {
      ctx.ui.notify(`${EXTENSION} is disabled. Run /${COMMAND} on`, "info");
      return;
    }
    if (!ctx.hasUI) {
      ctx.ui.notify(`${EXTENSION} needs the interactive TUI.`, "error");
      return;
    }
    const draft = ctx.ui.getEditorText();
    if (!draft.trim()) {
      ctx.ui.notify(`${EXTENSION}: editor is empty — nothing to rewrite.`, "info");
      return;
    }
    const model = ctx.model;
    if (!model) {
      ctx.ui.notify(`${EXTENSION}: no active model selected.`, "error");
      return;
    }

    const intent = detectIntent(draft);
    const envContext = await gatherContext(pi).catch(() => "") ?? "";
    const systemPrompt = buildSystemPrompt(intent, envContext);

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(`${EXTENSION}: cannot resolve API key — ${auth.error}`, "error");
      return;
    }

    const userMessage: UserMessage = {
      role: "user",
      content: draft,
      timestamp: Date.now(),
    };
    const request: Context = {
      systemPrompt,
      messages: [userMessage],
    };

    const outcome = await runWithLoader(
      ctx,
      `${EXTENSION} rewriting (${intent})…`,
      async (signal) => {
        const primary = await callModel(model, request, auth, signal);
        if (primary === null) return null;
        const text = extractText(primary);
        const parsed = parseSentinel(text);
        if (parsed !== undefined) return parsed;
        // retry once with a harder format reminder
        const retried = await callModel(model, retryRequest(request), auth, signal);
        if (retried === null) return null;
        const parsed2 = parseSentinel(extractText(retried));
        if (parsed2 !== undefined) return parsed2;
        throw new Error(
          `${EXTENSION}: model did not return the ${SENTINEL_OPEN} block after a retry. Leaving editor unchanged.`,
        );
      },
    ).catch((err: unknown) => {
      ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      return null;
    });

    if (outcome === null) return;
    ctx.ui.setEditorText(outcome);
    ctx.ui.notify(`${EXTENSION}: enhanced (${intent}).`, "info");
  };

  pi.registerShortcut(DEFAULT_SHORTCUT, {
    description: `Rewrite the current editor draft (${EXTENSION})`,
    handler: enhance,
  });

  pi.registerCommand(COMMAND, {
    description: `${EXTENSION}: rewrite the current editor prompt`,
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim().toLowerCase();
      if (arg === "on") {
        state.enabled = true;
        ctx.ui.notify(`${EXTENSION} enabled.`, "info");
        return;
      }
      if (arg === "off") {
        state.enabled = false;
        ctx.ui.notify(`${EXTENSION} disabled.`, "info");
        return;
      }
      if (arg === "status") {
        ctx.ui.notify(
          `${EXTENSION}: ${state.enabled ? "enabled" : "disabled"} · shortcut ${DEFAULT_SHORTCUT} · /${COMMAND}`,
          "info",
        );
        return;
      }
      await enhance(ctx);
    },
  });
}

/* ------------------------------------------------------------------ intent */

interface IntentRule {
  intent: Intent;
  patterns: RegExp[];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "pane-dispatch",
    patterns: [
      /\bmultiplex(?:ing)?\b/,
      /\bpane\b/,
      /\bdispatch(?:ed)?\b/,
      /\borchestrat(?:e|or|ion)\b/,
      /\bsubordinate\b/,
      /\bjudge\b/,
      /\bdeploy monitor(?:ing)?\b/,
      /\btmux\b/,
      /\bsend .*to (?:pane|session|agent)\b/i,
    ],
  },
  {
    intent: "specialist",
    patterns: [
      /\bspecialist\b/,
      /\bexecutor\b/,
      /\breviewer\b/,
      /\bexplorer\b/,
      /\bdebugger\b/,
      /\bsp (?:run|script|serve|node)\b/,
      /\busing-specialists\b/,
      /\bquant-methodologist\b/,
      /\bquant-researcher\b/,
      /\bspecialist chain\b/i,
    ],
  },
  {
    intent: "bead",
    patterns: [
      /\bbead\b/i,
      /\bbd (?:create|update|close|show|dep)\b/,
      /\b--parent\b/,
      /\b--claim\b/,
      /\bepic\b/i,
      /\bacceptance criteria\b/i,
      /\b7-section\b/i,
      /\bPROBLEM\b/,
      /\bSUCCESS\b/,
      /\bNON_GOALS\b/,
      /\bVALIDATION\b/,
    ],
  },
  {
    intent: "scope-plan",
    patterns: [
      /\bplanning\b/,
      /\bscope(?: out| this)?\b/i,
      /\barchitect(?:ure)?\b/,
      /\bbreak (?:this )?down\b/i,
      /\bdecompos(?:e|ition)\b/,
      /\broadmap\b/,
      /\bphase structure\b/i,
    ],
  },
  {
    intent: "debug",
    patterns: [
      /\bdebug\b/,
      /\bfix\b/,
      /\bbug\b/i,
      /\bbroken\b/,
      /\bfail(?:s|ed|ing)?\b/,
      /\bcrash(?:es|ing)?\b/,
      /\broot cause\b/i,
      /\btraceback\b/,
      /\bstack trace\b/i,
      /\bregression\b/i,
    ],
  },
];

function detectIntent(draft: string): Intent {
  const text = draft.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.intent;
  }
  return "generic";
}

/* ----------------------------------------------------------- system prompt */

const MERCURY_RULES = [
  "Target environment: Mercury market-data (futures analytics service stack).",
  "1. mmd-api and mmd-mcp-server NEVER compute — they read pre-computed snapshots only; all analytics are produced by the feed services (mmd-snapshot-feed).",
  "2. Always parameterize SQL (params={'symbol': symbol}); never f-string user input into queries.",
  "3. Modern type hints (dict[str, Any], list[Foo]); imports use the new layout (from analytics... import, from api... import).",
  "4. Every analytic family must be wrapped in compute(analytic_family=...); adding one without the wrap is contract drift.",
  "5. Default to no comments; add one only when the WHY is non-obvious.",
  "6. analytics/ is pure calc — no I/O, no datetime.now() at module scope, no DB access.",
  "7. Use bd (beads) for ALL task tracking; create follow-ups with `bd create --parent <id>` so they never get lost.",
  "8. Keep work tightly scoped to what is asked; flag unknowns explicitly rather than inventing requirements.",
].join("\n");

const INTENT_TEMPLATES: Record<Intent, string> = {
  "pane-dispatch":
    "Rewrite this as a crisp, self-contained instruction for a subordinate agent running in one tmux pane of a multiplexed session. The instruction MUST include: (a) the pane's role and explicitly what it is NOT (helper vs orchestrator), (b) the exact first action, (c) observable success criteria, (d) the escalation/notify rule — when to surface back to the orchestrator and how, (e) the communication protocol in priority order: temp files / structured notes > beads updates > direct notify. Make it dependency-aware: state what this pane must wait for and what it produces for other panes.",
  specialist:
    "Rewrite this as a specialist dispatch contract suitable for `sp run` / using-specialists-v3. MUST include: the specialist role needed (executor / reviewer / explorer / debugger / quant-methodologist / quant-researcher), a precise task scope (files and symbols), explicit success criteria, the verification the specialist must run, and the OUTPUT the specialist hands back. Scope it to a single chain step.",
  bead:
    "Rewrite this as a well-formed beads issue description using the 7-section contract, with these exact section headers: ## PROBLEM, ## SUCCESS, ## SCOPE, ## NON_GOALS, ## CONSTRAINTS, ## VALIDATION, ## OUTPUT. Make every section concrete and observable. Include a logging/telemetry note in CONSTRAINTS or VALIDATION where relevant, and at least one smoke/integration check in VALIDATION. No placeholder text. Preserve every concrete detail (bead ids, file paths, symbol names) from the original.",
  "scope-plan":
    "Rewrite this as a structured plan: distinct phases (P0 scaffold → P1 core → P2 integration), the dependencies between them, what can run in parallel, the top risks, and a short blast-radius summary. Keep it scoped; flag unknowns explicitly.",
  debug:
    "Rewrite this as a focused debugging prompt: state the symptom precisely, the reproduction/observation steps already taken, the most likely suspect code paths, and what evidence to gather before changing code. Bias toward read-only investigation first (logs, Tempo traces, profiling) before any fix.",
  generic:
    "Rewrite this prompt to be clearer, more direct, and better structured for a coding agent: explicit goal, constraints, and success criteria up front. Preserve every concrete detail (paths, ids, numbers). Remove vagueness and filler. Do not add requirements not implied by the original.",
};

const OUTPUT_CONTRACT = [
  `Return ONLY the rewritten prompt wrapped in exactly one sentinel block: ${SENTINEL_OPEN} ... ${SENTINEL_CLOSE}.`,
  "No markdown code fences, no commentary, no text before or after the sentinel block.",
  "Preserve EVERY concrete detail from the original: file paths, symbol names, bead ids, commands, numbers, constraints.",
  "Do not invent new requirements or details that are not implied by the original draft.",
].join("\n");

function buildSystemPrompt(intent: Intent, envContext: string): string {
  return [
    `You are ${EXTENSION}, an intent-aware prompt rewriter for the Mercury/xtrm coding environment.`,
    "",
    "Detected intent: " + intent,
    INTENT_TEMPLATES[intent],
    "",
    "Hard style rules the rewritten prompt must respect where applicable:",
    MERCURY_RULES,
    envContext ? "\nActive context (advisory — use only if relevant):\n" + envContext : "",
    "OUTPUT CONTRACT:",
    OUTPUT_CONTRACT,
  ].join("\n");
}

/* -------------------------------------------------------------- context */

async function gatherContext(pi: ExtensionAPI): Promise<string> {
  const lines: string[] = [];
  const branch = await readExec(pi, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch) lines.push("- git branch: " + branch);
  const bead = await readExec(pi, "bd", ["list", "--status=in_progress"]);
  if (bead) {
    const first = bead.split("\n").find((l) => l.trim());
    if (first) lines.push("- active bead: " + first.trim().slice(0, 120));
  }
  return lines.join("\n");
}

async function readExec(
  pi: ExtensionAPI,
  cmd: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const r = await Promise.race([
      pi.exec(cmd, args, { timeout: 4000 }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 4500),
      ),
    ]);
    const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/* ----------------------------------------------------------- model calls */

interface AuthOk {
  apiKey?: string;
  headers?: Record<string, string>;
}

async function callModel(
  model: Model<Api>,
  request: Context,
  auth: AuthOk,
  signal: AbortSignal,
): Promise<AssistantMessage | null> {
  const timeoutCtl = new AbortController();
  const t = setTimeout(() => timeoutCtl.abort(), DEFAULT_TIMEOUT_MS);
  const sig = AbortSignal.any([signal, timeoutCtl.signal]);
  try {
    const res = await Promise.race<AssistantMessage | null>([
      complete(model, request, {
        ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
        ...(auth.headers ? { headers: auth.headers } : {}),
        signal: sig,
        maxTokens: Math.min(model.maxTokens, ENHANCER_MAX_OUTPUT_TOKENS),
      }),
      abortGuard(signal, null),
    ]);
    return res;
  } finally {
    clearTimeout(t);
  }
}

function retryRequest(request: Context): Context {
  const last = request.messages.at(-1);
  const baseText = last && typeof last.content === "string" ? last.content : "";
  const reminder = `\n\nIMPORTANT: reply with exactly one ${SENTINEL_OPEN} block and nothing else (no fences, no commentary).`;
  const reminded: UserMessage = {
    role: "user",
    content: baseText + reminder,
    timestamp: Date.now(),
  };
  return { ...request, messages: [...request.messages.slice(0, -1), reminded] };
}

function abortGuard<T>(signal: AbortSignal, value: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(value);
  return new Promise<T>((resolve) =>
    signal.addEventListener("abort", () => resolve(value), { once: true }),
  );
}

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function parseSentinel(text: string): string | undefined {
  const start = text.indexOf(SENTINEL_OPEN);
  const end = text.lastIndexOf(SENTINEL_CLOSE);
  if (start === -1 || end === -1 || end <= start) return undefined;
  const inner = text.slice(start + SENTINEL_OPEN.length, end).trim();
  return inner || undefined;
}

/* --------------------------------------------------------------- loader */

async function runWithLoader(
  ctx: ExtensionContext,
  message: string,
  task: (signal: AbortSignal) => Promise<string | null>,
): Promise<string | null> {
  let taskError: Error | undefined;
  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, message, { cancellable: true });
    loader.onAbort = () => done(null);
    void task(loader.signal)
      .then((r) => {
        if (!loader.signal.aborted) done(r);
      })
      .catch((err: unknown) => {
        if (loader.signal.aborted) {
          done(null);
          return;
        }
        taskError = err instanceof Error ? err : new Error(`${EXTENSION} failed.`);
        done(null);
      });
    return loader;
  });
  if (taskError) throw taskError;
  return result;
}
