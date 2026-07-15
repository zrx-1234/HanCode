import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { webSearchTool } from "../src/tools/webSearch";
import type { ToolContext } from "../src/agent/types";
import type { WebConfig } from "../src/config";

function createEnabledWebConfig(overrides: Partial<WebConfig> = {}): WebConfig {
  return {
    enabled: true,
    allowedDomains: [],
    blockedDomains: [],
    search: {
      enabled: true,
      adapter: "tavily",
      maxResults: 8,
      tavilyApiKey: "test-api-key",
      tavilyEndpointUrl: "https://api.tavily.test/search",
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
      tavilyEndpointUrl: "https://api.tavily.test/extract",
    },
    ...overrides,
  };
}

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    readState: new Map(),
    confirm: async () => false,
    audit: { log: async () => undefined },
    signal: new AbortController().signal,
    web: createEnabledWebConfig(),
    permissionMode: "normal",
    ...overrides,
  };
}

describe("web_search integration (mocked Tavily)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls Tavily API with correct parameters and formats results", async () => {
    const mockFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url.toString()).toBe("https://api.tavily.test/search");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.query).toBe("bun test runner");
      expect(body.max_results).toBe(5);
      expect(body.include_domains).toBeUndefined();
      expect(body.exclude_domains).toBeUndefined();

      return new Response(
        JSON.stringify({
          results: [
            { title: "Bun Test Docs", url: "https://bun.sh/docs/cli/test", content: "Bun has a built-in test runner" },
            { title: "GitHub Bun", url: "https://github.com/oven-sh/bun", content: "Bun is a fast JavaScript runtime" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webSearchTool.execute(
      { query: "bun test runner", num_results: 5 },
      createContext(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Bun Test Docs");
    expect(result.content).toContain("https://bun.sh/docs/cli/test");
    expect(result.content).toContain("GitHub Bun");
    expect(result.content).toContain("Provider: tavily");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("passes allowed_domains to API", async () => {
    const mockFetch = mock(async (_url, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.include_domains).toEqual(["bun.sh"]);
      expect(body.exclude_domains).toBeUndefined();

      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    await webSearchTool.execute(
      { query: "test", allowed_domains: ["bun.sh"] },
      createContext(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("passes blocked_domains to API", async () => {
    const mockFetch = mock(async (_url, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.include_domains).toBeUndefined();
      expect(body.exclude_domains).toEqual(["spam.com"]);

      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    await webSearchTool.execute(
      { query: "test", blocked_domains: ["spam.com"] },
      createContext(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("filters out blocked domains from results", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          results: [
            { title: "Bun Docs", url: "https://bun.sh/docs", content: "helpful" },
            { title: "Bad Site", url: "https://evil.example.com/ads", content: "tracking" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const ctx = createContext({
      web: createEnabledWebConfig({ blockedDomains: ["evil.example.com"] }),
    });

    const result = await webSearchTool.execute({ query: "example" }, ctx);

    expect(result.content).toContain("Bun Docs");
    expect(result.content).not.toContain("Bad Site");
    expect(result.content).not.toContain("evil.example.com");
  });

  test("returns error on HTTP failure and redacts API key", async () => {
    const mockFetch = mock(async () => {
      return new Response("Rate limited", { status: 429 });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    const result = await webSearchTool.execute({ query: "test" }, createContext());

    expect(result.isError).toBe(true);
    expect(result.content).toContain("429");
    // API key should be redacted from error messages
    expect(result.content).not.toContain("test-api-key");
  });

  test("caps num_results to configured maxResults", async () => {
    const mockFetch = mock(async (_url, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      // Config maxResults is 8, so even requesting 100 should send 8
      expect(body.max_results).toBe(8);
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    globalThis.fetch = mockFetch as typeof fetch;

    await webSearchTool.execute({ query: "test", num_results: 100 }, createContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
