import type { EffortConfig } from "../config";

/** How the `thinking` request parameter is selected. */
export type ThinkingMode = "auto" | "adaptive" | "budget";

/**
 * `budget_tokens` value sent in `budget` mode, mapped from the `effort`
 * setting. Must stay >= 1024 and below the loop's `max_tokens` (64 000).
 */
const EFFORT_TO_BUDGET_TOKENS: Record<EffortConfig, number> = {
  auto: 16_384,
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  xhigh: 32_768,
  max: 48_000,
};

/** Shape sent on the official Anthropic API (current models). */
export type AdaptiveThinkingParam = { type: "adaptive"; display: "summarized" };

/** Shape sent on third-party Anthropic-compatible gateways (older syntax). */
export type BudgetThinkingParam = { type: "enabled"; budget_tokens: number; display: "summarized" };

export type ThinkingParam = AdaptiveThinkingParam | BudgetThinkingParam;

/**
 * Builds the `thinking` request parameter.
 *
 * `adaptive` is only understood by the official Anthropic API; gateways such
 * as Volcano Ark reject it with a 400 `InvalidParameter`. In `auto` mode we
 * therefore pick the syntax by endpoint: official API → `adaptive`, anything
 * else → the older `{type: "enabled", budget_tokens}` form with the budget
 * mapped from `effort`. Explicit modes skip the detection.
 */
export function buildThinkingParam(baseURL: string, mode: ThinkingMode, effort: EffortConfig): ThinkingParam {
  const useAdaptive = mode === "adaptive" || (mode === "auto" && isOfficialAnthropicEndpoint(baseURL));
  if (useAdaptive) {
    return { type: "adaptive", display: "summarized" };
  }
  return { type: "enabled", budget_tokens: EFFORT_TO_BUDGET_TOKENS[effort] ?? EFFORT_TO_BUDGET_TOKENS.auto, display: "summarized" };
}

/** True when `baseURL` points at the official Anthropic API (empty/unparsable counts too). */
function isOfficialAnthropicEndpoint(baseURL: string): boolean {
  if (!baseURL) return true;
  try {
    return new URL(baseURL).hostname === "api.anthropic.com";
  } catch {
    // A malformed URL would fail before reaching the model anyway; treat it
    // like the default endpoint so the modern parameter is used.
    return true;
  }
}
