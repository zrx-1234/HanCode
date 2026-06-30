import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/agent/types";
import { writeFileTool } from "../src/tools/writeFile";
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

describe("writeFileTool", () => {
  test("creates a new file", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-write-"));
    const ctx = await createContext(root);

    const result = await writeFileTool.execute({ path: "new.txt", content: "hello" }, ctx);

    expect(result.content).toContain("Created");
    expect(result.content).toContain("new.txt");
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("hello");
    expect(ctx.readState.has(join(root, "new.txt"))).toBe(true);
  });

  test("refuses overwrite without flag", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-write-"));
    await Bun.write(join(root, "exists.txt"), "old");
    const ctx = await createContext(root);

    await expect(writeFileTool.execute({ path: "exists.txt", content: "new" }, ctx)).rejects.toThrow("already exists");
  });

  test("overwrites when overwrite=true", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-write-"));
    await Bun.write(join(root, "exists.txt"), "old");
    const ctx = await createContext(root);

    const result = await writeFileTool.execute({ path: "exists.txt", content: "new", overwrite: true }, ctx);

    expect(result.content).toContain("Overwrote");
    expect(await readFile(join(root, "exists.txt"), "utf8")).toBe("new");
  });

  test("rejects content exceeding max size", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-write-"));
    const ctx = await createContext(root);
    const huge = "x".repeat(2_000_001);

    await expect(writeFileTool.execute({ path: "big.txt", content: huge }, ctx)).rejects.toThrow("too large");
  });

  test("rejects path outside workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-write-"));
    const ctx = await createContext(root);

    await expect(writeFileTool.execute({ path: "../escape.txt", content: "bad" }, ctx)).rejects.toThrow("escapes workspace");
  });
});
