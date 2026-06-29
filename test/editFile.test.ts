import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createAgentSession } from "../src/agent/types";
import type { ToolContext } from "../src/agent/types";
import { JsonlAuditLogger } from "../src/security/auditLog";
import { editFileTool } from "../src/tools/editFile";
import { readFileTool } from "../src/tools/readFile";
import { testWebConfig } from "./helpers";

async function makeContext(): Promise<ToolContext> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "hancode-edit-"));
  return {
    workspaceRoot,
    readState: new Map(),
    confirm: async () => false,
    audit: new JsonlAuditLogger(workspaceRoot),
    signal: new AbortController().signal,
    web: testWebConfig,
    permissionMode: "normal",
  };
}

describe("edit_file", () => {
  test("creates an empty agent session", () => {
    const session = createAgentSession();
    expect(session.messages).toEqual([]);
    expect(session.readState.size).toBe(0);
    expect(session.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  test("requires read_file first", async () => {
    const ctx = await makeContext();
    await writeFile(join(ctx.workspaceRoot, "a.txt"), "hello", "utf8");
    await expect(editFileTool.execute({ path: "a.txt", old_text: "hello", new_text: "hi" }, ctx)).rejects.toThrow(
      "read_file",
    );
  });

  test("replaces one exact occurrence", async () => {
    const ctx = await makeContext();
    await writeFile(join(ctx.workspaceRoot, "a.txt"), "hello world", "utf8");
    await readFileTool.execute({ path: "a.txt" }, ctx);
    const result = await editFileTool.execute({ path: "a.txt", old_text: "hello", new_text: "hi" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("replaced 1 occurrence");
  });

  test("can edit using read state from a previous turn", async () => {
    const firstTurn = await makeContext();
    const session = createAgentSession();
    firstTurn.readState = session.readState;
    await writeFile(join(firstTurn.workspaceRoot, "a.txt"), "hello world", "utf8");

    await readFileTool.execute({ path: "a.txt" }, firstTurn);

    const secondTurn: ToolContext = { ...firstTurn, readState: session.readState };
    const result = await editFileTool.execute({ path: "a.txt", old_text: "hello", new_text: "hi" }, secondTurn);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("replaced 1 occurrence");
  });

  test("rejects multiple matches", async () => {
    const ctx = await makeContext();
    await writeFile(join(ctx.workspaceRoot, "a.txt"), "x x", "utf8");
    await readFileTool.execute({ path: "a.txt" }, ctx);
    await expect(editFileTool.execute({ path: "a.txt", old_text: "x", new_text: "y" }, ctx)).rejects.toThrow(
      "not unique",
    );
  });
});
