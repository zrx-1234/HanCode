import { describe, expect, test } from "bun:test";
import { htmlToText } from "../src/tools/webFetch";

describe("webFetch helpers", () => {
  test("converts basic HTML to readable text", () => {
    const result = htmlToText("<html><head><title>Hello &amp; Test</title><style>.x{}</style></head><body><h1>Heading</h1><script>alert(1)</script><p>A&nbsp;paragraph.</p></body></html>");

    expect(result.title).toBe("Hello & Test");
    expect(result.text).toContain("Heading");
    expect(result.text).toContain("A paragraph.");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain(".x");
  });
});
