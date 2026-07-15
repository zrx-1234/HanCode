import { describe, expect, test, afterEach, mock } from "bun:test";
import { webFetchTool } from "../src/tools/webFetch";
import type { ToolContext } from "../src/agent/types";
import type { WebConfig } from "../src/config";

function createEnabledWebConfig(): WebConfig {
  return {
    enabled: true,
    allowedDomains: [],
    blockedDomains: [],
    search: {
      enabled: true,
      adapter: "tavily",
      maxResults: 8,
      tavilyApiKey: "",
      tavilyEndpointUrl: "https://api.tavily.com/search",
      braveApiKey: "",
      searxngEndpointUrl: "",
    },
    fetch: {
      enabled: true,
      adapter: "http",
      timeoutMs: 30_000,
      maxBytes: 1_000_000,
      maxChars: 60_000,
      cacheTtlMs: 900_000,
      tavilyApiKey: "",
      tavilyEndpointUrl: "https://api.tavily.com/extract",
    },
  };
}

function createContext(): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    readState: new Map(),
    confirm: async () => false,
    audit: { log: async () => undefined },
    signal: new AbortController().signal,
    web: createEnabledWebConfig(),
    permissionMode: "normal",
  };
}

describe("web_fetch integration (mocked HTTP)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetches HTML and extracts readable text with title", async () => {
    const mockFetch = mock(async (url: string | URL | Request) => {
      expect(url.toString()).toBe("https://example.com/article");
      return new Response(
        `<html><head><title>Test Article</title><style>.hidden{display:none}</style></head>
         <body><h1>Hello World</h1><script>alert(1)</script><p>This is a paragraph.</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/article" },
      createContext(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("URL: https://example.com/article");
    expect(result.content).toContain("Title: Test Article");
    expect(result.content).toContain("Hello World");
    expect(result.content).toContain("This is a paragraph.");
    // Script and style should be stripped
    expect(result.content).not.toContain("alert(1)");
    expect(result.content).not.toContain(".hidden");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("fetches plain text content", async () => {
    const mockFetch = mock(async () => {
      return new Response("Plain text response", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/data.txt" },
      createContext(),
    );

    expect(result.content).toContain("Plain text response");
    expect(result.content).toContain("Content-Type: text/plain");
  });

  test("upgrades http to https", async () => {
    const mockFetch = mock(async (url: string | URL | Request) => {
      expect(url.toString()).toBe("https://example.com/page");
      return new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    await webFetchTool.execute({ url: "http://example.com/page" }, createContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("follows same-host redirects", async () => {
    let callCount = 0;
    const mockFetch = mock(async (url: string | URL | Request) => {
      callCount++;
      const urlStr = url.toString();
      if (urlStr === "https://example.com/old") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://example.com/new" },
        });
      }
      expect(urlStr).toBe("https://example.com/new");
      return new Response("<html><body>New page</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/old" },
      createContext(),
    );

    expect(result.content).toContain("New page");
    expect(callCount).toBe(2);
  });

  test("blocks cross-host redirects", async () => {
    const mockFetch = mock(async (url: string | URL | Request) => {
      if (url.toString() === "https://example.com/redirect") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://attacker.com/evil" },
        });
      }
      return new Response("evil", { status: 200 });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/redirect" },
      createContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Cross-host redirect blocked");
  });

  test("caches results and avoids duplicate fetches", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        `<html><body><p>Cached forever</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    globalThis.fetch = mockFetch as typeof fetch;
    const ctx = createContext();

    // First fetch hits the network
    const result1 = await webFetchTool.execute(
      { url: "https://example.com/cached-page" },
      ctx,
    );
    expect(result1.content).toContain("Cached forever");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second fetch should hit cache
    const result2 = await webFetchTool.execute(
      { url: "https://example.com/cached-page" },
      ctx,
    );
    expect(result2.content).toContain("Cached forever");
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, not 2
  });

  test("respects max_chars limit", async () => {
    const longText = "a".repeat(100_000);
    const mockFetch = mock(async () => {
      return new Response(
        `<html><body><p>${longText}</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/long", max_chars: 100 },
      createContext(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Output truncated");
  });

  test("returns error on HTTP failure", async () => {
    const mockFetch = mock(async () => {
      return new Response("Not Found", { status: 404 });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webFetchTool.execute(
      { url: "https://example.com/missing" },
      createContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("404");
  });
});
