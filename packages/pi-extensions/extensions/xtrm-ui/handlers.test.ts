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
const { createPatchedUpdateContent } = await import("./index.ts");
const { buildThinkingRecap } = await import("./index.ts");

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

  test("thinking toggle re-renders existing thinking rows (xtrm-5vi8u)", () => {
    // Simulates pi's AssistantMessageComponent: updateContent stores the
    // message as lastMessage, and setHideThinkingBlock re-renders from it.
    type ContentBlock = { type: string; text?: string; thinking?: string };
    const latch = { followsToggle: false };
    const rendered: Array<{ hide: boolean; content: ContentBlock[] }> = [];
    const component = {
      hideThinkingBlock: false,
      lastMessage: undefined as { content: ContentBlock[] } | undefined,
      updateContent(message: { content: ContentBlock[] }) {
        this.lastMessage = message;
        rendered.push({ hide: this.hideThinkingBlock, content: message.content });
      },
    };
    component.updateContent = createPatchedUpdateContent(
      component.updateContent as never,
      {
        label: (text: string) => text,
        recap: (text: string) => text,
        hint: (text: string) => text,
        sep: " · ",
      },
      latch,
    );
    const setHideThinkingBlock = (hide: boolean) => {
      component.hideThinkingBlock = hide;
      if (component.lastMessage) component.updateContent(component.lastMessage as never);
    };
    const trace = "First line of the thinking trace\nDEEP_SECRET_DETAIL_XYZ not in recap";
    const message = { content: [{ type: "thinking", thinking: trace }] };

    // First render with pi's initial hideThinkingBlock=false: compact preview
    // until the user toggles (xtrm-6ggil latch behavior). The recap shows the
    // first substantive line only; the deep detail must stay hidden.
    component.updateContent(message as never);
    expect(rendered.at(-1)!.content[0]).toMatchObject({ type: "text" });
    const first = rendered.at(-1)!.content[0].text!;
    expect(first).toContain("(Ctrl+T to expand)");
    expect(first).not.toContain("DEEP_SECRET_DETAIL_XYZ");

    // Toggle ON: rows stay collapsed (still following pi's hide state).
    setHideThinkingBlock(true);
    expect(rendered.at(-1)!.content[0].text!).toContain("(Ctrl+T to expand)");

    // Toggle OFF: the EXISTING thinking row must flip to the expanded trace.
    setHideThinkingBlock(false);
    const expanded = rendered.at(-1)!.content[0].text!;
    expect(expanded).toContain("(Ctrl+T to collapse)");
    expect(expanded).toContain("DEEP_SECRET_DETAIL_XYZ");

    // Toggle ON again: collapses back.
    setHideThinkingBlock(true);
    expect(rendered.at(-1)!.content[0].text!).toContain("(Ctrl+T to expand)");

    // lastMessage must keep the RAW thinking block so every toggle re-enters
    // the patch with original content (the bug: it held the converted rows).
    expect(component.lastMessage!.content[0]).toMatchObject({ type: "thinking", thinking: trace });
  });

  test("thinking first-render latch: fresh session stays compact until a real toggle (xtrm-6ggil)", () => {
    type ContentBlock = { type: string; text?: string; thinking?: string };
    const trace = "A long trace line that must not leak on the first render";
    const plainStyle = {
      label: (text: string) => text,
      recap: (text: string) => text,
      hint: (text: string) => text,
      sep: " · ",
    };
    const run = (hideThinkingBlock: boolean, latch: { followsToggle: boolean }) => {
      const rendered: ContentBlock[][] = [];
      const component = {
        hideThinkingBlock,
        lastMessage: undefined as { content: ContentBlock[] } | undefined,
        updateContent(message: { content: ContentBlock[] }) {
          this.lastMessage = message;
          rendered.push(message.content);
        },
      };
      component.updateContent = createPatchedUpdateContent(component.updateContent as never, plainStyle, latch);
      component.updateContent({ content: [{ type: "thinking", thinking: trace }] } as never);
      return rendered[0]![0].text ?? "";
    };

    // Fresh session latch (followsToggle=false): first thinking block renders
    // compact even when pi's hide state is false.
    expect(run(false, { followsToggle: false })).toContain("(Ctrl+T to expand)");
    // ...and stays compact when pi's hide state is true.
    expect(run(true, { followsToggle: false })).toContain("(Ctrl+T to expand)");
  });

  test("thinking patch passes non-thinking messages through untouched", () => {
    type ContentBlock = { type: string; text?: string };
    const plainStyle = {
      label: (text: string) => text,
      recap: (text: string) => text,
      hint: (text: string) => text,
      sep: " · ",
    };
    const seen: Array<{ content: ContentBlock[] }> = [];
    const component = {
      hideThinkingBlock: false,
      lastMessage: undefined as { content: ContentBlock[] } | undefined,
      updateContent(message: { content: ContentBlock[] }) {
        this.lastMessage = message;
        seen.push(message);
      },
    };
    component.updateContent = createPatchedUpdateContent(component.updateContent as never, plainStyle, {
      followsToggle: false,
    });
    const message = { content: [{ type: "text", text: "plain reply" }] };
    component.updateContent(message as never);
    expect(seen).toEqual([message]);
  });
});
