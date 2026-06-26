import { describe, expect, test } from "bun:test";
import type { ToolContext } from "../src/agent/types";
import type { WebConfig } from "../src/config";
import { webSearchTool } from "../src/tools/webSearch";

const web: WebConfig = {
  enabled: true,
  allowedDomains: [],
  blockedDomains: [],
  search: {
    enabled: true,
    adapter: "tavily",
    maxResults: 3,
    tavilyApiKey: "secret-token",
    tavilyEndpointUrl: "https://api.tavily.test/search",
    braveApiKey: "",
    searxngEndpointUrl: "https://searxng.example.com/search",
  },
  fetch: {
    enabled: true,
    adapter: "http",
    timeoutMs: 30_000,
    maxBytes: 1_000_000,
    maxChars: 60_000,
    cacheTtlMs: 900_000,
    tavilyApiKey: "secret-token",
    tavilyEndpointUrl: "https://api.tavily.test/extract",
  },
};

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    readState: new Map(),
    confirm: async () => false,
    audit: { log: async () => undefined },
    signal: new AbortController().signal,
    web,
    ...overrides,
  };
}

describe("webSearchTool", () => {
  test("rejects simultaneous allowed and blocked domains", async () => {
    await expect(webSearchTool.execute({ query: "weather", allowed_domains: ["example.com"], blocked_domains: ["bad.com"] }, createContext())).rejects.toThrow("allowed_domains and blocked_domains");
  });

  test("reports disabled web search", async () => {
    const result = await webSearchTool.execute({ query: "weather" }, createContext({ web: { ...web, enabled: false } }));

    expect(result.isError).toBe(true);
    expect(result.content).toContain("web_search is disabled");
  });

  test("reports missing SearXNG endpoint", async () => {
    const result = await webSearchTool.execute({ query: "weather" }, createContext({
      web: { ...web, search: { ...web.search, adapter: "searxng", searxngEndpointUrl: "" } },
    }));

    expect(result.isError).toBe(true);
    expect(result.content).toContain("SearXNG");
  });
});
