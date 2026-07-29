/**
 * XTRM-owned Pi chrome, themes, and native/external tool rendering.
 * custom-footer remains the sole footer owner.
 */

import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  ExtensionContext,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import {
  CustomEditor,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cleanOutputLines,
  countPrefixedItems,
  createUnifiedLineDiff,
  diffStats,
  formatDuration,
  formatLineLabel,
  formatPayloadSize,
  joinCompactMeta,
  joinMeta,
  lineCount,
  previewLines,
  renderRichDiffPreview,
  TOOL_ROW_MARKER,
  shortenCommand,
  shortenPath,
} from "./format";

// ============================================================================
// Types
// ============================================================================

export type XtrmThemeName = "xtrm-dark" | "xtrm-light";
export type XtrmResolvedThemeName = XtrmThemeName | "xtrm-dark-flattools" | "xtrm-light-flattools";
export type XtrmDensity = "compact" | "comfortable";

export interface XtrmUiPrefs {
  themeName: XtrmThemeName;
  density: XtrmDensity;
  showHeader: boolean;
  forceTheme: boolean;
  toolRowBg: boolean;
}

// ============================================================================
// Defaults
// ============================================================================

export const XTRM_UI_PREFS_ENTRY = "xtrm-ui-prefs";

export const DEFAULT_PREFS: XtrmUiPrefs = {
  themeName: "xtrm-dark",
  density: "compact",
  showHeader: true,
  forceTheme: true,
  toolRowBg: false,
};


// ============================================================================
// Preferences
// ============================================================================

type MaybeCustomEntry = {
  type?: string;
  customType?: string;
  data?: unknown;
};

function normalizePrefs(input: unknown): XtrmUiPrefs {
  if (!input || typeof input !== "object") return { ...DEFAULT_PREFS };
  const source = input as Partial<XtrmUiPrefs> & { themeName?: unknown };
  const themeName = source.themeName;
  const lightTheme = themeName === "xtrm-light"
    || themeName === "xtrm-light-flattools"
    || themeName === "pidex-light"
    || themeName === "pidex-light-flattools";
  return {
    themeName: lightTheme ? "xtrm-light" : "xtrm-dark",
    density: source.density === "comfortable" ? "comfortable" : "compact",
    showHeader: source.showHeader ?? DEFAULT_PREFS.showHeader,
    forceTheme: source.forceTheme ?? DEFAULT_PREFS.forceTheme,
    toolRowBg: source.toolRowBg ?? DEFAULT_PREFS.toolRowBg,
  };
}

function loadPrefs(entries: ReadonlyArray<MaybeCustomEntry>): XtrmUiPrefs {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "custom" && entry.customType === XTRM_UI_PREFS_ENTRY) {
      return normalizePrefs(entry.data);
    }
  }
  return { ...DEFAULT_PREFS };
}

function persistPrefs(pi: ExtensionAPI, prefs: XtrmUiPrefs): void {
  pi.appendEntry(XTRM_UI_PREFS_ENTRY, prefs);
}


// ============================================================================
// Thinking Chrome
// ============================================================================

type AssistantMessageComponentCtor = {
  prototype: {
    updateContent?: (message: AssistantMessageLike) => void;
    setExpanded?: (expanded: boolean) => void;
  };
};

type AssistantContentBlock = { type?: string; thinking?: string };
type AssistantMessageLike = { content?: AssistantContentBlock[] };
type PatchableAssistantMessage = {
  hideThinkingBlock?: boolean;
  hiddenThinkingLabel?: string;
  lastMessage?: AssistantMessageLike;
  __xtrmThinkingExpanded?: boolean;
  updateContent?: (message: AssistantMessageLike) => void;
};

const PATCHED_ASSISTANT_MESSAGE = "__xtrmUiSilentHiddenThinking";

function maybeFileUrlToPath(value: string): string {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}

