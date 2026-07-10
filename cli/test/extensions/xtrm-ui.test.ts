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

const { default: xtrmUiExtension } = await import("../../../packages/pi-extensions/extensions/xtrm-ui/index");

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

const context = (args: Record<string, unknown>) => ({
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
});

describe("xtrm-ui built-in tool rendering", () => {
  it("reads bash labels from render context args", () => {
    const { tools } = loadExtension();
    const component = tools.bash.renderResult(
      { content: [{ type: "text", text: "ok" }], details: {} },
      { expanded: false, isPartial: false },
      theme,
      context({ command: "echo context-label" }),
    );

    expect(component.render(200).join("\n")).toContain("$ echo context-label");
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
  });
});
