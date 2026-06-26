import type { WebConfig } from "../../config";
import { UserVisibleError } from "../../utils/errors";
import type { WebSearchAdapter, WebSearchOptions, WebSearchResult } from "./types";

type SearxngResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    snippet?: string;
  }>;
};

export class SearxngSearchAdapter implements WebSearchAdapter {
  readonly name = "searxng";

  constructor(private readonly config: WebConfig) {}

  async search(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const endpoint = this.config.search.searxngEndpointUrl;
    if (!endpoint) throw new UserVisibleError("web_search is configured for SearXNG but no endpoint is set. Set web.search.searxngEndpointUrl or SEARXNG_ENDPOINT_URL.");

    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "auto");

    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "User-Agent": "HanCode/0.1 public-web-search",
      },
      signal: options.signal,
    });

    if (!response.ok) throw new Error(`SearXNG search failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json() as SearxngResponse;
    return (data.results ?? []).slice(0, options.maxResults).map(result => ({
      title: result.title || result.url || "Untitled result",
      url: result.url || "",
      snippet: result.content || result.snippet,
      source: this.name,
    })).filter(result => result.url);
  }
}