function resolvePiCodingAgentEntryPath(): string {
  const candidates: string[] = [];

  const argvPath = process.argv[1];
  if (argvPath && existsSync(argvPath)) {
    const realArgvPath = realpathSync(argvPath);
    if (realArgvPath.endsWith("/dist/cli.js")) {
      candidates.push(join(dirname(realArgvPath), "index.js"));
    }
  }

  candidates.push(
    join(dirname(process.execPath), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"),
  );

  try {
    candidates.push(maybeFileUrlToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  } catch {}

  const entryPath = candidates.find((candidate) => existsSync(candidate));
  if (!entryPath) throw new Error("Could not resolve pi-coding-agent entry path");
  return entryPath;
}

async function installSilentHiddenThinkingPatch(): Promise<void> {
  const entryPath = resolvePiCodingAgentEntryPath();
  const componentPath = join(dirname(entryPath), "modes", "interactive", "components", "assistant-message.js");
  const mod = await import(pathToFileURL(componentPath).href) as {
    AssistantMessageComponent?: AssistantMessageComponentCtor;
  };
  const proto = mod.AssistantMessageComponent?.prototype as
    | (AssistantMessageComponentCtor["prototype"] & { [PATCHED_ASSISTANT_MESSAGE]?: boolean })
    | undefined;
  if (!proto?.updateContent || proto[PATCHED_ASSISTANT_MESSAGE]) return;

  const updateContent = proto.updateContent;
  proto.updateContent = function patchedUpdateContent(this: PatchableAssistantMessage, message: AssistantMessageLike) {
    if (this.hiddenThinkingLabel === "" && Array.isArray(message.content)) {
      if (!this.__xtrmThinkingExpanded) {
        updateContent.call(this, {
          ...message,
          content: message.content.filter((block) => block.type !== "thinking" || !block.thinking?.trim()),
        });
        return;
      }

      const previousHideThinking = this.hideThinkingBlock;
      this.hideThinkingBlock = false;
      updateContent.call(this, message);
      this.hideThinkingBlock = previousHideThinking;
      return;
    }
    updateContent.call(this, message);
  };

  proto.setExpanded = function setExpanded(this: PatchableAssistantMessage, expanded: boolean) {
    this.__xtrmThinkingExpanded = expanded;
    if (this.lastMessage) this.updateContent?.(this.lastMessage);
  };
  proto[PATCHED_ASSISTANT_MESSAGE] = true;
}

type ToolExecutionComponentCtor = {
  prototype: {
    getRenderShell?: () => "default" | "self";
    hasRendererDefinition?: () => boolean;
    render?: (width: number) => string[];
  };
};

type PatchableToolExecutionComponent = {
  toolName?: string;
  args?: unknown;
  result?: { content?: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean };
  expanded?: boolean;
  hasRendererDefinition?: () => boolean;
  __xtrmExternalStartedAt?: number;
  __xtrmExternalDurationMs?: number;
};

type ExternalToolFrameKind = "serena" | "gitnexus" | "structured" | "process" | "external";

const PATCHED_EXTERNAL_TOOL_FRAME = "__xtrmUiExternalToolFrame";
const EXTERNAL_TOOL_FRAME_PATCH_VERSION = 18;
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function isBlankRenderedLine(line: string): boolean {
  return stripAnsi(line).trim().length === 0;
}

function externalToolFrameKind(toolName: string | undefined): ExternalToolFrameKind | undefined {
  if (!toolName || XTRM_BUILTIN_TOOLS.has(toolName)) return undefined;
  if (toolName === "structured_return") return "structured";
  if (toolName === "process") return "process";
  if (toolName.startsWith("gitnexus_")) return "gitnexus";
  if (SERENA_COMPACT_TOOLS.has(toolName)) return "serena";
  return "external";
}

function getToolArgs(component: PatchableToolExecutionComponent): Record<string, unknown> {
  return component.args && typeof component.args === "object" && !Array.isArray(component.args)
    ? component.args as Record<string, unknown>
    : {};
}

function summarizeExternalToolPending(toolName: string | undefined, input: Record<string, unknown>): string {
  const name = toolName ?? "tool";
  if (name === "structured_return") {
    return `${TOOL_ROW_MARKER} structured_return ${shortenCommand(String(input.command ?? "running"), 38)}`;
  }
  if (name === "process") {
    return `${TOOL_ROW_MARKER} process ${String(input.action ?? "running")}`;
  }
  if (name.startsWith("gitnexus_")) {
    const subject = summarizeSerenaSubject(name, input) ?? summarizeToolSubject(name, input);
    return `${TOOL_ROW_MARKER} ${normalizeToolLabel(name)}${subject ? ` ${subject}` : ""}`;
  }
  if (SERENA_COMPACT_TOOLS.has(name)) {
    const subject = summarizeSerenaSubject(name, input);
    return `${TOOL_ROW_MARKER} serena ${name}${subject ? ` ${subject}` : ""}`;
  }
  const subject = summarizeToolSubject(name, input) ?? summarizeSerenaSubject(name, input);
  return `${TOOL_ROW_MARKER} ${normalizeToolLabel(name)}${subject ? ` ${subject}` : ""}`;
}

function extractResultTextLines(component: PatchableToolExecutionComponent): string[] | undefined {
  const text = component.result?.content?.find((content) => content.type === "text")?.text;
  return text
    ? text.split("\n")
    : [summarizeExternalToolPending(component.toolName, getToolArgs(component))];
}

function trimRenderedToolLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankRenderedLine(lines[start] ?? "")) start++;
  while (end > start && isBlankRenderedLine(lines[end - 1] ?? "")) end--;
  return lines.slice(start, end).map((line) => line.replace(/\s+$/u, ""));
}

function externalToolBadgeColor(kind: ExternalToolFrameKind, text: string): string {
  const bgColors: Record<ExternalToolFrameKind, [number, number, number]> = {
    serena: [82, 210, 255],
    gitnexus: [178, 154, 255],
    structured: [205, 166, 255],
    process: [92, 226, 255],
    external: [178, 190, 210],
  };
  const [badgeR, badgeG, badgeB] = bgColors[kind];
  return `\x1b[38;2;3;8;12m\x1b[48;2;${badgeR};${badgeG};${badgeB}m${text}\x1b[39m\x1b[49m`;
}

function boldExternalToolAction(action: string): string {
  return `\x1b[1m${action}\x1b[22m`;
}

export function highlightExternalToolBadge(kind: ExternalToolFrameKind, line: string): string {
  const markedHeader = line.match(/^([•›]\s+)(\[[A-Za-z][A-Za-z0-9 _-]{0,31}\])(\s+)(\S+)(.*)$/u);
  if (markedHeader?.[1] && markedHeader[2] && markedHeader[3] && markedHeader[4]) {
    return `${markedHeader[1]}${externalToolBadgeColor(kind, markedHeader[2])}${markedHeader[3]}${boldExternalToolAction(markedHeader[4])}${markedHeader[5] ?? ""}`;
  }

  const providerHeader = line.match(/^(\[[A-Za-z][A-Za-z0-9 _-]{0,31}\])(\s+)(\S+)(.*)$/u);
  if (providerHeader?.[1] && providerHeader[2] && providerHeader[3]) {
    return `${externalToolBadgeColor(kind, providerHeader[1])}${providerHeader[2]}${boldExternalToolAction(providerHeader[3])}${providerHeader[4] ?? ""}`;
  }

  const marked = line.match(/^([•›]\s+)(\S+)/u);
  if (marked?.[1] && marked[2]) {
    return marked[1] + externalToolBadgeColor(kind, marked[2]) + line.slice(marked[1].length + marked[2].length);
  }

  const provider = line.match(/^(\[[A-Za-z][A-Za-z0-9 _-]{0,31}\])/u)?.[1];
  return provider ? externalToolBadgeColor(kind, provider) + line.slice(provider.length) : line;
}

export function collapsedExternalToolLines(contentLines: string[], expanded: boolean): string[] {
  if (expanded || contentLines.length <= 6) return contentLines;
  return [
    ...contentLines.slice(0, 6),
    `... (${contentLines.length - 6} more lines, ctrl+o to expand)`,
  ];
}

