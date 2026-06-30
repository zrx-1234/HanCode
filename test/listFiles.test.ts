import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/agent/types";
import { listFilesTool } from "../src/tools/listFiles";
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

describe("listFilesTool", () => {
  test("lists files with default pattern", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-list-"));
    await writeFile(join(root, "a.ts"), "", "utf8");
    await writeFile(join(root, "b.js"), "", "utf8");
    const ctx = await createContext(root);

    const result = await listFilesTool.execute({}, ctx);

    expect(result.content).toContain("a.ts");
    expect(result.content).toContain("b.js");
  });

  test("filters by glob pattern", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-list-"));
    await writeFile(join(root, "a.ts"), "", "utf8");
    await writeFile(join(root, "b.js"), "", "utf8");
    const ctx = await createContext(root);

    const result = await listFilesTool.execute({ pattern: "*.ts" }, ctx);

    expect(result.content).toContain("a.ts");
    expect(result.content).not.toContain("b.js");
  });

  test("respects max_results", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-list-"));
    await writeFile(join(root, "1.txt"), "", "utf8");
    await writeFile(join(root, "2.txt"), "", "utf8");
    await writeFile(join(root, "3.txt"), "", "utf8");
    const ctx = await createContext(root);

    const result = await listFilesTool.execute({ max_results: 2 }, ctx);

    expect(result.content).toContain("[truncated at 2 results]");
  });

  test("lists files in subdirectory", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-list-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "", "utf8");
    const ctx = await createContext(root);

    const result = await listFilesTool.execute({ path: "src" }, ctx);

    expect(result.content).toContain("src/main.ts");
  });

  test("excludes .git and node_modules by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-list-"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "node_modules", "pkg"));
    await writeFile(join(root, ".git", "config"), "", "utf8");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "", "utf8");
    await writeFile(join(root, "readme.md"), "", "utf8");
    const ctx = await createContext(root);

    const result = await listFilesTool.execute({}, ctx);

    expect(result.content).toContain("readme.md");
    expect(result.content).not.toContain(".git/config");
    expect(result.content).not.toContain("node_modules");
  });
});
