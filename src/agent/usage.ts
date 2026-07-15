import type { UsageTotals } from "./types";

export type MessageUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function createUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(totals: UsageTotals, usage: MessageUsage | undefined): void {
  if (!usage) return;
  totals.inputTokens += usage.input_tokens ?? 0;
  totals.outputTokens += usage.output_tokens ?? 0;
  totals.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
  totals.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
}

export function totalUsageTokens(usage: UsageTotals): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

export function totalInputTokens(usage: UsageTotals): number {
  return usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

export function mergeUsage(totals: UsageTotals, source: UsageTotals): void {
  totals.inputTokens += source.inputTokens;
  totals.outputTokens += source.outputTokens;
  totals.cacheCreationInputTokens += source.cacheCreationInputTokens;
  totals.cacheReadInputTokens += source.cacheReadInputTokens;
}