function externalToolProvider(kind: ExternalToolFrameKind, toolName?: string): string {
  if (kind === "serena") return "Serena";
  if (kind === "gitnexus") return "GitNexus";
  if (kind === "structured") return "structured_return";
  if (kind === "process") return "process";

  const separator = toolName?.indexOf("_") ?? -1;
  return separator > 0 ? toolName?.slice(0, separator) ?? "external" : normalizeToolLabel(toolName ?? "external");
}

function externalToolAction(kind: ExternalToolFrameKind, toolName?: string): string | undefined {
  if (!toolName || kind === "structured" || kind === "process") return undefined;
  if (kind === "gitnexus" && toolName.startsWith("gitnexus_")) return toolName.slice("gitnexus_".length);
  if (kind === "serena") return toolName;

  const separator = toolName.indexOf("_");
  return separator > 0 ? toolName.slice(separator + 1).replace(/^_+/u, "") : undefined;
}

function externalToolHeader(
  kind: ExternalToolFrameKind,
  toolName: string | undefined,
  firstLine: string,
): { provider: string; action?: string } {
  const bracketHeader = firstLine.match(/^(?:[•›]\s+)?\[([A-Za-z][A-Za-z0-9 _-]{0,31})\](?:\s+(\S+))?/u);
  const markerHeader = firstLine.match(/^[•›]\s+(\S+)(?:\s+(\S+))?/u);
  return {
    provider: bracketHeader?.[1] ?? externalToolProvider(kind, toolName),
    action: externalToolAction(kind, toolName) ?? bracketHeader?.[2] ?? markerHeader?.[2],
  };
}

export function renderExternalToolBackgroundLines(
  contentLines: string[],
  width: number,
  kind: ExternalToolFrameKind,
  expanded: boolean,
  toolName?: string,
  durationMs?: number,
): string[] {
  let displayLines = contentLines;
  const raw = contentLines.length === 1 ? contentLines[0]?.trim() : undefined;
  if (raw?.startsWith("{") || raw?.startsWith("[")) {
    try {
      displayLines = JSON.stringify(JSON.parse(raw), null, 2).split("\n");
    } catch {
      // Keep non-JSON output unchanged.
    }
  }

  const firstLine = displayLines[0] ?? "";
  const hasHeader = /^(?:[•›]\s+)?\[[A-Za-z][A-Za-z0-9 _-]{0,31}\]/u.test(firstLine)
    || /^[•›]\s+\S+/u.test(firstLine);
  const header = externalToolHeader(kind, toolName, firstLine);
  const payloadLines = hasHeader ? displayLines.slice(1) : displayLines;
  displayLines = [
    `${TOOL_ROW_MARKER} [${header.provider}]${header.action ? ` ${header.action}` : ""}`,
    ...payloadLines,
  ];

  const renderedHeader = displayLines[0] ?? "";
  const visiblePayload = expanded ? payloadLines : payloadLines.slice(0, 6);
  const shown = visiblePayload.length;
  const total = payloadLines.length;
  const lineSummary = !expanded && shown < total
    ? `showing ${shown}/${total} lines (ctrl+o expand)`
    : total > 0 ? formatLineLabel(total, "line") : undefined;
  const footerMeta = joinMeta([
    lineSummary,
    formatDuration(durationMs),
    formatPayloadSize(contentLines.join("\n")),
  ]);
  const renderWidth = Math.max(8, width);
  const body = [
    highlightExternalToolBadge(kind, truncateToWidth(renderedHeader, renderWidth)),
    ...visiblePayload.map((rawLine) => truncateToWidth(rawLine, renderWidth)),
  ];
  return footerMeta
    ? [...body, `\x1b[2m${truncateToWidth(`└─ ${footerMeta}`, renderWidth)}\x1b[22m`]
    : body;
}

function renderExternalToolLines(
  lines: string[],
  width: number,
  kind: ExternalToolFrameKind,
  expanded = false,
  toolName?: string,
  durationMs?: number,
): string[] {
  const contentLines = trimRenderedToolLines(lines).filter((line) => !isBlankRenderedLine(line));
  return contentLines.length > 0
    ? renderExternalToolBackgroundLines(contentLines, width, kind, expanded, toolName, durationMs)
    : [];
}

async function installExternalToolFramePatch(): Promise<void> {
  const entryPath = resolvePiCodingAgentEntryPath();
  const componentPath = join(dirname(entryPath), "modes", "interactive", "components", "tool-execution.js");
  const mod = await import(pathToFileURL(componentPath).href) as {
    ToolExecutionComponent?: ToolExecutionComponentCtor;
  };
  const proto = mod.ToolExecutionComponent?.prototype as
    | (ToolExecutionComponentCtor["prototype"] & { [PATCHED_EXTERNAL_TOOL_FRAME]?: number })
    | undefined;
  if (!proto?.render || proto[PATCHED_EXTERNAL_TOOL_FRAME] === EXTERNAL_TOOL_FRAME_PATCH_VERSION) return;

  const getRenderShell = proto.getRenderShell;
  const render = proto.render;

  proto.getRenderShell = function patchedGetRenderShell(this: PatchableToolExecutionComponent) {
    const kind = externalToolFrameKind(this.toolName);
    if (kind) return "self";
    return getRenderShell?.call(this) ?? "default";
  };

  proto.render = function patchedRender(this: PatchableToolExecutionComponent, width: number) {
    const kind = externalToolFrameKind(this.toolName);
    if (kind) this.__xtrmExternalStartedAt ??= Date.now();
    const rendered = render.call(this, width);
    if (!kind || rendered.length === 0) return rendered;

    if (this.result && this.__xtrmExternalDurationMs == null) {
      this.__xtrmExternalDurationMs = Date.now() - (this.__xtrmExternalStartedAt ?? Date.now());
    }
    const firstContentIndex = rendered.findIndex((line) => !isBlankRenderedLine(line));
    const leading = firstContentIndex > 0 ? rendered.slice(0, firstContentIndex) : [];
    const content = extractResultTextLines(this) ?? rendered;
    const styled = renderExternalToolLines(
      content,
      width,
      kind,
      Boolean(this.expanded),
      this.toolName,
      this.__xtrmExternalDurationMs,
    );
    return styled.length > 0 ? [...leading, ...styled] : rendered;
  };

  proto[PATCHED_EXTERNAL_TOOL_FRAME] = EXTERNAL_TOOL_FRAME_PATCH_VERSION;
}

