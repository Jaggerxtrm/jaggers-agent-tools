import { describe, expect, mock, test } from "bun:test";

mock.module("@earendil-works/pi-ai", () => ({ complete: async () => ({}) }));
mock.module("@earendil-works/pi-coding-agent", () => ({
  BorderedLoader: class {},
  CustomEditor: class {},
  VERSION: "test",
  createBashTool: () => ({}),
  createEditTool: () => ({}),
  createFindTool: () => ({}),
  createGrepTool: () => ({}),
  createLsTool: () => ({}),
  createReadTool: () => ({}),
  createWriteTool: () => ({}),
  isBashToolResult: () => false,
  isToolCallEventType: () => false,
}));
mock.module("@earendil-works/pi-tui", () => ({
  Box: class {},
  Text: class {
    constructor(public text: string) {}
  },
  matchesKey: () => false,
  truncateToWidth: (value: string) => value,
  visibleWidth: (value: string) => value.length,
}));
mock.module("@mariozechner/pi-coding-agent", () => ({}));

const xtrmUiExtension = (await import("./index.ts")).default;

type RegisteredTool = {
  name: string;
  renderResult: (result: unknown, options: unknown, theme: unknown, context: unknown) => unknown;
};

function registerWithMock(): { tools: RegisteredTool[]; events: string[] } {
  const tools: RegisteredTool[] = [];
  const events: string[] = [];
  const pi = {
    on: (event: string) => {
      events.push(event);
    },
    registerTool: (tool: RegisteredTool) => {
      tools.push(tool);
    },
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    registerMarkdownTransformer: () => {},
    getThinkingLevel: () => "medium",
  };
  xtrmUiExtension(pi as never);
  return { tools, events };
}

describe("xtrm-ui presentation-only boundary", () => {
  test("xtrm-ui installs no tool_result handler", () => {
    const { events } = registerWithMock();
    expect(events).not.toContain("tool_result");
  });

  test("read.renderResult displays already-numbered content without re-prefixing", () => {
    const { tools } = registerWithMock();
    const readTool = tools.find((tool) => tool.name === "read");
    expect(readTool).toBeDefined();

    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      bg: (_color: string) => (text: string) => text,
    };
    const rendered = readTool!.renderResult(
      {
        content: [{ type: "text", text: "137 | foo\n138 | bar\n139 | baz" }],
        details: {},
        isError: false,
      },
      { expanded: true, isPartial: false },
      theme,
      { args: { path: "/a/b.txt" }, executionStarted: true, isPartial: false, state: {} },
    ) as { text: string };

    const output = rendered.text;
    expect(output).toContain("137 | foo");
    expect(output).toContain("138 | bar");
    expect(output).toContain("139 | baz");
    expect(output).not.toContain("137 | 137 |");
    expect(output).not.toContain("1 | foo");
  });

  test("read.renderResult preserves numbered blank lines (collapsed + expanded)", () => {
    // A numbered blank line ("138 | ") is exactly the artifact the previous
    // over-strip fix removed. Guard both view modes so a regression is caught
    // at the presentation layer as well as the transform layer.
    const { tools } = registerWithMock();
    const readTool = tools.find((tool) => tool.name === "read");
    expect(readTool).toBeDefined();

    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      bg: (_color: string) => (text: string) => text,
    };
    const numbered = "137 | foo\n138 | \n139 | bar";
    const call = (expanded: boolean) =>
      (readTool!.renderResult(
        {
          content: [{ type: "text", text: numbered }],
          details: {},
          isError: false,
        },
        { expanded, isPartial: false },
        theme,
        { args: { path: "/a/b.txt", offset: 137 }, executionStarted: true, isPartial: false, state: {} },
      ) as { text: string }).text;

    for (const rendered of [call(false), call(true)]) {
      expect(rendered).toContain("137 | foo");
      expect(rendered).toContain("138 | ");
      expect(rendered).toContain("139 | bar");
      // No double-prefix drift.
      expect(rendered).not.toContain("137 | 137 |");
      expect(rendered).not.toContain("138 | 138 |");
    }
  });
});
