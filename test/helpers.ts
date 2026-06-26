import type { WebConfig } from "../src/config";

export const testWebConfig: WebConfig = {
  enabled: false,
  allowedDomains: [],
  blockedDomains: [],
  search: {
    enabled: false,
    adapter: "tavily",
    maxResults: 8,
    tavilyApiKey: "",
    tavilyEndpointUrl: "https://api.tavily.com/search",
    braveApiKey: "",
    searxngEndpointUrl: "",
  },
  fetch: {
    enabled: false,
    adapter: "http",
    timeoutMs: 30_000,
    maxBytes: 1_000_000,
    maxChars: 60_000,
    cacheTtlMs: 900_000,
    tavilyApiKey: "",
    tavilyEndpointUrl: "https://api.tavily.com/extract",
  },
};
