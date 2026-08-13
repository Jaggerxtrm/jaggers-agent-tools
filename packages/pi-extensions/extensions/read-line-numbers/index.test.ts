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
