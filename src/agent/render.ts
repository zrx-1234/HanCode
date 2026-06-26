import type { UsageTotals } from "./types";
import { totalInputTokens, totalUsageTokens } from "./usage";

export type RunningIndicator = {
  stop: () => void;
};

export function renderRunning(): RunningIndicator {
  if (!process.stdout.isTTY) return { stop: () => {} };

  let dots = 0;
  let stopped = false;
  const maxDots = 10;
  const render = (): void => {
    const text = `running${".".repeat(dots)}`;
    process.stdout.write(`\r${text.padEnd("running".length + maxDots, " ")}`);
    dots = dots === maxDots ? 0 : dots + 1;
  };

  render();
  const timer = setInterval(render, 1000);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write(`\r${" ".repeat("running".length + maxDots)}\r`);
    },
  };
}

export function renderToolStart(name: string, input: unknown): void {
  console.log(`\n[tool] ${name} ${JSON.stringify(input)}`);
}

export function renderToolEnd(name: string, isError: boolean, content?: string): void {
  console.log(`[tool] ${name} ${isError ? "failed" : "done"}`);
  if (isError && content) console.log(`\n${content}`);
  console.log();
}

export function renderUsageSummary(taskUsage: UsageTotals, sessionUsage: UsageTotals): void {
  console.log(`[HanCode usage] task ${formatUsage(taskUsage)} · session ${formatUsage(sessionUsage)}`);
}

function formatUsage(usage: UsageTotals): string {
  const cacheTokens = usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  const cachePart = cacheTokens > 0
    ? `, cache read/write ${formatNumber(usage.cacheReadInputTokens)}/${formatNumber(usage.cacheCreationInputTokens)}`
    : "";
  return `${formatNumber(totalUsageTokens(usage))} tokens (in/out ${formatNumber(totalInputTokens(usage))}/${formatNumber(usage.outputTokens)}${cachePart})`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