function applyThinkingChrome(ctx: ExtensionContext): void {
  (ctx.ui as { setHiddenThinkingLabel?: (label?: string) => void }).setHiddenThinkingLabel?.("");
}

// ============================================================================
// Chrome Application
// ============================================================================

function fitVisible(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function resolveThemeForPrefs(prefs: XtrmUiPrefs): XtrmResolvedThemeName {
  if (prefs.toolRowBg) return prefs.themeName;
  return prefs.themeName === "xtrm-light" ? "xtrm-light-flattools" : "xtrm-dark-flattools";
}

function formatThinking(level: string): string {
  return level === "off" ? "standard" : level;
}

function applyXtrmChrome(
  ctx: ExtensionContext,
  prefs: XtrmUiPrefs,
  getThinkingLevel: () => string,
): void {
  if (prefs.forceTheme) {
    ctx.ui.setTheme(resolveThemeForPrefs(prefs));
  }

  ctx.ui.setToolsExpanded(false);
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const editor = new XtrmEditor(tui, theme, keybindings);
    editor.setPrefs(prefs);
    return editor;
  });

  if (!prefs.showHeader) {
    ctx.ui.setHeader(undefined);
    return;
  }

  ctx.ui.setHeader((_tui, theme) => ({
    invalidate() {},
    render(width: number): string[] {
      const boxWidth = width >= 54 ? 50 : Math.max(24, width);
      const model = ctx.model?.id ?? "no-model";
      const thinking = getThinkingLevel();
      const border = (text: string) => theme.fg("borderAccent", text);
      const top = border(`╭${"─".repeat(Math.max(0, boxWidth - 2))}╮`);
      const line1 =
        border("│") +
        fitVisible(
          ` ${theme.fg("dim", ">_")} ${theme.bold("XTRM")} ${theme.fg("dim", "(v1.0.0)")}`,
          boxWidth - 2,
        ) +
        border("│");
      const gap = border("│") + fitVisible("", boxWidth - 2) + border("│");
      const line2 =
        border("│") +
        fitVisible(
          ` ${theme.fg("dim", "model:".padEnd(11))}${model} ${thinking}${theme.fg("accent", "    /model")}${theme.fg("dim", " to change")}`,
          boxWidth - 2,
        ) +
        border("│");
      const line3 =
        border("│") +
        fitVisible(
          ` ${theme.fg("dim", "directory:".padEnd(11))}${basename(ctx.cwd)}`,
          boxWidth - 2,
        ) +
        border("│");
      const bottom = border(`╰${"─".repeat(Math.max(0, boxWidth - 2))}╯`);

      return [top, line1, gap, line2, line3, bottom];
    },
  }));
}


// ============================================================================
// Tool Render Helpers
// ============================================================================

function renderVerticalPreview(theme: any, lines: string[], maxLines: number): string {
  const subset = lines.slice(0, maxLines);
  let text = subset.map((line) => `${theme.fg("muted", "│")} ${theme.fg("toolOutput", line)}`).join("\n");
  if (lines.length > maxLines) text += `\n${theme.fg("muted", "│")} ${theme.fg("muted", `… +${lines.length - maxLines} more lines`)}`;
  return text;
}


function lineRange(offset?: number, limit?: number): string | undefined {
  if (offset == null && limit == null) return undefined;
  const start = offset ?? 1;
  if (limit == null) return `${start}`;
  return `${start}-${start + limit - 1}`;
}

const DEFAULT_TOOL_PREVIEW_LINES = 6;

