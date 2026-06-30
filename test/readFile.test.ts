import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/agent/types";
import { readFileTool } from "../src/tools/readFile";
import { testWebConfig } from "./helpers";

async function createContext(workspaceRoot: string): Promise<ToolContext> {
  return {
    workspaceRoot,
    readState: new Map(),
    confirm: async () => false,
    audit: { log: async () => {} },
    signal: new AbortController().signal,
    web: testWebConfig,
    permissionMode: "normal",
  };
}

describe("readFileTool", () => {
  test("reads a simple file", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    await writeFile(join(root, "a.txt"), "hello world", "utf8");
    const ctx = await createContext(root);

    const result = await readFileTool.execute({ path: "a.txt" }, ctx);

    expect(result.content).toContain("hello world");
    expect(result.content).toContain("1"); // line number
    expect(ctx.readState.has(join(root, "a.txt"))).toBe(true);
  });

  test("rejects reading a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    await mkdir(join(root, "subdir"));
    const ctx = await createContext(root);

    await expect(readFileTool.execute({ path: "subdir" }, ctx)).rejects.toThrow("cannot read a directory");
  });

  test("supports offset and limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    await writeFile(join(root, "lines.txt"), "line1\nline2\nline3\nline4", "utf8");
    const ctx = await createContext(root);

    const result = await readFileTool.execute({ path: "lines.txt", offset: 1, limit: 2 }, ctx);

    expect(result.content).toContain("line2");
    expect(result.content).toContain("line3");
    expect(result.content).not.toContain("line1");
    // partial read should NOT register readState
    expect(ctx.readState.size).toBe(0);
  });

  test("rejects file outside workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    const ctx = await createContext(root);

    await expect(readFileTool.execute({ path: "../secret.txt" }, ctx)).rejects.toThrow("escapes workspace");
  });

  test("rejects non-existent file", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    const ctx = await createContext(root);

    await expect(readFileTool.execute({ path: "missing.txt" }, ctx)).rejects.toThrow();
  });
});
