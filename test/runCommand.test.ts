import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandAuditEntry, ConfirmationRequest, ToolContext } from "../src/agent/types";
import { DEFAULT_OUTPUT_LIMIT } from "../src/security/outputLimit";
import { interpretExit, persistLargeOutput, runCommandTool } from "../src/tools/runCommand";
import { testWebConfig } from "./helpers";

async function createContext(overrides: Partial<ToolContext> = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "hancode-command-"));
  const entries: CommandAuditEntry[] = [];
  const confirmations: ConfirmationRequest[] = [];
  const ctx: ToolContext = {
    workspaceRoot,
    readState: new Map(),
    confirm: async request => {
      confirmations.push(request);
      return false;
    },
    audit: { log: async entry => void entries.push(entry) },
    signal: new AbortController().signal,
    web: testWebConfig,
    ...overrides,
  };
  return { ctx, entries, confirmations };
}

describe("runCommandTool", () => {
  test("refuses commands before confirmation", async () => {
    let asked = false;
    const { ctx, entries } = await createContext({
      confirm: async () => {
        asked = true;
        return true;
      },
    });

    const result = await runCommandTool.execute({ command: "git", args: ["push"] }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Command refused");
    expect(asked).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("refuse");
  });

  test("records denied confirmations", async () => {
    const { ctx, entries, confirmations } = await createContext();

    const result = await runCommandTool.execute({ command: "rm", args: ["file.txt"], reason: "cleanup" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Command denied by user");
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].message).toContain("cleanup");
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("deny");
  });

  test("includes destructive warnings in confirmation requests", async () => {
    const { ctx, confirmations } = await createContext();

    await runCommandTool.execute({ command: "rm", args: ["-r", "dir"] }, ctx);

    expect(confirmations[0].message).toContain("Warning:");
    expect(confirmations[0].message).toContain("recursively");
  });

  test("interprets git diff --quiet exit code 1 as differences", () => {
    expect(interpretExit("git", ["diff", "--quiet"], 1)).toEqual({
      isError: false,
      note: "git diff --quiet returned 1 because differences were found.",
    });
    expect(interpretExit("git", ["status"], 1).isError).toBe(true);
  });

  test("persists large output under .hancode", async () => {
    const { ctx } = await createContext();
    const output = "x".repeat(DEFAULT_OUTPUT_LIMIT + 1);

    const result = await persistLargeOutput(ctx.workspaceRoot, output, 123);

    expect(result.relativePath).toStartWith(".hancode/command-output/");
    expect(await readFile(join(ctx.workspaceRoot, result.relativePath!), "utf8")).toBe(output);
  });
});
