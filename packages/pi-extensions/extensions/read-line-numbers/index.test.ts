import { describe, expect, mock, test } from "bun:test";

mock.module("@earendil-works/pi-coding-agent", () => ({
  isReadToolResult: (event: { toolName: string }) => event.toolName === "read",
}));

const { numberReadText } = await import("./index.ts");
const registerExtension = (await import("./index.ts")).default;

type ReadEvent = {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  input: { path: string; offset?: number; limit?: number };
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  details?: unknown;
};

function runHandler(event: ReadEvent): unknown {
  const handlers: Array<(event: unknown) => unknown> = [];
  registerExtension({ on: (_name: string, handler: (event: unknown) => unknown) => handlers.push(handler) } as never);
  return handlers[0]?.(event);
}

describe("numberReadText", () => {
  test("multi-line input prefixes every line with 1-based numbers", () => {
    expect(numberReadText("foo\nbar\nbaz", 1, false)).toBe("1 | foo\n2 | bar\n3 | baz");
  });

  test("offset 137 numbers from the true source line", () => {
    expect(numberReadText("foo\nbar", 137, false)).toBe("137 | foo\n138 | bar");
  });

  test("empty content passes through unchanged", () => {
    expect(numberReadText("", 1, false)).toBe("");
  });

  test("single-line content is numbered 1", () => {
    expect(numberReadText("text", 1, false)).toBe("1 | text");
  });

  test("trailing newline leaves the final empty line unnumbered", () => {
    expect(numberReadText("foo\nbar\n", 1, false)).toBe("1 | foo\n2 | bar\n");
  });

  test("Pi truncation notice is preserved verbatim, not prefixed", () => {
    const input = "foo\nbar\n\n[Showing lines 1-2 of 5000. Use offset=3 to continue.]";
    expect(numberReadText(input, 1, true)).toBe(
      "1 | foo\n2 | bar\n\n[Showing lines 1-2 of 5000. Use offset=3 to continue.]",
    );
  });

  test("Pi user-limit notice is preserved verbatim even without truncation flag", () => {
    const input = "foo\nbar\n\n[3 more lines in file. Use offset=3 to continue.]";
    expect(numberReadText(input, 1, false)).toBe(
      "1 | foo\n2 | bar\n\n[3 more lines in file. Use offset=3 to continue.]",
    );
  });

  test("first-line-exceeds banner alone is preserved verbatim", () => {
    const input = "[Line 5 is 60KB, exceeds 50KB limit. Use bash: sed -n '5p' /a/b.txt | head -c 51200]";
    expect(numberReadText(input, 1, true)).toBe(input);
  });

  // --- Mandate Section 4 correctness: REAL blank source lines must be numbered ---

  test("interior blank source line is numbered (case 3)", () => {
    expect(numberReadText("foo\n\nbar", 1, false)).toBe("1 | foo\n2 | \n3 | bar");
  });

  test("multiple consecutive blank source lines are all numbered (case 4)", () => {
    expect(numberReadText("foo\n\n\nbar", 1, false)).toBe("1 | foo\n2 | \n3 | \n4 | bar");
  });

  test("first selected line is blank at offset 137 (case 5)", () => {
    expect(numberReadText("\nfoo", 137, false)).toBe("137 | \n138 | foo");
  });

  test("genuine last blank source line is numbered (case 6)", () => {
    // File content "foo\n\n" — a blank last line followed by the trailing
    // newline artifact. The blank line at row 2 must arrive numbered.
    expect(numberReadText("foo\n\n", 1, false)).toBe("1 | foo\n2 | \n");
  });

  test("synthetic blank separator before a notice stays unnumbered (case 11)", () => {
    const input = "foo\nbar\n\n[Showing lines 1-2 of 5000. Use offset=3 to continue.]";
    const output = numberReadText(input, 1, true);
    expect(output).toBe("1 | foo\n2 | bar\n\n[Showing lines 1-2 of 5000. Use offset=3 to continue.]");
    // The separator must not carry a "3 |" prefix.
    expect(output).not.toContain("3 | ");
  });
});

describe("read-line-numbers extension (integration)", () => {
  test("registered handler numbers a REAL interior blank line (case 16)", () => {
    // Exercise the extension entry point end-to-end: registerExtension →
    // tool_result dispatch → numberReadText. This is the same path Pi runs.
    const result = runHandler({
      type: "tool_result",
      toolCallId: "call-blank",
      toolName: "read",
      input: { path: "/a/b.txt", offset: 10 },
      content: [{ type: "text", text: "alpha\n\nbeta" }],
      isError: false,
    }) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toBe("10 | alpha\n11 | \n12 | beta");
  });
});

describe("read-line-numbers extension", () => {
  test("read tool result is numbered using the event offset", () => {
    const result = runHandler({
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "/a/b.txt", offset: 137 },
      content: [{ type: "text", text: "foo\nbar" }],
      isError: false,
    }) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toBe("137 | foo\n138 | bar");
  });

  test("read tool result without offset numbers from 1", () => {
    const result = runHandler({
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "/a/b.txt" },
      content: [{ type: "text", text: "foo" }],
      isError: false,
    }) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toBe("1 | foo");
  });

  test("non-read tool result passes through untouched", () => {
    const result = runHandler({
      type: "tool_result",
      toolCallId: "call-2",
      toolName: "bash",
      input: { command: "ls" },
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      isError: false,
    });
    expect(result).toBeUndefined();
  });

  test("error result passes through untouched", () => {
    const result = runHandler({
      type: "tool_result",
      toolCallId: "call-3",
      toolName: "read",
      input: { path: "/a/b.txt", offset: 999 },
      content: [{ type: "text", text: "Offset 999 is beyond end of file (5 lines total)" }],
      isError: true,
    });
    expect(result).toBeUndefined();
  });
});
