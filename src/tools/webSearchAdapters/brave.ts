import type { WebConfig } from "../../config";
import { UserVisibleError } from "../../utils/errors";
import type { WebSearchAdapter, WebSearchOptions, WebSearchResult } from "./types";

type BraveResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
};

export class BraveSearchAdapter implements WebSearchAdapter {
  readonly name = "brave";

  constructor(private readonly config: WebConfig) {}

  async search(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const apiKey = this.config.search.braveApiKey;
    if (!apiKey) throw new UserVisibleError("web_search is configured for Brave but no Brave API key is set. Set web.search.braveApiKey or BRAVE_SEARCH_API_KEY.");

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(options.maxResults));

    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: options.signal,
    });

    if (!response.ok) throw new Error(`Brave search failed with HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json() as BraveResponse;
    return (data.web?.results ?? []).map(result => ({
      title: result.title || result.url || "Untitled result",
      url: result.url || "",
      snippet: result.description,
      source: this.name,
    })).filter(result => result.url);
  }
}
