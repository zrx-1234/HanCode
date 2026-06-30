import { describe, expect, test } from "bun:test";
import { normalizeInsertedLineEndings, withLineNumbers } from "../src/utils/text";

describe("withLineNumbers", () => {
  test("adds line numbers starting from 1 by default", () => {
    const result = withLineNumbers("a\nb\nc");
    expect(result).toContain("1\ta");
    expect(result).toContain("2\tb");
    expect(result).toContain("3\tc");
  });

  test("supports offset", () => {
    const result = withLineNumbers("a\nb", 10);
    expect(result).toContain("11\ta");
    expect(result).toContain("12\tb");
  });

  test("handles empty string", () => {
    expect(withLineNumbers("")).toBe("     1\t");
  });

  test("pads to 6 digits", () => {
    const result = withLineNumbers("x", 999);
    expect(result).toContain("  1000\tx");
  });
});

describe("normalizeInsertedLineEndings", () => {
  test("converts to CRLF when original is mostly CRLF", () => {
    const result = normalizeInsertedLineEndings("a\r\nb\r\nc", "x\ny\nz");
    expect(result).toBe("x\r\ny\r\nz");
  });

  test("converts to LF when original is mostly LF", () => {
    const result = normalizeInsertedLineEndings("a\nb\nc", "x\r\ny\r\nz");
    expect(result).toBe("x\ny\nz");
  });

  test("leaves LF when original has no line endings", () => {
    const result = normalizeInsertedLineEndings("abc", "x\r\ny");
    expect(result).toBe("x\ny");
  });
});
