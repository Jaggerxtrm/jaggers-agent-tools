import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => {
  const tool = (name: string) => ({ name, description: name, parameters: {}, execute: vi.fn() });
  return {
    CustomEditor: class {},
    createBashTool: () => tool("bash"),
    createEditTool: () => tool("edit"),
    createFindTool: () => tool("find"),
    createGrepTool: () => tool("grep"),
    createLsTool: () => tool("ls"),
    createReadTool: () => tool("read"),
    createWriteTool: () => tool("write"),
  };
});

vi.mock("@earendil-works/pi-tui", () => ({
  Box: class {},
  Text: class {
    constructor(private text: string) {}
    render() { return this.text.split("\n"); }
  },
  truncateToWidth: (text: string) => text,
  visibleWidth: (text: string) => text.length,
}));

const {
  collapsedExternalToolLines,
  default: xtrmUiExtension,
  renderExternalToolBackgroundLines,
} = await import("../../../packages/pi-extensions/extensions/xtrm-ui/index");

function loadExtension() {
  const handlers: Record<string, Function[]> = {};
  const tools: Record<string, any> = {};
  const pi = new Proxy(
    {
      getThinkingLevel: () => "off",
      on(event: string, handler: Function) {
        (handlers[event] ??= []).push(handler);
      },
      registerTool(tool: any) {
        tools[tool.name] = tool;
      },
      registerCommand() {},
      registerMessageRenderer() {},
    },
    { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} },
  );

  xtrmUiExtension(pi as any);
  return { handlers, tools };
}

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const context = (args: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  args,
  toolCallId: "call-1",
  invalidate() {},
  lastComponent: undefined,
  state: {},
  cwd: "/tmp",
  executionStarted: true,
  argsComplete: true,
  isPartial: false,
  expanded: false,
  showImages: true,
  isError: false,
  ...overrides,
});

describe("xtrm-ui built-in tool rendering", () => {
  it("uses one consistent bash row across call phases", () => {
    const { tools } = loadExtension();
    const args = { command: "echo context-label" };
    const pending = tools.bash.renderCall(
      args,
      theme,
      context(args, { executionStarted: false, isPartial: true }),
    );
    const running = tools.bash.renderCall(
      args,
      theme,
      context(args, { executionStarted: true, isPartial: true }),
    );

    expect(pending.render(200).join("\n")).toContain("$ echo context-label");
    expect(running.render(200).join("\n")).toBe("");
  });

  it("reads bash labels from render context args", () => {
    const { tools } = loadExtension();
    const component = tools.bash.renderResult(
      { content: [{ type: "text", text: "ok" }], details: {} },
      { expanded: false, isPartial: false },
      theme,
      context({ command: "echo context-label" }),
    );

    const lines = component.render(200);
    expect(lines[0]).toBe("› $ echo context-label");
    expect(lines.at(-1)).toBe("└─ 1 line · 2B");
  });

  it("keeps pre-write diff data in renderer-local state", () => {
    const { tools } = loadExtension();
    const path = join(mkdtempSync(join(tmpdir(), "xtrm-ui-")), "probe.txt");
    writeFileSync(path, "before\n");
    const renderContext = context({ path, content: "after\n" });

    tools.write.renderCall(renderContext.args, theme, renderContext);
    const component = tools.write.renderResult(
      { content: [{ type: "text", text: "ok" }], details: undefined },
      { expanded: false, isPartial: false },
      theme,
      renderContext,
    );

    expect(component.render(200).join("\n")).toContain("+1 · -1");
  });

  it("does not register built-in lifecycle tracking hooks", () => {
    const { handlers } = loadExtension();

    expect(handlers.tool_call).toBeUndefined();
    expect(handlers.tool_execution_end).toBeUndefined();
    expect(handlers.tool_result).toBeUndefined();
  });
});

describe("xtrm-ui external tool rendering", () => {
  it("renders one unindented Claude-style footer", () => {
    const rendered = renderExternalToolBackgroundLines(
      ["[GitNexus]", ...Array.from({ length: 94 }, (_, index) => `line ${index + 1}`)],
      200,
      "gitnexus",
      false,
      "gitnexus_query",
      1600,
    );
    const footer = rendered.at(-1)?.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

    expect(footer).toMatch(/^└─ showing 6\/94 lines \(ctrl\+o expand\) · 1\.6s · \d+B$/);
  });

  it("adds a Serena badge and pretty-prints single-line JSON", () => {
    const rendered = renderExternalToolBackgroundLines(
      ['[{"name_path":"highlightExternalToolBadge","kind":"Function"}]'],
      200,
      "serena",
      false,
      "find_symbol",
    );

    expect(rendered[0]).toContain("\x1b[48;2;82;210;255m[Serena]");
    expect(rendered[0]).toContain("\x1b[49m find_symbol");
    expect(rendered.length).toBeGreaterThan(2);
    expect(rendered.join("\n")).toContain('"name_path": "highlightExternalToolBadge"');
  });

  it("uses the real name for generic external tool badges", () => {
    const rendered = renderExternalToolBackgroundLines(
      ["plain result"],
      200,
      "external",
      false,
      "mcp_custom_tool",
    );

    expect(rendered[0]).toContain("[mcp custom_tool]");
  });

  it("keeps a colored provider badge and action for raw GitNexus output", () => {
    const rendered = renderExternalToolBackgroundLines(
      ["[GitNexus]", "{", '  "status": "found"', "}"],
      200,
      "gitnexus",
      false,
      "gitnexus_query",
    );

    expect(rendered[0]).toContain("\x1b[48;2;178;154;255m[GitNexus]");
    expect(rendered[0]).toContain("\x1b[49m query");
  });

  it("keeps collapsed structured output multiline and bounded", () => {
    const lines = ["[GitNexus]", "{", "  summary: {", "    changed: 11", "  },", "  symbols: [", "    one", "  ]", "}"];

    expect(collapsedExternalToolLines(lines, false)).toEqual([
      "[GitNexus]",
      "{",
      "  summary: {",
      "    changed: 11",
      "  },",
      "  symbols: [",
      "... (3 more lines, ctrl+o to expand)",
    ]);
    expect(collapsedExternalToolLines(lines, true)).toEqual(lines);
  });
});