function summarizeCount(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

function previewSummary(shown: number, total: number, noun: string, expanded: boolean): string {
  return !expanded && shown < total
    ? `showing ${shown}/${total} ${noun}s (ctrl+o expand)`
    : formatLineLabel(total, noun);
}

// ============================================================================
// Editor (task p38n.3)
// ============================================================================

class XtrmEditor extends CustomEditor {
  constructor(...args: ConstructorParameters<typeof CustomEditor>) {
    super(...args);
  }

  setPrefs(prefs: XtrmUiPrefs): void {
    this.setPaddingX(prefs.density === "comfortable" ? 2 : 1);
  }

  render(width: number): string[] {
    return super.render(width);
  }
}

// ============================================================================
// Commands
// ============================================================================

function sendInfoMessage(pi: ExtensionAPI, title: string, content: string): void {
  pi.sendMessage({
    customType: "xtrm-ui-info",
    content,
    display: true,
    details: { title },
  });
}

function parseThemeArg(arg: string): XtrmThemeName | undefined {
  const normalized = arg.trim().toLowerCase();
  if (normalized === "dark") return "xtrm-dark";
  if (normalized === "light") return "xtrm-light";
  return undefined;
}

function parseDensityArg(arg: string): XtrmDensity | undefined {
  const normalized = arg.trim().toLowerCase();
  if (normalized === "compact") return "compact";
  if (normalized === "comfortable" || normalized === "normal") return "comfortable";
  return undefined;
}

function parseToggleArg(arg: string): boolean | undefined {
  const normalized = arg.trim().toLowerCase();
  if (normalized === "on") return true;
  if (normalized === "off") return false;
  return undefined;
}

function registerCommands(
  pi: ExtensionAPI,
  getPrefs: () => XtrmUiPrefs,
  setPrefs: (prefs: XtrmUiPrefs) => void,
  getThinkingLevel: () => string,
): void {
  pi.registerMessageRenderer("xtrm-ui-info", (message, _options, theme) => {
    const title = (message.details as { title?: string } | undefined)?.title ?? "XTRM UI";
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(title)), 0, 0));
    box.addChild(new Text(theme.fg("customMessageText", String(message.content ?? "")), 0, 0));
    return box;
  });

  pi.registerCommand("xtrm-ui", {
    description: "Show XTRM UI status and active preferences",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /xtrm-ui", "warning");
        return;
      }

      const prefs = getPrefs();
      const contextUsage = ctx.getContextUsage();
      sendInfoMessage(pi, "XTRM UI status", [
        `Theme: ${prefs.themeName}`,
        `Density: ${prefs.density}`,
        `Show header: ${prefs.showHeader ? "yes" : "no"}`,
        `Force theme: ${prefs.forceTheme ? "on" : "off"}`,
        `Tool row background: ${prefs.toolRowBg ? "on" : "off"}`,
        `Model: ${ctx.model?.id ?? "none"}`,
        `Context: ${contextUsage?.tokens ?? "unknown"}/${contextUsage?.contextWindow ?? "unknown"}`,
      ].join("\n"));
    },
  });

  pi.registerCommand("xtrm-ui-theme", {
    description: "Switch XTRM UI theme: dark|light",
    getArgumentCompletions: (prefix) => {
      const values = ["dark", "light"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const themeName = parseThemeArg(args);
      if (!themeName) {
        ctx.ui.notify("Usage: /xtrm-ui-theme dark|light", "warning");
        return;
      }
      const prefs = { ...getPrefs(), themeName };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify(`XTRM UI theme set to ${themeName}`, "info");
    },
  });

  pi.registerCommand("xtrm-ui-density", {
    description: "Switch editor density: compact|comfortable",
    getArgumentCompletions: (prefix) => {
      const values = ["compact", "comfortable"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const density = parseDensityArg(args);
      if (!density) {
        ctx.ui.notify("Usage: /xtrm-ui-density compact|comfortable", "warning");
        return;
      }
      const prefs = { ...getPrefs(), density };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify(`XTRM UI density set to ${density}`, "info");
    },
  });

  pi.registerCommand("xtrm-ui-header", {
    description: "Toggle XTRM UI header: on|off",
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const showHeader = parseToggleArg(args);
      if (showHeader === undefined) {
        ctx.ui.notify("Usage: /xtrm-ui-header on|off", "warning");
        return;
      }
      const prefs = { ...getPrefs(), showHeader };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify(`XTRM UI header ${showHeader ? "enabled" : "disabled"}`, "info");
    },
  });

  pi.registerCommand("xtrm-ui-forcetheme", {
    description: "Control whether xtrm-ui overrides the active theme: on|off",
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const forceTheme = parseToggleArg(args);
      if (forceTheme === undefined) {
        ctx.ui.notify("Usage: /xtrm-ui-forcetheme on|off", "warning");
        return;
      }
      const prefs = { ...getPrefs(), forceTheme };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify(`XTRM UI force theme ${forceTheme ? "enabled" : "disabled"}`, "info");
    },
  });

  pi.registerCommand("xtrm-ui-rowbg", {
    description: "Toggle subtle tool-row background: on|off",
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const toolRowBg = parseToggleArg(args);
      if (toolRowBg === undefined) {
        ctx.ui.notify("Usage: /xtrm-ui-rowbg on|off", "warning");
        return;
      }
      const prefs = { ...getPrefs(), toolRowBg };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify(`Tool row background ${toolRowBg ? "enabled" : "disabled"}.`, "info");
    },
  });

  pi.registerCommand("xtrm-ui-reset", {
    description: "Restore XTRM UI defaults",
    handler: async (_args, ctx) => {
      const prefs = { ...DEFAULT_PREFS };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify("XTRM UI reset to defaults", "info");
    },
  });
}

// ============================================================================
// XTRM Tool Renderers
// ============================================================================

type BuiltInTools = ReturnType<typeof createBuiltInTools>;

type XtrmWritePreview =
  | { kind: "created"; lineCount: number }
  | { kind: "updated"; diff: string; additions: number; removals: number }
  | { kind: "unchanged" };

type XtrmToolRenderState = {
  startedAt?: number;
  writePreview?: XtrmWritePreview;
};

type XtrmToolRenderContext = {
  executionStarted: boolean;
  isPartial: boolean;
  state: XtrmToolRenderState;
};

const toolCache = new Map<string, BuiltInTools>();

function createBuiltInTools(cwd: string) {
  return {
    bash: createBashTool(cwd),
    read: createReadTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
  };
}

function getTools(cwd: string): BuiltInTools {
  let tools = toolCache.get(cwd);
  if (!tools) {
    tools = createBuiltInTools(cwd);
    toolCache.set(cwd, tools);
  }
  return tools;
}

function getTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content.find((content) => content.type === "text");
  return item?.text ?? "";
}

function createWritePreview(path: string, nextContent: string): XtrmWritePreview {
  if (!path || !existsSync(path)) {
    return { kind: "created", lineCount: lineCount(nextContent) };
  }

  let currentContent = "";
  try {
    currentContent = readFileSync(path, "utf8");
  } catch {
    return { kind: "created", lineCount: lineCount(nextContent) };
  }

  if (currentContent === nextContent) return { kind: "unchanged" };

  const diff = createUnifiedLineDiff(currentContent, nextContent);
  const stats = diffStats(diff);
  return {
    kind: "updated",
    diff,
    additions: stats.additions,
    removals: stats.removals,
  };
}

function appendToolTree(
  theme: any,
  lines: string[],
  outputLines: string[],
  meta?: string,
): string {
  outputLines.forEach((line, index) => {
    lines.push(index === 0
      ? `  ${theme.fg("muted", "└")} ${theme.fg("toolOutput", line)}`
      : `    ${theme.fg("toolOutput", line)}`);
  });
  if (meta) lines.push(`${outputLines.length > 0 ? "    " : `  ${theme.fg("muted", "└")} `}${theme.fg("dim", meta)}`);
  return lines.join("\n");
}

