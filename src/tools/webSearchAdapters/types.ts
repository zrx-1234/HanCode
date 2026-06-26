export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
};

export type WebSearchOptions = {
  maxResults: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  signal: AbortSignal;
};

export type WebSearchAdapter = {
  readonly name: string;
  search(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
};
