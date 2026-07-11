/**
 * XTRM UI Extension
 *
 * Wraps pi-dex functionality with XTRM-specific preferences:
 * - Uses pi-dex themes and header
 * - Disables pi-dex footer (let custom-footer handle it)
 * - Provides /xtrm-ui commands for theme/density switching
 *
 * This eliminates the race condition between pi-dex's footer and
 * XTRM's custom-footer extension.
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
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
  renderToolSummary,
  TOOL_ROW_MARKER,
  shortenCommand,
  shortenPath,
} from "./format";

// ============================================================================
// Types
// ============================================================================

export type XtrmThemeName = "pidex-dark" | "pidex-light" | "pidex-dark-flattools" | "pidex-light-flattools";
export type XtrmDensity = "compact" | "comfortable";
export type XtrmExternalToolChrome = "background" | "box";

export interface XtrmUiPrefs {
  themeName: XtrmThemeName;
  density: XtrmDensity;
  showHeader: boolean;
  compactTools: boolean;
  showFooter: boolean; // Our key addition - when false, skip setFooter()
  forceTheme: boolean; // When false, skip setTheme (allow external theme override)
  toolRowBg: boolean; // Subtle background behind tool text rows (no padding)
  compactExternalToolResults: boolean; // Compact extension tool results (disables full expand output)
  externalToolChrome: XtrmExternalToolChrome; // Visual treatment for non-native tool rows
  hideThinkingPlaceholder: boolean; // When false, hidden thinking blocks render no placeholder text
}

// ============================================================================
// Defaults
// ============================================================================

export const XTRM_UI_PREFS_ENTRY = "xtrm-ui-prefs";

export const DEFAULT_PREFS: XtrmUiPrefs = {
  themeName: "pidex-dark",
  density: "compact",
  showHeader: true,
  compactTools: true,
  showFooter: false, // XTRM: disable pi-dex footer, use custom-footer
  forceTheme: true,
  toolRowBg: false,
  compactExternalToolResults: true,
  externalToolChrome: "background",
  hideThinkingPlaceholder: false,
};

let activeExternalToolChrome: XtrmExternalToolChrome = DEFAULT_PREFS.externalToolChrome;

function setActiveExternalToolChrome(chrome: XtrmExternalToolChrome): void {
  activeExternalToolChrome = chrome;
}


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
  const source = input as Partial<XtrmUiPrefs>;
  return {
    themeName: source.themeName === "pidex-light" || source.themeName === "pidex-light-flattools" ? "pidex-light" : "pidex-dark",
    density: source.density === "comfortable" ? "comfortable" : "compact",
    showHeader: source.showHeader ?? DEFAULT_PREFS.showHeader,
    compactTools: source.compactTools ?? DEFAULT_PREFS.compactTools,
    showFooter: source.showFooter ?? DEFAULT_PREFS.showFooter,
    forceTheme: source.forceTheme ?? DEFAULT_PREFS.forceTheme,
    toolRowBg: source.toolRowBg ?? DEFAULT_PREFS.toolRowBg,
    compactExternalToolResults:
      source.compactExternalToolResults ?? DEFAULT_PREFS.compactExternalToolResults,
    externalToolChrome: source.externalToolChrome === "box" ? "box" : "background",
    hideThinkingPlaceholder: source.hideThinkingPlaceholder ?? DEFAULT_PREFS.hideThinkingPlaceholder,
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
const EXTERNAL_TOOL_FRAME_PATCH_VERSION = 17;
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

function padVisible(text: string, width: number): string {
  const visible = visibleWidth(text);
  return text + " ".repeat(Math.max(0, width - visible));
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

export function highlightExternalToolBadge(kind: ExternalToolFrameKind, line: string): string {
  const marked = line.match(/^([•›]\s+)(\S+)/u);
  if (marked?.[1] && marked[2]) {
    return marked[1] + externalToolBadgeColor(kind, marked[2]) + line.slice(marked[1].length + marked[2].length);
  }

  const provider = line.match(/^(\[[A-Za-z][A-Za-z0-9 _-]{0,31}\])/u)?.[1];
  return provider ? externalToolBadgeColor(kind, provider) + line.slice(provider.length) : line;
}

function externalToolBorderColor(kind: ExternalToolFrameKind, text: string): string {
  const colors: Record<ExternalToolFrameKind, [number, number, number]> = {
    serena: [150, 210, 255],
    gitnexus: [185, 168, 255],
    structured: [205, 166, 255],
    process: [145, 231, 255],
    external: [168, 181, 199],
  };
  const [r, g, b] = colors[kind];
  return `[2m[38;2;${r};${g};${b}m${text}[39m[22m`;
}

export function collapsedExternalToolLines(contentLines: string[], expanded: boolean): string[] {
  if (expanded || contentLines.length <= 6) return contentLines;
  return [
    ...contentLines.slice(0, 6),
    `... (${contentLines.length - 6} more lines, ctrl+o to expand)`,
  ];
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
  const action = kind === "gitnexus" && toolName?.startsWith("gitnexus_")
    ? toolName.slice("gitnexus_".length)
    : kind === "serena" ? toolName : undefined;
  const providerHeader = /^\[[A-Za-z][A-Za-z0-9 _-]{0,31}\]/u.test(firstLine);

  if (providerHeader && action && !firstLine.endsWith(` ${action}`)) {
    displayLines = [`${firstLine} ${action}`, ...displayLines.slice(1)];
  } else if (!/^(?:[•›]\s+|\[[A-Za-z][A-Za-z0-9 _-]{0,31}\])/u.test(firstLine)) {
    const labels: Record<ExternalToolFrameKind, string> = {
      serena: "Serena",
      gitnexus: "GitNexus",
      structured: "structured_return",
      process: "process",
      external: "external",
    };
    const label = kind === "external" && toolName ? normalizeToolLabel(toolName) : labels[kind];
    displayLines = [`[${label}]${action ? ` ${action}` : ""}`, ...displayLines];
  }

  const header = displayLines[0] ?? "";
  const payloadLines = displayLines.slice(1);
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
  const body = [header, ...visiblePayload].map((rawLine) => {
    const line = truncateToWidth(rawLine, renderWidth);
    return highlightExternalToolBadge(kind, line);
  });
  return footerMeta
    ? [...body, `\x1b[2m${truncateToWidth(`└─ ${footerMeta}`, renderWidth)}\x1b[22m`]
    : body;
}

function renderExternalToolBoxLines(
  contentLines: string[],
  width: number,
  kind: ExternalToolFrameKind,
  expanded: boolean,
): string[] {
  const availableWidth = Math.max(8, width - 4);
  const maxContentWidth = expanded ? availableWidth : Math.min(availableWidth, 34);
  const visibleLines = collapsedExternalToolLines(contentLines, expanded);
  const contentWidth = Math.max(
    1,
    Math.min(maxContentWidth, ...visibleLines.map((line) => visibleWidth(line))),
  );
  const innerWidth = contentWidth + 2;

  const framed = [externalToolBorderColor(kind, `╭${"─".repeat(innerWidth)}╮`)];
  for (const rawLine of visibleLines) {
    const line = truncateToWidth(rawLine, contentWidth);
    framed.push(`${externalToolBorderColor(kind, "│")} ${padVisible(line, contentWidth)} ${externalToolBorderColor(kind, "│")}`);
  }
  framed.push(externalToolBorderColor(kind, `╰${"─".repeat(innerWidth)}╯`));
  return framed;
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
  if (contentLines.length === 0) return [];

  return activeExternalToolChrome === "box"
    ? renderExternalToolBoxLines(contentLines, width, kind, expanded)
    : renderExternalToolBackgroundLines(contentLines, width, kind, expanded, toolName, durationMs);
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

function applyThinkingChrome(ctx: ExtensionContext, prefs: XtrmUiPrefs): void {
  (ctx.ui as { setHiddenThinkingLabel?: (label?: string) => void }).setHiddenThinkingLabel?.(
    prefs.hideThinkingPlaceholder ? undefined : "",
  );
}

// ============================================================================
// Chrome Application
// ============================================================================

function fitVisible(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function resolveThemeForPrefs(prefs: XtrmUiPrefs): XtrmThemeName {
  const base = prefs.themeName === "pidex-light" || prefs.themeName === "pidex-light-flattools" ? "pidex-light" : "pidex-dark";
  if (!prefs.toolRowBg) return (base + "-flattools") as XtrmThemeName;
  return base as XtrmThemeName;
}

function formatThinking(level: string): string {
  return level === "off" ? "standard" : level;
}

function applyXtrmChrome(
  ctx: ExtensionContext,
  prefs: XtrmUiPrefs,
  getThinkingLevel: () => string
): void {
  if (prefs.forceTheme) {
    ctx.ui.setTheme(resolveThemeForPrefs(prefs));
  }

  // Tool expansion
  ctx.ui.setToolsExpanded(!prefs.compactTools);

  // Editor — density-aware input padding
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const editor = new XtrmEditor(tui, theme, keybindings);
    editor.setPrefs(prefs);
    return editor;
  });

  // Header (optional)
  if (prefs.showHeader) {
    ctx.ui.setHeader((_tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const boxWidth = width >= 54 ? 50 : Math.max(24, width);
        const model = ctx.model?.id ?? "no-model";
        const thinking = getThinkingLevel();
        const border = (text: string) => theme.fg("borderAccent", text);
        const leftPad = "";

        const top = leftPad + border(`╭${"─".repeat(Math.max(0, boxWidth - 2))}╮`);
        const line1 =
          leftPad +
          border("│") +
          fitVisible(
            ` ${theme.fg("dim", ">_")} ${theme.bold("XTRM")} ${theme.fg("dim", `(v1.0.0)`)}`,
            boxWidth - 2
          ) +
          border("│");
        const gap = leftPad + border("│") + fitVisible("", boxWidth - 2) + border("│");
        const line2 =
          leftPad +
          border("│") +
          fitVisible(
            ` ${theme.fg("dim", "model:".padEnd(11))}${model} ${thinking}${theme.fg("accent", "    /model")}${theme.fg("dim", " to change")}`,
            boxWidth - 2
          ) +
          border("│");
        const line3 =
          leftPad +
          border("│") +
          fitVisible(
            ` ${theme.fg("dim", "directory:".padEnd(11))}${basename(ctx.cwd)}`,
            boxWidth - 2
          ) +
          border("│");
        const bottom = leftPad + border(`╰${"─".repeat(Math.max(0, boxWidth - 2))}╯`);

        return [top, line1, gap, line2, line3, bottom];
      },
    }));
  } else {
    ctx.ui.setHeader(undefined);
  }

  // Footer - ONLY if showFooter is true (default false for XTRM)
  // This is the key difference from pi-dex - we let custom-footer handle it
  if (prefs.showFooter) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const modelId = ctx.model?.id ?? "no-model";
          const thinking = getThinkingLevel();
          const contextUsage = ctx.getContextUsage();
          const leftPct = contextUsage?.percent != null ? `${100 - Math.round(contextUsage.percent)}% left` : undefined;
          const line = theme.fg(
            "dim",
            [`${modelId} ${thinking}`, leftPct, basename(ctx.cwd)]
              .filter(Boolean)
              .join(" · ")
          );
          return [truncateToWidth(line, width)];
        },
      };
    });
  }
  // If showFooter is false, we do NOT call setFooter - custom-footer will handle it
}


function writeExternalCompactFlag(enabled: boolean): void {
  try {
    const settingsPath = join(process.env.HOME ?? "", ".pi", "agent", "settings.json");
    if (!settingsPath) return;
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {}
    }
    settings.xtrmExternalCompact = enabled;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch {}
}

// ============================================================================
// Tool Render Helpers
// ============================================================================

function renderOutputPreview(theme: any, lines: string[], maxLines: number): string {
  const subset = lines.slice(0, maxLines);
  let text = subset.map((line) => theme.fg("toolOutput", `  ${line}`)).join("\n");
  if (lines.length > maxLines) text += `\n${theme.fg("muted", `  … +${lines.length - maxLines} more`)}`;
  return text;
}

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

function summarizeCount(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
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
  if (normalized === "dark" || normalized === "pidex-dark") return "pidex-dark";
  if (normalized === "light" || normalized === "pidex-light") return "pidex-light";
  return undefined;
}

function parseDensityArg(arg: string): XtrmDensity | undefined {
  const normalized = arg.trim().toLowerCase();
  if (normalized === "compact") return "compact";
  if (normalized === "comfortable" || normalized === "normal") return "comfortable";
  return undefined;
}

function parseExternalToolChromeArg(arg: string): XtrmExternalToolChrome | undefined {
  const normalized = arg.trim().toLowerCase();
  if (normalized === "background" || normalized === "bg" || normalized === "row") return "background";
  if (normalized === "box" || normalized === "frame" || normalized === "border") return "box";
  return undefined;
}

function registerCommands(pi: ExtensionAPI, getPrefs: () => XtrmUiPrefs, setPrefs: (p: XtrmUiPrefs) => void, getThinkingLevel: () => string) {
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
      const trimmedArgs = args.trim();
      if (trimmedArgs) {
        const [subcommand, ...rest] = trimmedArgs.split(/\s+/u);
        if (subcommand === "chrome" || subcommand === "external-chrome" || subcommand === "tool-chrome") {
          const externalToolChrome = parseExternalToolChromeArg(rest.join(" "));
          if (!externalToolChrome) {
            ctx.ui.notify("Usage: /xtrm-ui chrome background|box", "warning");
            return;
          }
          const prefs = { ...getPrefs(), externalToolChrome };
          setPrefs(prefs);
          persistPrefs(pi, prefs);
          ctx.ui.notify(`External tool chrome set to ${externalToolChrome}.`, "info");
          return;
        }
        ctx.ui.notify("Usage: /xtrm-ui [chrome background|box]", "warning");
        return;
      }

      const prefs = getPrefs();
      const contextUsage = ctx.getContextUsage();
      const lines = [
        `Theme: ${prefs.themeName}`,
        `Force theme: ${prefs.forceTheme ? "on" : "off"}`,
        `Density: ${prefs.density}`,
        `Compact tools: ${prefs.compactTools ? "on" : "off"}`,
        `Show header: ${prefs.showHeader ? "yes" : "no"}`,
        `Show footer: ${prefs.showFooter ? "yes" : "no"} (custom-footer handles this)`,
        `Tool row background: ${prefs.toolRowBg ? "on" : "off"}`,
        `Compact external tool results: ${prefs.compactExternalToolResults ? "on" : "off"}`,
        `External tool chrome: ${prefs.externalToolChrome}`,
        `Model: ${ctx.model?.id ?? "none"}`,
        `Context: ${contextUsage?.tokens ?? "unknown"}/${contextUsage?.contextWindow ?? "unknown"}`,
      ];
      sendInfoMessage(pi, "XTRM UI status", lines.join("\\n"));
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
    description: "Switch XTRM UI density: compact|comfortable",
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
      const prefs = { ...getPrefs(), density, compactExternalToolResults: density === "compact" };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      writeExternalCompactFlag(prefs.compactExternalToolResults);
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
      const showHeader = args.trim().toLowerCase() === "on";
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
      const normalized = args.trim().toLowerCase();
      if (normalized !== "on" && normalized !== "off") {
        ctx.ui.notify("Usage: /xtrm-ui-forcetheme on|off", "warning");
        return;
      }
      const forceTheme = normalized === "on";
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
      const normalized = args.trim().toLowerCase();
      if (normalized !== "on" && normalized !== "off") {
        ctx.ui.notify("Usage: /xtrm-ui-rowbg on|off", "warning");
        return;
      }
      const toolRowBg = normalized === "on";
      const prefs = { ...getPrefs(), toolRowBg };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      applyXtrmChrome(ctx, prefs, getThinkingLevel);
      ctx.ui.notify(`Tool row background ${toolRowBg ? "enabled" : "disabled"}.`, "info");
    },
  });

  pi.registerCommand("xtrm-ui-compact-tools", {
    description: "Compact extension tool results: on|off (off keeps full Ctrl+O expand output)",
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const normalized = args.trim().toLowerCase();
      if (normalized !== "on" && normalized !== "off") {
        ctx.ui.notify("Usage: /xtrm-ui-compact-tools on|off", "warning");
        return;
      }
      const compactExternalToolResults = normalized === "on";
      const prefs = { ...getPrefs(), compactExternalToolResults };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      writeExternalCompactFlag(compactExternalToolResults);
      ctx.ui.notify(
        `Compact external tool results ${compactExternalToolResults ? "enabled" : "disabled"}.`,
        "info",
      );
    },
  });

  pi.registerCommand("xtrm-ui-external-chrome", {
    description: "Choose non-native tool chrome: background|box",
    getArgumentCompletions: (prefix) => {
      const values = ["background", "box"].filter((item) => item.startsWith(prefix));
      return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const externalToolChrome = parseExternalToolChromeArg(args);
      if (!externalToolChrome) {
        ctx.ui.notify("Usage: /xtrm-ui-external-chrome background|box", "warning");
        return;
      }
      const prefs = { ...getPrefs(), externalToolChrome };
      setPrefs(prefs);
      persistPrefs(pi, prefs);
      ctx.ui.notify(`External tool chrome set to ${externalToolChrome}.`, "info");
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
// Tool Renderers (ported from pi-dex tooling.ts)
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

function appendToolFooter(theme: any, text: string, parts: Array<string | undefined>): string {
  const meta = joinMeta(parts);
  return meta ? `${text}\n${theme.fg("dim", `└─ ${meta}`)}` : text;
}

function renderPendingCall(toolName: string, args: Record<string, unknown>, theme: any): Text {
  if (toolName === "bash") {
    const command = shortenCommand(String(args.command ?? ""), 80);
    return new Text(`${theme.fg("accent", TOOL_ROW_MARKER)} ${theme.fg("accent", "$")} ${theme.fg("accent", command)}`, 0, 0);
  }
  return new Text(renderToolSummary(theme, "pending", toolName, summarizeToolSubject(toolName, args), undefined), 0, 0);
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
        return toolRowText(theme, `${theme.fg("accent", TOOL_ROW_MARKER)} ${theme.fg("accent", "$")} ${theme.fg("accent", command)}`);
      }
      const output = getTextContent(result as any);
      const outputLines = cleanOutputLines(output);
      const statusColor = context.isError ? "error" : "success";
      let text = `${theme.fg(statusColor, TOOL_ROW_MARKER)} ${theme.fg(statusColor, "$")} ${theme.fg(statusColor, command)}`;
      const visibleLines = expanded ? outputLines : outputLines.slice(-4);
      if (visibleLines.length > 0) {
        text += "\n" + visibleLines.map((line) => `  ${theme.fg("toolOutput", line)}`).join("\n");
      }
      const lineSummary = !expanded && visibleLines.length < outputLines.length
        ? `showing ${visibleLines.length}/${outputLines.length} lines (ctrl+o expand)`
        : formatLineLabel(outputLines.length, "line");
      text = appendToolFooter(theme, text, [
        lineSummary,
        renderDuration(context),
        formatPayloadSize(output),
        details.truncation?.truncated ? "truncated" : undefined,
      ]);
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
      if (isPartial) return toolRowText(theme, renderToolSummary(theme, "pending", "read", "loading", undefined));
      const details = (result.details ?? {}) as ReadToolDetails;
      const args = context.args as Record<string, unknown>;
      const subjectBase = shortenPath(String(args.path ?? ""));
      const range = lineRange(args.offset as number | undefined, args.limit as number | undefined);
      const subject = range ? `${subjectBase}:${range}` : subjectBase;
      const first = result.content[0];
      if (first?.type === "image") {
        const text = appendToolFooter(
          theme,
          renderToolSummary(theme, "success", "read", subject, undefined),
          ["image", renderDuration(context)],
        );
        return toolRowText(theme, text);
      }
      const textContent = getTextContent(result as any);
      const lines = textContent.split("\n");
      const totalLines = lines.length;
      const showContent = expanded || totalLines <= 6;
      let text = renderToolSummary(theme, context.isError ? "error" : "success", "read", subject, undefined);
      if (showContent && totalLines > 0) {
        text += "\n" + lines.map((line) => `  ${theme.fg("toolOutput", line)}`).join("\n");
      }
      const lineSummary = !showContent && totalLines > 0
        ? `${formatLineLabel(totalLines, "line")} (ctrl+o expand)`
        : formatLineLabel(totalLines, "line");
      text = appendToolFooter(theme, text, [
        lineSummary,
        renderDuration(context),
        formatPayloadSize(textContent),
        details.truncation?.truncated ? `from ${details.truncation.totalLines}` : undefined,
      ]);
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
      if (isPartial) return toolRowText(theme, renderToolSummary(theme, "pending", "edit", "applying", undefined));
      const details = (result.details ?? {}) as EditToolDetails;
      const args = context.args as Record<string, unknown>;
      const path = String(args.path ?? "");
      const textContent = getTextContent(result as any);
      if (context.isError) {
        const text = appendToolFooter(
          theme,
          renderToolSummary(theme, "error", "edit", path, textContent.split("\n")[0]),
          [renderDuration(context)],
        );
        return toolRowText(theme, text);
      }
      const stats = details.diff ? diffStats(details.diff) : { additions: 0, removals: 0 };
      let text = renderToolSummary(theme, "success", "edit", path, undefined);
      if (details.diff) text += `\n${renderRichDiffPreview(theme, details.diff, 18)}`;
      text = appendToolFooter(theme, text, [`+${stats.additions}`, `-${stats.removals}`, renderDuration(context)]);
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
      if (isPartial) return toolRowText(theme, renderToolSummary(theme, "pending", "write", "writing", undefined));
      const args = context.args as Record<string, unknown>;
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const textContent = getTextContent(result as any);
      if (context.isError) {
        const text = appendToolFooter(
          theme,
          renderToolSummary(theme, "error", "write", path, textContent.split("\n")[0]),
          [renderDuration(context)],
        );
        return toolRowText(theme, text);
      }

      const preview = (context.state as XtrmToolRenderState).writePreview;
      if (preview?.kind === "unchanged") {
        const text = appendToolFooter(
          theme,
          renderToolSummary(theme, "success", "write", path, undefined),
          ["no changes", renderDuration(context)],
        );
        return toolRowText(theme, text);
      }
      if (preview?.kind === "updated") {
        let text = renderToolSummary(theme, "success", "write", path, undefined);
        if (preview.diff) text += `\n${renderRichDiffPreview(theme, preview.diff, 18)}`;
        text = appendToolFooter(theme, text, [`+${preview.additions}`, `-${preview.removals}`, renderDuration(context)]);
        return toolRowText(theme, text);
      }

      const lines = preview?.kind === "created" ? preview.lineCount : lineCount(content);
      let text = renderToolSummary(theme, "success", "write", path, undefined);
      const contentLines = content.split("\n");
      const showContent = content && (expanded || contentLines.length <= 6);
      if (showContent) {
        text += "\n" + contentLines.map((line) => `  ${theme.fg("toolOutput", line)}`).join("\n");
      }
      text = appendToolFooter(theme, text, [
        !showContent && lines > 0 ? `${formatLineLabel(lines, "line")} (ctrl+o expand)` : formatLineLabel(lines, "line"),
        renderDuration(context),
        formatPayloadSize(content),
      ]);
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
      if (isPartial) return toolRowText(theme, renderToolSummary(theme, "pending", "find", "searching", undefined));
      const details = (result.details ?? {}) as FindToolDetails;
      const args = context.args as Record<string, unknown>;
      const textContent = getTextContent(result as any);
      const count = summarizeCount(textContent);
      let text = renderToolSummary(theme, context.isError ? "error" : "success", "find", String(args.pattern ?? ""), undefined);
      if (expanded && count > 0) text += `\n${renderOutputPreview(theme, previewLines(textContent, 10), 10)}`;
      text = appendToolFooter(theme, text, [
        !expanded && count > 0 ? `${formatLineLabel(count, "match")} (ctrl+o expand)` : formatLineLabel(count, "match"),
        renderDuration(context),
        formatPayloadSize(textContent),
        details.resultLimitReached ? "limit reached" : undefined,
      ]);
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
      if (isPartial) return toolRowText(theme, renderToolSummary(theme, "pending", "grep", "searching", undefined));
      const details = (result.details ?? {}) as GrepToolDetails;
      const args = context.args as Record<string, unknown>;
      const textContent = getTextContent(result as any);
      const count = countPrefixedItems(textContent, ["-- "]) || summarizeCount(textContent);
      let text = renderToolSummary(theme, context.isError ? "error" : "success", "grep", String(args.pattern ?? ""), undefined);
      if (expanded && textContent.length > 0) text += `\n${renderOutputPreview(theme, previewLines(textContent, 12), 12)}`;
      text = appendToolFooter(theme, text, [
        !expanded && count > 0 ? `${formatLineLabel(count, "match")} (ctrl+o expand)` : formatLineLabel(count, "match"),
        renderDuration(context),
        formatPayloadSize(textContent),
        details.matchLimitReached ? "limit reached" : undefined,
      ]);
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
      if (isPartial) return toolRowText(theme, renderToolSummary(theme, "pending", "ls", "listing", undefined));
      const details = (result.details ?? {}) as LsToolDetails;
      const args = context.args as Record<string, unknown>;
      const textContent = getTextContent(result as any);
      const count = summarizeCount(textContent);
      let text = renderToolSummary(theme, context.isError ? "error" : "success", "ls", shortenPath(String(args.path ?? ".")), undefined);
      if (expanded && count > 0) text += `\n${renderOutputPreview(theme, previewLines(textContent, 12), 12)}`;
      text = appendToolFooter(theme, text, [
        !expanded && count > 0 ? `${formatLineLabel(count, "entry")} (ctrl+o expand)` : formatLineLabel(count, "entry"),
        renderDuration(context),
        formatPayloadSize(textContent),
        details.entryLimitReached ? "limit reached" : undefined,
      ]);
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
  const extensionThemeDir = join(__dirname, "../../themes/xtrm-ui");

  const getPrefs = () => prefs;
  const setPrefs = (p: XtrmUiPrefs) => {
    prefs = p;
    setActiveExternalToolChrome(p.externalToolChrome);
  };
  const getThinkingLevel = () => formatThinking(pi.getThinkingLevel());

  registerXtrmUiTools(pi, getPrefs);
  registerCommands(pi, getPrefs, setPrefs, getThinkingLevel);

  const refresh = (ctx: ExtensionContext) => {
    applyXtrmChrome(ctx, prefs, getThinkingLevel);
    applyThinkingChrome(ctx, prefs);
  };

  pi.on("resources_discover", async () => ({
    themePaths: [extensionThemeDir],
  }));

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