function renderBashTree(
  theme: any,
  statusColor: string,
  command: string,
  outputLines: string[] = [],
  meta?: string,
): string {
  const [firstCommand = "", ...continuedCommands] = command.split("\n");
  return appendToolTree(theme, [
    `${theme.fg(statusColor, "•")} ${theme.fg(statusColor, theme.bold("Ran"))} ${theme.fg(statusColor, firstCommand)}`,
    ...continuedCommands.map((line) => `  ${theme.fg("muted", "│")} ${theme.fg(statusColor, line)}`),
  ], outputLines, meta);
}

function renderNamedToolTree(
  theme: any,
  statusColor: string,
  label: string,
  subject: string,
  outputLines: string[] = [],
  meta?: string,
): string {
  return appendToolTree(theme, [
    `${theme.fg(statusColor, "•")} ${theme.fg(statusColor, theme.bold(label))}${subject ? ` ${theme.fg(statusColor, subject)}` : ""}`,
  ], outputLines, meta);
}

function renderPendingCall(toolName: string, args: Record<string, unknown>, theme: any): Text {
  if (toolName === "bash") {
    return new Text(renderBashTree(theme, "accent", String(args.command ?? "")), 0, 0);
  }
  return new Text(renderNamedToolTree(theme, "accent", toolName, summarizeToolSubject(toolName, args) ?? ""), 0, 0);
}

function summarizeToolSubject(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case "bash": return shortenCommand(String(args.command ?? ""), 52);
    case "read": {
      const path = shortenPath(String(args.path ?? ""), 42);
      const range = lineRange(args.offset as number | undefined, args.limit as number | undefined);
      return range ? `${path}:${range}` : path;
    }
    case "edit":
    case "write": return shortenPath(String(args.path ?? ""), 42);
    case "find":
    case "grep": return String(args.pattern ?? "");
    case "ls": return shortenPath(String(args.path ?? "."), 42);
    default: return undefined;
  }
}

