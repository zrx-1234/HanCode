import { describe, expect, test, afterEach, mock } from "bun:test";
import { htmlToText, webFetchTool } from "../src/tools/webFetch";
import type { ToolContext } from "../src/agent/types";
import { testWebConfig } from "./helpers";

function createEnabledContext(): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    readState: new Map(),
    confirm: async () => false,
    audit: { log: async () => undefined },
    signal: new AbortController().signal,
    web: { ...testWebConfig, enabled: true, fetch: { ...testWebConfig.fetch, enabled: true } },
    permissionMode: "normal",
  };
}

// Minimal valid 1x1 PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNAAQEAAAABIwD+V9twAAAABJRU5ErkJggg==",
  "base64",
);

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

describe("webFetch image handling", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns image content blocks for image URLs", async () => {
    const mockFetch = mock(async () => {
      return new Response(PNG_1X1, { status: 200, headers: { "content-type": "image/png" } });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await webFetchTool.execute({ url: "https://example.com/hancode-image-a.png" }, createEnabledContext());

    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.content)).toBe(true);
    const blocks = result.content as unknown as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("text");
    const image = blocks[1] as { type: string; source: { type: string; media_type: string; data: string } };
    expect(image.type).toBe("image");
    expect(image.source.type).toBe("base64");
    expect(image.source.media_type).toBe("image/png");
    expect(image.source.data).toBe(PNG_1X1.toString("base64"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("recognizes image content-type with parameters", async () => {
    const mockFetch = mock(async () => {
      return new Response(PNG_1X1, { status: 200, headers: { "content-type": "image/jpeg; charset=binary" } });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await webFetchTool.execute({ url: "https://example.com/hancode-image-b.jpg" }, createEnabledContext());

    const blocks = result.content as unknown as Array<Record<string, unknown>>;
    const image = blocks[1] as { source: { media_type: string } };
    expect(image.source.media_type).toBe("image/jpeg");
  });

  test("caches image responses across calls", async () => {
    const mockFetch = mock(async () => {
      return new Response(PNG_1X1, { status: 200, headers: { "content-type": "image/png" } });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const first = await webFetchTool.execute({ url: "https://example.com/hancode-image-c.png" }, createEnabledContext());
    const second = await webFetchTool.execute({ url: "https://example.com/hancode-image-c.png" }, createEnabledContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second.content).toEqual(first.content);
  });

  test("focus instruction is prepended as a text block for image results", async () => {
    const mockFetch = mock(async () => {
      return new Response(PNG_1X1, { status: 200, headers: { "content-type": "image/png" } });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/hancode-image-d.png", prompt: "describe the image" },
      createEnabledContext(),
    );

    const blocks = result.content as unknown as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(3);
    expect(blocks[0]).toEqual({ type: "text", text: "Focus instruction: describe the image\n\n" });
    expect(blocks[2].type).toBe("image");
  });

  test("HTML path is unaffected by image support", async () => {
    const mockFetch = mock(async () => {
      return new Response("<html><body><p>hello</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await webFetchTool.execute({ url: "https://example.com/hancode-image-e.html" }, createEnabledContext());

    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("hello");
  });
});
