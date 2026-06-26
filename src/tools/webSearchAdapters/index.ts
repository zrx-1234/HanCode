import type { WebConfig } from "../../config";
import { BraveSearchAdapter } from "./brave";
import { SearxngSearchAdapter } from "./searxng";
import { TavilySearchAdapter } from "./tavily";
import type { WebSearchAdapter } from "./types";

export function createWebSearchAdapter(config: WebConfig): WebSearchAdapter {
  if (config.search.adapter === "brave") return new BraveSearchAdapter(config);
  if (config.search.adapter === "searxng") return new SearxngSearchAdapter(config);
  return new TavilySearchAdapter(config);
}
