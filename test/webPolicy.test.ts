import { describe, expect, test } from "bun:test";
import type { WebConfig } from "../src/config";
import { parseWebUrl, resolveSafeWebUrl, sameEffectiveHost } from "../src/security/webPolicy";

const web: WebConfig = {
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

describe("webPolicy", () => {
  test("upgrades http URLs to https", () => {
    expect(parseWebUrl("http://example.com/a").toString()).toBe("https://example.com/a");
  });

  test("rejects non-web protocols", async () => {
    await expect(resolveSafeWebUrl("file:///etc/passwd", web, { skipDnsLookup: true })).rejects.toThrow("Only HTTP/HTTPS");
    await expect(resolveSafeWebUrl("data:text/plain,hello", web, { skipDnsLookup: true })).rejects.toThrow("Only HTTP/HTTPS");
  });

  test("rejects credentials and local addresses", async () => {
    await expect(resolveSafeWebUrl("https://user:pass@example.com", web, { skipDnsLookup: true })).rejects.toThrow("credentials");
    await expect(resolveSafeWebUrl("https://localhost", web, { skipDnsLookup: true })).rejects.toThrow("Local hosts");
    await expect(resolveSafeWebUrl("https://127.0.0.1", web, { skipDnsLookup: true })).rejects.toThrow("Private");
    await expect(resolveSafeWebUrl("https://192.168.1.1", web, { skipDnsLookup: true })).rejects.toThrow("Private");
    await expect(resolveSafeWebUrl("https://[::1]", web, { skipDnsLookup: true })).rejects.toThrow("not allowed");
  });

  test("applies allowlist and blocklist", async () => {
    await expect(resolveSafeWebUrl("https://example.com", { ...web, allowedDomains: ["docs.example.com"] }, { skipDnsLookup: true })).rejects.toThrow("allowed list");
    await expect(resolveSafeWebUrl("https://docs.example.com", { ...web, allowedDomains: ["example.com"] }, { skipDnsLookup: true })).resolves.toBeTruthy();
    await expect(resolveSafeWebUrl("https://bad.example.com", { ...web, blockedDomains: ["example.com"] }, { skipDnsLookup: true })).rejects.toThrow("blocked");
  });

  test("compares www and bare hosts as same effective host", () => {
    expect(sameEffectiveHost("www.example.com", "example.com")).toBe(true);
    expect(sameEffectiveHost("docs.example.com", "example.com")).toBe(false);
  });
});
