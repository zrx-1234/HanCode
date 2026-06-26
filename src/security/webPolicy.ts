import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { WebConfig } from "../config";
import { UserVisibleError } from "../utils/errors";

export type WebPolicyOptions = {
  allowedDomains?: string[];
  blockedDomains?: string[];
  skipDnsLookup?: boolean;
};

export type SafeWebUrl = {
  url: URL;
  normalizedUrl: string;
};

export async function resolveSafeWebUrl(rawUrl: string, config: WebConfig, options: WebPolicyOptions = {}): Promise<SafeWebUrl> {
  const url = parseWebUrl(rawUrl);
  applyDomainPolicy(url.hostname, config.allowedDomains, config.blockedDomains);
  applyDomainPolicy(url.hostname, options.allowedDomains ?? [], options.blockedDomains ?? []);
  if (!options.skipDnsLookup) await assertPublicHost(url.hostname);
  return { url, normalizedUrl: url.toString() };
}

export async function isSafeWebUrl(rawUrl: string, config: WebConfig, options: WebPolicyOptions = {}): Promise<boolean> {
  try {
    await resolveSafeWebUrl(rawUrl, config, options);
    return true;
  } catch {
    return false;
  }
}

export function parseWebUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UserVisibleError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new UserVisibleError("Only HTTP/HTTPS public web URLs are allowed; HTTP is upgraded to HTTPS.");
  if (url.username || url.password) throw new UserVisibleError("URLs with embedded credentials are not allowed.");
  validateHostSyntax(url.hostname);
  return url;
}

export function sameEffectiveHost(a: string, b: string): boolean {
  return stripWww(a.toLowerCase()) === stripWww(b.toLowerCase());
}

export function redactWebSecrets(message: string, config: WebConfig): string {
  let redacted = message;
  const secrets = [
    config.search.tavilyApiKey,
    config.search.braveApiKey,
    config.fetch.tavilyApiKey,
  ].filter(secret => secret.length > 0);
  for (const secret of secrets) redacted = redacted.split(secret).join("[redacted]");
  return redacted;
}

function validateHostSyntax(hostname: string): void {
  if (!hostname) throw new UserVisibleError("URL host cannot be empty.");
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new UserVisibleError("Local hosts are not allowed for web tools.");
  }
  if (isPrivateIp(lower)) throw new UserVisibleError("Private, loopback, link-local, and multicast addresses are not allowed for web tools.");
  if (!lower.includes(".") && isIP(lower) === 0) throw new UserVisibleError("Single-label hosts are not allowed for web tools.");
}

function applyDomainPolicy(hostname: string, allowedDomains: string[], blockedDomains: string[]): void {
  const host = hostname.toLowerCase();
  const normalizedAllowed = allowedDomains.map(normalizeDomain).filter(Boolean);
  const normalizedBlocked = blockedDomains.map(normalizeDomain).filter(Boolean);

  if (normalizedAllowed.length > 0 && !normalizedAllowed.some(domain => domainMatches(host, domain))) {
    throw new UserVisibleError(`Domain is not in the allowed list: ${hostname}`);
  }
  if (normalizedBlocked.some(domain => domainMatches(host, domain))) {
    throw new UserVisibleError(`Domain is blocked: ${hostname}`);
  }
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new UserVisibleError("Private, loopback, link-local, and multicast addresses are not allowed for web tools.");
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new UserVisibleError(`Could not resolve host: ${hostname}`);
  for (const address of addresses) {
    if (isPrivateIp(address.address)) {
      throw new UserVisibleError(`Host resolves to a private or local address: ${hostname}`);
    }
  }
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^\*\./, "");
  }
}

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function isPrivateIp(value: string): boolean {
  const version = isIP(value);
  if (version === 4) return isPrivateIpv4(value);
  if (version === 6) return isPrivateIpv6(value);
  return false;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(value: string): boolean {
  const lower = value.toLowerCase();
  return lower === "::"
    || lower === "::1"
    || lower.startsWith("fc")
    || lower.startsWith("fd")
    || lower.startsWith("fe8")
    || lower.startsWith("fe9")
    || lower.startsWith("fea")
    || lower.startsWith("feb")
    || lower.startsWith("ff");
}
