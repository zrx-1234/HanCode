import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type EffortConfig = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type WebSearchAdapterConfig = "tavily" | "brave" | "searxng";
export type WebFetchAdapterConfig = "http" | "tavily";

export type WebConfig = {
  enabled: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
  search: {
    enabled: boolean;
    adapter: WebSearchAdapterConfig;
    maxResults: number;
    tavilyApiKey: string;
    tavilyEndpointUrl: string;
    braveApiKey: string;
    searxngEndpointUrl: string;
  };
  fetch: {
    enabled: boolean;
    adapter: WebFetchAdapterConfig;
    timeoutMs: number;
    maxBytes: number;
    maxChars: number;
    cacheTtlMs: number;
    tavilyApiKey: string;
    tavilyEndpointUrl: string;
  };
};

export type HanCodeConfig = {
  workspaceRoot: string;
  apiKey: string;
  model: string;
  baseURL: string;
  maxTurns: number;
  effort: EffortConfig;
  web: WebConfig;
};

type ConfigFile = {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  maxTurns?: number;
  effort?: string;
  web?: WebConfigFile;
};

type WebConfigFile = {
  enabled?: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  search?: {
    enabled?: boolean;
    adapter?: string;
    maxResults?: number;
    tavilyApiKey?: string;
    tavilyEndpointUrl?: string;
    braveApiKey?: string;
    searxngEndpointUrl?: string;
  };
  fetch?: {
    enabled?: boolean;
    adapter?: string;
    timeoutMs?: number;
    maxBytes?: number;
    maxChars?: number;
    cacheTtlMs?: number;
    tavilyApiKey?: string;
    tavilyEndpointUrl?: string;
  };
};

export function loadConfig(workspacePath: string): HanCodeConfig {
  const workspaceRoot = resolveWorkspaceRoot(workspacePath);
  const configFile = readConfigFile();
  return {
    workspaceRoot,
    apiKey: configFile.apiKey ?? "",
    model: configFile.model || "claude-opus-4-8",
    baseURL: configFile.baseURL || "https://api.anthropic.com",
    maxTurns: configFile.maxTurns ?? 20,
    effort: parseEffort(configFile.effort),
    web: parseWebConfig(configFile.web),
  };
}

export function resolveWorkspaceRoot(workspacePath: string): string {
  const candidate = resolve(process.cwd(), workspacePath.trim() || ".");
  const real = realpathSync(candidate);
  if (!statSync(real).isDirectory()) throw new Error(`Workspace is not a directory: ${workspacePath}`);
  return real;
}

function readConfigFile(): ConfigFile {
  const path = join(getAppRoot(), "hancode.config.json");
  if (!existsSync(path)) return {};

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ConfigFile;
  if (parsed.maxTurns !== undefined && (!Number.isInteger(parsed.maxTurns) || parsed.maxTurns <= 0)) {
    throw new Error("hancode.config.json: maxTurns must be a positive integer.");
  }
  if (parsed.effort !== undefined) parseEffort(parsed.effort);
  validateStringArray(parsed.web?.allowedDomains, "web.allowedDomains");
  validateStringArray(parsed.web?.blockedDomains, "web.blockedDomains");
  validatePositiveInteger(parsed.web?.search?.maxResults, "web.search.maxResults");
  validatePositiveInteger(parsed.web?.fetch?.timeoutMs, "web.fetch.timeoutMs");
  validatePositiveInteger(parsed.web?.fetch?.maxBytes, "web.fetch.maxBytes");
  validatePositiveInteger(parsed.web?.fetch?.maxChars, "web.fetch.maxChars");
  validatePositiveInteger(parsed.web?.fetch?.cacheTtlMs, "web.fetch.cacheTtlMs");
  if (parsed.web?.search?.adapter !== undefined) parseWebSearchAdapter(parsed.web.search.adapter);
  if (parsed.web?.fetch?.adapter !== undefined) parseWebFetchAdapter(parsed.web.fetch.adapter);
  return parsed;
}

function parseEffort(value: string | undefined): EffortConfig {
  if (value === undefined || value === "") return "auto";
  if (value === "auto" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") return value;
  throw new Error("hancode.config.json: effort must be one of auto, low, medium, high, xhigh, max.");
}

function parseWebConfig(value: WebConfigFile | undefined): WebConfig {
  const enabled = value?.enabled ?? false;
  return {
    enabled,
    allowedDomains: value?.allowedDomains ?? [],
    blockedDomains: value?.blockedDomains ?? [],
    search: {
      enabled: value?.search?.enabled ?? enabled,
      adapter: parseWebSearchAdapter(value?.search?.adapter),
      maxResults: value?.search?.maxResults ?? 8,
      tavilyApiKey: value?.search?.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? "",
      tavilyEndpointUrl: value?.search?.tavilyEndpointUrl || "https://api.tavily.com/search",
      braveApiKey: value?.search?.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY ?? "",
      searxngEndpointUrl: value?.search?.searxngEndpointUrl || process.env.SEARXNG_ENDPOINT_URL || "",
    },
    fetch: {
      enabled: value?.fetch?.enabled ?? enabled,
      adapter: parseWebFetchAdapter(value?.fetch?.adapter),
      timeoutMs: value?.fetch?.timeoutMs ?? 30_000,
      maxBytes: value?.fetch?.maxBytes ?? 1_000_000,
      maxChars: value?.fetch?.maxChars ?? 60_000,
      cacheTtlMs: value?.fetch?.cacheTtlMs ?? 900_000,
      tavilyApiKey: value?.fetch?.tavilyApiKey ?? value?.search?.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? "",
      tavilyEndpointUrl: value?.fetch?.tavilyEndpointUrl || "https://api.tavily.com/extract",
    },
  };
}

function parseWebSearchAdapter(value: string | undefined): WebSearchAdapterConfig {
  if (value === undefined || value === "") return "tavily";
  if (value === "tavily" || value === "brave" || value === "searxng") return value;
  throw new Error("hancode.config.json: web.search.adapter must be one of tavily, brave, searxng.");
}

function parseWebFetchAdapter(value: string | undefined): WebFetchAdapterConfig {
  if (value === undefined || value === "") return "http";
  if (value === "http" || value === "tavily") return value;
  throw new Error("hancode.config.json: web.fetch.adapter must be one of http, tavily.");
}

function validateStringArray(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`hancode.config.json: ${name} must be an array of non-empty strings.`);
  }
}

function validatePositiveInteger(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`hancode.config.json: ${name} must be a positive integer.`);
  }
}

/**
 * Directory that holds `hancode.config.json`.
 *
 * Normally the project root (resolved relative to this source file). When the
 * sidecar is compiled into a standalone executable (`bun build --compile`),
 * `import.meta.url` points into the virtual bunfs filesystem, so the desktop
 * app passes the real directory (Electron's userData) via HANCODE_CONFIG_DIR.
 */
function getAppRoot(): string {
  if (process.env.HANCODE_CONFIG_DIR) return resolve(process.env.HANCODE_CONFIG_DIR);
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}
