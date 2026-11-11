import { describe, expect, test } from "bun:test";
import { buildThinkingParam } from "../src/agent/thinking";
import type { EffortConfig } from "../src/config";

const OFFICIAL = "https://api.anthropic.com";
const ARK = "https://ark.cn-beijing.volces.com/api/coding";

describe("buildThinkingParam", () => {
  test("official endpoint uses adaptive in auto mode", () => {
    expect(buildThinkingParam(OFFICIAL, "auto", "auto")).toEqual({ type: "adaptive", display: "summarized" });
    // Trailing slash and a path component must not change the decision.
    expect(buildThinkingParam("https://api.anthropic.com/", "auto", "high").type).toBe("adaptive");
  });

  test("empty or unparsable baseURL counts as the official endpoint", () => {
    expect(buildThinkingParam("", "auto", "auto").type).toBe("adaptive");
    expect(buildThinkingParam("not a url", "auto", "auto").type).toBe("adaptive");
  });

  test("third-party gateway uses the budget syntax in auto mode", () => {
    const param = buildThinkingParam(ARK, "auto", "high");
    expect(param.type).toBe("enabled");
    if (param.type === "enabled") {
      expect(param.budget_tokens).toBe(16_384);
      expect(param.display).toBe("summarized");
    }
  });

  test("budget_tokens maps from effort", () => {
    const cases: Array<[EffortConfig, number]> = [
      ["auto", 16_384],
      ["low", 4_096],
      ["medium", 8_192],
      ["high", 16_384],
      ["xhigh", 32_768],
      ["max", 48_000],
    ];
    for (const [effort, budget] of cases) {
      const param = buildThinkingParam(ARK, "budget", effort);
      expect(param.type).toBe("enabled");
      if (param.type === "enabled") expect(param.budget_tokens).toBe(budget);
    }
  });

  test("explicit modes skip endpoint detection", () => {
    // adaptive forced even on a gateway URL
    expect(buildThinkingParam(ARK, "adaptive", "auto").type).toBe("adaptive");
    // budget forced even on the official endpoint
    expect(buildThinkingParam(OFFICIAL, "budget", "low").type).toBe("enabled");
  });

  test("budget stays within API constraints (>=1024, < max_tokens=64000)", () => {
    for (const effort of ["auto", "low", "medium", "high", "xhigh", "max"] as EffortConfig[]) {
      const param = buildThinkingParam(ARK, "budget", effort);
      if (param.type === "enabled") {
        expect(param.budget_tokens).toBeGreaterThanOrEqual(1_024);
        expect(param.budget_tokens).toBeLessThan(64_000);
      } else {
        throw new Error(`expected budget thinking for effort=${effort}`);
      }
    }
  });
});