const SERENA_COMPACT_TOOLS = new Set([
  "find_symbol",
  "find_referencing_symbols",
  "insert_after_symbol",
  "replace_symbol_body",
  "read_file",
  "get_symbols_overview",
  "insert_before_symbol",
  "rename_symbol",
  "restart_language_server",
  "jet_brains_get_symbols_overview",
  "jet_brains_find_symbol",
  "jet_brains_find_referencing_symbols",
  "jet_brains_type_hierarchy",
  "search_for_pattern",
  "list_dir",
  "find_file",
  "create_text_file",
  "replace_content",
  "delete_lines",
  "replace_lines",
  "insert_at_line",
  "execute_shell_command",
  "get_current_config",
  "activate_project",
  "remove_project",
  "switch_modes",
  "open_dashboard",
  "check_onboarding_performed",
  "onboarding",
  "initial_instructions",
  "prepare_for_new_conversation",
  "summarize_changes",
  "think_about_collected_information",
  "think_about_task_adherence",
  "think_about_whether_you_are_done",
  "read_memory",
  "write_memory",
  "list_memories",
  "delete_memory",
  "rename_memory",
  "edit_memory",
  "serena_mcp_reset",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function summarizeSerenaSubject(toolName: string, input: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case "find_symbol":
    case "find_referencing_symbols":
    case "replace_symbol_body":
    case "insert_after_symbol":
    case "insert_before_symbol":
    case "rename_symbol":
    case "jet_brains_find_symbol":
    case "jet_brains_find_referencing_symbols":
    case "jet_brains_type_hierarchy":
      return String(input.name_path_pattern ?? input.name_path ?? "symbol");
    case "get_symbols_overview":
    case "jet_brains_get_symbols_overview":
    case "read_file":
    case "create_text_file":
    case "replace_content":
    case "replace_lines":
    case "delete_lines":
    case "insert_at_line":
    case "list_dir":
    case "find_file":
      return shortenPath(String(input.relative_path ?? input.path ?? "."), 42);
    case "search_for_pattern":
      return shortenCommand(String(input.substring_pattern ?? ""), 52);
    case "read_memory":
    case "write_memory":
    case "delete_memory":
    case "rename_memory":
    case "edit_memory":
      return String(input.memory_name ?? input.old_name ?? "memory");
    case "activate_project":
    case "remove_project":
      return String(input.project ?? input.project_name ?? "project");
    case "switch_modes": {
      const modes = input.modes;
      if (Array.isArray(modes)) return modes.map((mode) => String(mode)).join(",");
      return "modes";
    }
    case "execute_shell_command":
      return shortenCommand(String(input.command ?? ""), 52);
    default:
      return undefined;
  }
}



function normalizeToolLabel(toolName: string): string {
  const gitnexusMap: Record<string, string> = {
    gitnexus_query: "gitnexus query",
    gitnexus_context: "gitnexus context",
    gitnexus_impact: "gitnexus impact",
    gitnexus_detect_changes: "gitnexus detect_changes",
    gitnexus_list_repos: "gitnexus list_repos",
    gitnexus_rename: "gitnexus rename",
    gitnexus_cypher: "gitnexus cypher",
  };

  if (gitnexusMap[toolName]) return gitnexusMap[toolName];

  if (toolName.startsWith("gitnexus_")) {
    return `gitnexus ${toolName.slice("gitnexus_".length)}`;
  }

  const idx = toolName.indexOf("_");
  if (idx > 0) {
    const head = toolName.slice(0, idx);
    const tail = toolName.slice(idx + 1);
    if (head && tail) return `${head} ${tail}`;
  }

  return toolName;
}



const XTRM_BUILTIN_TOOLS = new Set(["bash", "read", "edit", "write", "find", "grep", "ls"]);


function registerXtrmUiTools(pi: ExtensionAPI, getPrefs: () => XtrmUiPrefs): void {
  const tools = getTools(process.cwd());
  const toolRowText = (theme: any, text: string) =>
    new Text(
      text,
      0,
      0,
      getPrefs().toolRowBg ? (line: string) => theme.bg("selectedBg", line) : undefined,
    );
  const renderCall = (
    toolName: string,
    args: Record<string, unknown>,
    theme: any,
    context: XtrmToolRenderContext,
  ) => {
    context.state.startedAt ??= Date.now();
    return context.isPartial && !context.executionStarted
      ? renderPendingCall(toolName, args, theme)
      : toolRowText(theme, "");
  };
  const renderDuration = (context: XtrmToolRenderContext) =>
    formatDuration(context.state.startedAt == null ? undefined : Date.now() - context.state.startedAt);

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: tools.bash.description,
    parameters: tools.bash.parameters,
    execute: tools.bash.execute,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      renderCall("bash", args as Record<string, unknown>, theme, context),
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = (result.details ?? {}) as BashToolDetails;
      const args = context.args as Record<string, unknown>;
      const command = String(args.command ?? "");
      if (isPartial) {
        return toolRowText(theme, renderBashTree(theme, "accent", command));
      }
      const output = getTextContent(result as any);
      const outputLines = cleanOutputLines(output);
      const statusColor = context.isError ? "error" : "success";
      const visibleLines = expanded ? outputLines : outputLines.slice(-DEFAULT_TOOL_PREVIEW_LINES);
      const lineSummary = previewSummary(visibleLines.length, outputLines.length, "line", expanded);
      const text = renderBashTree(theme, statusColor, command, visibleLines, joinMeta([
        lineSummary,
        renderDuration(context),
        formatPayloadSize(output),
        details.truncation?.truncated ? "truncated" : undefined,
      ]));
      return toolRowText(theme, text);
    },
  });

  pi.registerTool({
    name: "read",
    label: "read",
    description: tools.read.description,
    parameters: tools.read.parameters,
    execute: tools.read.execute,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      renderCall("read", args as Record<string, unknown>, theme, context),
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return toolRowText(theme, renderNamedToolTree(theme, "accent", "read", "loading"));
      const details = (result.details ?? {}) as ReadToolDetails;
      const args = context.args as Record<string, unknown>;
      const subjectBase = shortenPath(String(args.path ?? ""));
      const range = lineRange(args.offset as number | undefined, args.limit as number | undefined);
      const subject = range ? `${subjectBase}:${range}` : subjectBase;
      const first = result.content[0];
      if (first?.type === "image") {
        return toolRowText(theme, renderNamedToolTree(
          theme,
          "success",
          "read",
          subject,
          [],
          joinMeta(["image", renderDuration(context)]),
        ));
      }
      const textContent = getTextContent(result as any);
      const lines = textContent.split("\n");
      const totalLines = lines.length;
      const visibleLines = expanded ? lines : lines.slice(0, DEFAULT_TOOL_PREVIEW_LINES);
      const lineSummary = previewSummary(visibleLines.length, totalLines, "line", expanded);
      const text = renderNamedToolTree(
        theme,
        context.isError ? "error" : "success",
        "read",
        subject,
        totalLines > 0 ? visibleLines : [],
        joinMeta([
          lineSummary,
          renderDuration(context),
          formatPayloadSize(textContent),
          details.truncation?.truncated ? `from ${details.truncation.totalLines}` : undefined,
        ]),
      );
      return toolRowText(theme, text);
    },
  });

  pi.registerTool({
    name: "edit",
    label: "edit",
    description: tools.edit.description,
    parameters: tools.edit.parameters,
    execute: tools.edit.execute,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      renderCall("edit", args as Record<string, unknown>, theme, context),
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return toolRowText(theme, renderNamedToolTree(theme, "accent", "edit", "applying"));
      const details = (result.details ?? {}) as EditToolDetails;
      const args = context.args as Record<string, unknown>;
      const path = String(args.path ?? "");
      const textContent = getTextContent(result as any);
      if (context.isError) {
        return toolRowText(theme, renderNamedToolTree(
          theme,
          "error",
          "edit",
          path,
          [],
          joinMeta([textContent.split("\n")[0], renderDuration(context)]),
        ));
      }
      const stats = details.diff ? diffStats(details.diff) : { additions: 0, removals: 0 };
      const text = renderNamedToolTree(
        theme,
        "success",
        "edit",
        path,
        details.diff ? renderRichDiffPreview(theme, details.diff, 18).split("\n") : [],
        joinMeta([`+${stats.additions}`, `-${stats.removals}`, renderDuration(context)]),
      );
      return toolRowText(theme, text);
    },
  });

  pi.registerTool({
    name: "write",
    label: "write",
    description: tools.write.description,
    parameters: tools.write.parameters,
    execute: tools.write.execute,
    renderShell: "self",
    renderCall(args, theme, context) {
      const input = args as Record<string, unknown>;
      const state = context.state as XtrmToolRenderState;
      if (context.argsComplete && !state.writePreview) {
        state.writePreview = createWritePreview(String(input.path ?? ""), String(input.content ?? ""));
      }
      return renderCall("write", input, theme, context);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return toolRowText(theme, renderNamedToolTree(theme, "accent", "write", "writing"));
      const args = context.args as Record<string, unknown>;
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const textContent = getTextContent(result as any);
      if (context.isError) {
        return toolRowText(theme, renderNamedToolTree(
          theme,
          "error",
          "write",
          path,
          [],
          joinMeta([textContent.split("\n")[0], renderDuration(context)]),
        ));
      }

      const preview = (context.state as XtrmToolRenderState).writePreview;
      if (preview?.kind === "unchanged") {
        return toolRowText(theme, renderNamedToolTree(
          theme,
          "success",
          "write",
          path,
          [],
          joinMeta(["no changes", renderDuration(context)]),
        ));
      }
      if (preview?.kind === "updated") {
        return toolRowText(theme, renderNamedToolTree(
          theme,
          "success",
          "write",
          path,
          preview.diff ? renderRichDiffPreview(theme, preview.diff, 18).split("\n") : [],
          joinMeta([`+${preview.additions}`, `-${preview.removals}`, renderDuration(context)]),
        ));
      }

      const lines = preview?.kind === "created" ? preview.lineCount : lineCount(content);
      const contentLines = content.split("\n");
      const visibleLines = !content ? [] : expanded ? contentLines : contentLines.slice(0, DEFAULT_TOOL_PREVIEW_LINES);
      const text = renderNamedToolTree(
        theme,
        "success",
        "write",
        path,
        visibleLines,
        joinMeta([
          previewSummary(visibleLines.length, lines, "line", expanded),
          renderDuration(context),
          formatPayloadSize(content),
        ]),
      );
      return toolRowText(theme, text);
    },
  });

  pi.registerTool({
    name: "find",
    label: "find",
    description: tools.find.description,
    parameters: tools.find.parameters,
    execute: tools.find.execute,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      renderCall("find", args as Record<string, unknown>, theme, context),
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return toolRowText(theme, renderNamedToolTree(theme, "accent", "find", "searching"));
      const details = (result.details ?? {}) as FindToolDetails;
      const args = context.args as Record<string, unknown>;
      const textContent = getTextContent(result as any);
      const count = summarizeCount(textContent);
      const outputLines = count > 0 ? previewLines(textContent, expanded ? 10 : DEFAULT_TOOL_PREVIEW_LINES) : [];
      const text = renderNamedToolTree(
        theme,
        context.isError ? "error" : "success",
        "find",
        String(args.pattern ?? ""),
        outputLines,
        joinMeta([
          previewSummary(Math.min(outputLines.length, count), count, "match", expanded),
          renderDuration(context),
          formatPayloadSize(textContent),
          details.resultLimitReached ? "limit reached" : undefined,
        ]),
      );
      return toolRowText(theme, text);
    },
  });

  pi.registerTool({
    name: "grep",
    label: "grep",
    description: tools.grep.description,
    parameters: tools.grep.parameters,
    execute: tools.grep.execute,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      renderCall("grep", args as Record<string, unknown>, theme, context),
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return toolRowText(theme, renderNamedToolTree(theme, "accent", "grep", "searching"));
      const details = (result.details ?? {}) as GrepToolDetails;
      const args = context.args as Record<string, unknown>;
      const textContent = getTextContent(result as any);
      const count = countPrefixedItems(textContent, ["-- "]) || summarizeCount(textContent);
      const outputLines = textContent.length > 0 ? previewLines(textContent, expanded ? 12 : DEFAULT_TOOL_PREVIEW_LINES) : [];
      const text = renderNamedToolTree(
        theme,
        context.isError ? "error" : "success",
        "grep",
        String(args.pattern ?? ""),
        outputLines,
        joinMeta([
          previewSummary(Math.min(outputLines.length, count), count, "match", expanded),
          renderDuration(context),
          formatPayloadSize(textContent),
          details.matchLimitReached ? "limit reached" : undefined,
        ]),
      );
      return toolRowText(theme, text);
    },
  });

  pi.registerTool({
    name: "ls",
    label: "ls",
    description: tools.ls.description,
    parameters: tools.ls.parameters,
    execute: tools.ls.execute,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      renderCall("ls", args as Record<string, unknown>, theme, context),
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return toolRowText(theme, renderNamedToolTree(theme, "accent", "ls", "listing"));
      const details = (result.details ?? {}) as LsToolDetails;
      const args = context.args as Record<string, unknown>;
      const textContent = getTextContent(result as any);
      const count = summarizeCount(textContent);
      const outputLines = count > 0 ? previewLines(textContent, expanded ? 12 : DEFAULT_TOOL_PREVIEW_LINES) : [];
      const text = renderNamedToolTree(
        theme,
        context.isError ? "error" : "success",
        "ls",
        shortenPath(String(args.path ?? ".")),
        outputLines,
        joinMeta([
          previewSummary(Math.min(outputLines.length, count), count, "entry", expanded),
          renderDuration(context),
          formatPayloadSize(textContent),
          details.entryLimitReached ? "limit reached" : undefined,
        ]),
      );
      return toolRowText(theme, text);
    },
  });
}

