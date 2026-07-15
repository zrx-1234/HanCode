import { describe, expect, test } from "bun:test";
import { agentTool } from "../src/tools/agent";
import type { SubAgentResult, ToolContext } from "../src/agent/types";
import { testWebConfig } from "./helpers";

function createContext(runSubAgent?: ToolContext["runSubAgent"]): ToolContext {
  return {
    workspaceRoot: "/tmp/hancode-agent-test",
    readState: new Map(),
    confirm: async () => true,
    audit: { log: async () => {} },
    signal: new AbortController().signal,
    web: testWebConfig,
    permissionMode: "normal",
    allowedTools: ["agent", "read_file"],
    runSubAgent,
  };
}

function makeResult(overrides: Partial<SubAgentResult> & { id: string }): SubAgentResult {
  return {
    success: true,
    output: "done",
    usage: { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ...overrides,
  };
}

describe("agent tool", () => {
  test("returns error when sub-agent factory is unavailable", async () => {
    const result = await agentTool.execute({ agents: [{ prompt: "hello" }] }, createContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not available");
  });

  test("single sub-agent returns formatted result", async () => {
    const runSubAgent = async () => makeResult({ id: "research", output: "Found 3 files." });
    const result = await agentTool.execute({ agents: [{ prompt: "research files" }] }, createContext(runSubAgent));

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Completed 1 sub-agent(s)");
    expect(result.content).toContain("--- research ---");
    expect(result.content).toContain("Found 3 files.");
  });

  test("multiple sub-agents run concurrently and results are merged", async () => {
    const calls: string[] = [];
    const runSubAgent = async (config: { id?: string; prompt: string }) => {
      calls.push(config.prompt);
      return makeResult({ id: config.id ?? "unknown", output: `Result for ${config.prompt}` });
    };

    const result = await agentTool.execute(
      {
        agents: [
          { id: "a", prompt: "task one" },
          { id: "b", prompt: "task two" },
        ],
      },
      createContext(runSubAgent),
    );

    expect(calls).toContain("task one");
    expect(calls).toContain("task two");
    expect(result.isError).toBe(false);
    expect(result.content).toContain("--- a ---");
    expect(result.content).toContain("--- b ---");
    expect(result.content).toContain("Result for task one");
    expect(result.content).toContain("Result for task two");
  });

  test("partial failure is not overall error", async () => {
    const runSubAgent = async (config: { id?: string }) => {
      if (config.id === "bad") {
        return makeResult({ id: "bad", success: false, error: "Something went wrong." });
      }
      return makeResult({ id: config.id ?? "ok", output: "OK" });
    };

    const result = await agentTool.execute(
      {
        agents: [
          { id: "good", prompt: "ok" },
          { id: "bad", prompt: "fail" },
        ],
      },
      createContext(runSubAgent),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("OK");
    expect(result.content).toContain("Something went wrong.");
  });

  test("all failing is overall error", async () => {
    const runSubAgent = async () => makeResult({ id: "x", success: false, error: "Failed." });
    const result = await agentTool.execute({ agents: [{ prompt: "fail" }] }, createContext(runSubAgent));

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Failed.");
  });

  test("rejects empty agents array", async () => {
    let caught: unknown;
    try {
      await agentTool.execute({ agents: [] }, createContext(async () => makeResult({ id: "x" })));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(String(caught)).toContain("At least one sub-agent");
  });

  test("rejects missing prompt", async () => {
    let caught: unknown;
    try {
      await agentTool.execute({ agents: [{ id: "x", prompt: "" }] }, createContext(async () => makeResult({ id: "x" })));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(String(caught)).toContain("prompt");
  });
});
