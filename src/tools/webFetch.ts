import type { WebConfig } from "../config";
import { limitOutput } from "../security/outputLimit";
import { redactWebSecrets, resolveSafeWebUrl, sameEffectiveHost } from "../security/webPolicy";
import type { HanCodeTool } from "../agent/types";
import { webFetchInput } from "./schemas";

type CacheEntry = {
  expiresAt: number;
  content: string;
};

const cache = new Map<string, CacheEntry>();
const MAX_REDIRECTS = 5;

export const webFetchTool: HanCodeTool = {
  definition: {
    name: "web_fetch",
    description: "Fetch a public HTTP/HTTPS URL and return readable text. Public web only: no authentication, cookies, custom headers, private network, or JavaScript rendering.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "Public HTTP/HTTPS URL to fetch. HTTP is upgraded to HTTPS." },
        prompt: { type: "string", description: "Optional focus instruction for how to use the fetched content." },
        max_chars: { type: "integer", description: "Maximum content characters to return." },
      },
      required: ["url"],
    },
  },
  async execute(input, ctx) {
    const parsed = webFetchInput.parse(input);
    if (!ctx.web.enabled) return { content: "web_fetch is disabled. Set web.enabled=true in hancode.config.json to enable public web tools.", isError: true };
    if (!ctx.web.fetch.enabled) return { content: "web_fetch is disabled by web.fetch.enabled=false in hancode.config.json.", isError: true };

    try {
      const safe = await resolveSafeWebUrl(parsed.url, ctx.web);
      const maxChars = Math.min(parsed.max_chars ?? ctx.web.fetch.maxChars, ctx.web.fetch.maxChars);
      const content = ctx.web.fetch.adapter === "tavily"
        ? await fetchWithTavily(safe.normalizedUrl, ctx.web, ctx.signal, maxChars)
        : await fetchWithHttp(safe.normalizedUrl, ctx.web, ctx.signal, maxChars);
      const focus = parsed.prompt ? `Focus instruction: ${parsed.prompt}\n\n` : "";
      return { content: focus + content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: redactWebSecrets(message, ctx.web), isError: true };
    }
  },
};

export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = decodeHtmlEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|main|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? decodeHtmlEntities(stripTags(title)).trim() : undefined, text };
}

async function fetchWithHttp(url: string, config: WebConfig, signal: AbortSignal, maxChars: number): Promise<string> {
  const cached = getCached(url);
  if (cached) return cached;

  const result = await fetchFollowingSafeRedirects(url, config, signal);
  const contentType = result.response.headers.get("content-type") ?? "";
  const raw = await readResponseText(result.response, config.fetch.maxBytes);
  const extracted = contentType.toLowerCase().includes("html") ? htmlToText(raw) : { text: raw.trim(), title: undefined };
  const content = formatFetchResult({
    requestedUrl: url,
    finalUrl: result.finalUrl,
    status: result.response.status,
    contentType,
    title: extracted.title,
    body: limitOutput(extracted.text, maxChars),
  });

  setCached(url, content, config.fetch.cacheTtlMs);
  return content;
}

async function fetchWithTavily(url: string, config: WebConfig, signal: AbortSignal, maxChars: number): Promise<string> {
  const apiKey = config.fetch.tavilyApiKey;
  if (!apiKey) throw new Error("web_fetch is configured for Tavily but no Tavily API key is set. Set web.fetch.tavilyApiKey or TAVILY_API_KEY.");

  const response = await fetch(config.fetch.tavilyEndpointUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ urls: [url] }),
    signal,
  });
  if (!response.ok) throw new Error(`Tavily fetch failed with HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json() as { results?: Array<{ url?: string; raw_content?: string; content?: string; title?: string }> };
  const result = data.results?.[0];
  if (!result) throw new Error("Tavily fetch returned no content.");
  return formatFetchResult({
    requestedUrl: url,
    finalUrl: result.url || url,
    status: response.status,
    contentType: "tavily/extract",
    title: result.title,
    body: limitOutput(result.raw_content || result.content || "", maxChars),
  });
}

async function fetchFollowingSafeRedirects(url: string, config: WebConfig, signal: AbortSignal): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), config.fetch.timeoutMs);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        headers: {
          "User-Agent": "HanCode/0.1 public-web-fetch",
          "Accept": "text/html,text/plain,application/json,application/xml,*/*;q=0.8",
        },
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`HTTP ${response.status} redirect did not include a Location header.`);
        const next = new URL(location, current).toString();
        const safeNext = await resolveSafeWebUrl(next, config);
        const currentHost = new URL(current).hostname;
        if (!sameEffectiveHost(currentHost, safeNext.url.hostname)) {
          throw new Error(`Cross-host redirect blocked: ${current} -> ${safeNext.normalizedUrl}`);
        }
        current = safeNext.normalizedUrl;
        continue;
      }

      if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}: ${response.statusText}`);
      return { response, finalUrl: current };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
  throw new Error(`Too many redirects while fetching ${url}.`);
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Fetch response exceeded maxBytes (${maxBytes}).`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function formatFetchResult(input: { requestedUrl: string; finalUrl: string; status: number; contentType: string; title?: string; body: string }): string {
  return [
    `URL: ${input.requestedUrl}`,
    `Final URL: ${input.finalUrl}`,
    `Status: ${input.status}`,
    `Content-Type: ${input.contentType || "unknown"}`,
    input.title ? `Title: ${input.title}` : undefined,
    "",
    "Content:",
    input.body,
  ].filter(line => line !== undefined).join("\n");
}

function getCached(url: string): string | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(url);
    return undefined;
  }
  return entry.content;
}

function setCached(url: string, content: string, ttlMs: number): void {
  cache.set(url, { content, expiresAt: Date.now() + ttlMs });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}