// ============================================================================
// Main Extension
// ============================================================================

export default function xtrmUiExtension(pi: ExtensionAPI): void {
  void installSilentHiddenThinkingPatch().catch(() => undefined);
  void installExternalToolFramePatch().catch(() => undefined);

  let prefs: XtrmUiPrefs = { ...DEFAULT_PREFS };
  const getPrefs = () => prefs;
  const setPrefs = (nextPrefs: XtrmUiPrefs) => {
    prefs = nextPrefs;
  };
  const getThinkingLevel = () => formatThinking(pi.getThinkingLevel());

  registerXtrmUiTools(pi, getPrefs);
  registerCommands(pi, getPrefs, setPrefs, getThinkingLevel);

  const refresh = (ctx: ExtensionContext) => {
    applyXtrmChrome(ctx, prefs, getThinkingLevel);
    applyThinkingChrome(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    setPrefs(loadPrefs(ctx.sessionManager.getEntries() as Array<MaybeCustomEntry>));
    refresh(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    refresh(ctx);
  });

  pi.on("session_fork", async (_event, ctx) => {
    refresh(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    refresh(ctx);
  });

  pi.on("session_shutdown", async () => {
    // No-op: no theme restoration on shutdown
  });

  pi.on("input", async (event) => {
    if (event.source === "extension") return { action: "continue" as const };
    if (!event.text.trim()) return { action: "continue" as const };
    if (event.text.startsWith("/") || event.text.startsWith("!")) return { action: "continue" as const };
    if (event.text.startsWith("› ")) return { action: "continue" as const };
    return event.images
      ? { action: "transform" as const, text: `› ${event.text}`, images: event.images }
      : { action: "transform" as const, text: `› ${event.text}` };
  });

  pi.on("context", async (event) => {
    const messages = event.messages.map((message) => {
      if (message.role === "user" && typeof message.content === "string" && message.content.startsWith("› ")) {
        return { ...message, content: message.content.slice(2) };
      }
      if (message.role === "user" && Array.isArray(message.content)) {
        return {
          ...message,
          content: message.content.map((item, index) =>
            index === 0 && item.type === "text" && item.text.startsWith("› ")
              ? { ...item, text: item.text.slice(2) }
              : item
          ),
        };
      }
      return message;
    });
    return { messages };
  });
}
