import type { WebConfig } from "../../config";
import { UserVisibleError } from "../../utils/errors";
import type { WebSearchAdapter, WebSearchOptions, WebSearchResult } from "./types";

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    snippet?: string;
  }>;
};

export class TavilySearchAdapter implements WebSearchAdapter {
  readonly name = "tavily";

  constructor(private readonly config: WebConfig) {}

  async search(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const apiKey = this.config.search.tavilyApiKey;
    if (!apiKey) throw new UserVisibleError("web_search is configured for Tavily but no Tavily API key is set. Set web.search.tavilyApiKey or TAVILY_API_KEY.");

    const response = await fetch(this.config.search.tavilyEndpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: options.maxResults,
        include_domains: options.allowedDomains,
        exclude_domains: options.blockedDomains,
      }),
      signal: options.signal,
    });

    if (!response.ok) throw new Error(`Tavily search failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json() as TavilyResponse;
    return (data.results ?? []).map(result => ({
      title: result.title || result.url || "Untitled result",
      url: result.url || "",
      snippet: result.content || result.snippet,
      source: this.name,
    })).filter(result => result.url);
  }
}
