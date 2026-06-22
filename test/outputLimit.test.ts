import { describe, expect, test } from "bun:test";
import { limitOutput } from "../src/security/outputLimit";

describe("limitOutput", () => {
  test("keeps short output unchanged", () => {
    expect(limitOutput("hello", 10)).toBe("hello");
  });

  test("truncates long output with head and tail", () => {
    const result = limitOutput("0123456789abcdef", 10);
    expect(result).toContain("01234");
    expect(result).toContain("bcdef");
    expect(result).toContain("Output truncated");
  });
});
