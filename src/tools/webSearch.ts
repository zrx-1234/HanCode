import type { HanCodeTool } from "../agent/types";
import { limitOutput } from "../security/outputLimit";
import { isSafeWebUrl, redactWebSecrets } from "../security/webPolicy";
import { createWebSearchAdapter } from "./webSearchAdapters";
import { webSearchInput } from "./schemas";

const DEFAULT_OUTPUT_LIMIT = 40_000;

export const webSearchTool: HanCodeTool = {
  definition: {
    name: "web_search",
    description: "Search the public web for current or external information. Use web_fetch on selected result URLs when detailed source content is needed. Cite source URLs in final answers.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Search query." },
        allowed_domains: { type: "array", items: { type: "string" }, description: "Optional domain allowlist for search results." },
        blocked_domains: { type: "array", items: { type: "string" }, description: "Optional domain blocklist for search results." },
        num_results: { type: "integer", description: "Maximum number of results to return. Defaults to configured maxResults." },
      },
      required: ["query"],
    },
  },
  async execute(input, ctx) {
    const parsed = webSearchInput.parse(input);
    if (!ctx.web.enabled) return { content: "web_search is disabled. Set web.enabled=true in hancode.config.json to enable public web tools.", isError: true };
    if (!ctx.web.search.enabled) return { content: "web_search is disabled by web.search.enabled=false in hancode.config.json.", isError: true };

    const maxResults = Math.min(parsed.num_results ?? ctx.web.search.maxResults, ctx.web.search.maxResults);
    const adapter = createWebSearchAdapter(ctx.web);

    try {
      const results = await adapter.search(parsed.query, {
        maxResults,
        allowedDomains: parsed.allowed_domains,
        blockedDomains: parsed.blocked_domains,
        signal: ctx.signal,
      });
      const safeResults = [];
      for (const result of results) {
        if (safeResults.length >= maxResults) break;
        if (await isSafeWebUrl(result.url, ctx.web, {
          allowedDomains: parsed.allowed_domains,
          blockedDomains: parsed.blocked_domains,
        })) {
          safeResults.push(result);
        }
      }

      const lines = [`Search query: ${parsed.query}`, `Provider: ${adapter.name}`, ""];
      if (safeResults.length === 0) {
        lines.push("No safe search results were returned.");
      } else {
        safeResults.forEach((result, index) => {
          lines.push(`${index + 1}. ${result.title}`);
          lines.push(`URL: ${result.url}`);
          if (result.snippet) lines.push(`Snippet: ${result.snippet}`);
          lines.push("");
        });
        lines.push("Use web_fetch on selected URLs when detailed source content is needed. Cite source URLs in final answers.");
      }

      return { content: limitOutput(lines.join("\n"), DEFAULT_OUTPUT_LIMIT) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: redactWebSecrets(message, ctx.web), isError: true };
    }
  },
};
