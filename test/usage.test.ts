import { describe, expect, test } from "bun:test";
import { addUsage, createUsageTotals, totalInputTokens, totalUsageTokens } from "../src/agent/usage";

describe("createUsageTotals", () => {
  test("initializes all counters to zero", () => {
    const totals = createUsageTotals();
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.cacheCreationInputTokens).toBe(0);
    expect(totals.cacheReadInputTokens).toBe(0);
  });
});

describe("addUsage", () => {
  test("adds all token types", () => {
    const totals = createUsageTotals();
    addUsage(totals, {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
    });
    expect(totals.inputTokens).toBe(10);
    expect(totals.outputTokens).toBe(5);
    expect(totals.cacheCreationInputTokens).toBe(2);
    expect(totals.cacheReadInputTokens).toBe(3);
  });

  test("handles null/undefined usage gracefully", () => {
    const totals = createUsageTotals();
    addUsage(totals, undefined);
    expect(totals.inputTokens).toBe(0);
  });

  test("handles null token fields", () => {
    const totals = createUsageTotals();
    addUsage(totals, { input_tokens: null, output_tokens: 5 });
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(5);
  });

  test("accumulates across multiple calls", () => {
    const totals = createUsageTotals();
    addUsage(totals, { input_tokens: 10 });
    addUsage(totals, { input_tokens: 20 });
    expect(totals.inputTokens).toBe(30);
  });
});

describe("totalUsageTokens", () => {
  test("sums all token categories", () => {
    const totals = createUsageTotals();
    addUsage(totals, { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 });
    expect(totalUsageTokens(totals)).toBe(20);
  });
});

describe("totalInputTokens", () => {
  test("sums input + cache creation + cache read", () => {
    const totals = createUsageTotals();
    addUsage(totals, { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 });
    expect(totalInputTokens(totals)).toBe(15);
  });
});
