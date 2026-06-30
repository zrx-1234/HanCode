import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/agent/types";
import { searchTextTool } from "../src/tools/searchText";
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

describe("searchTextTool", () => {
  test("finds matching lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-search-"));
    await writeFile(join(root, "a.ts"), "const foo = 1;\nconst bar = 2;", "utf8");
    const ctx = await createContext(root);

    const result = await searchTextTool.execute({ pattern: "foo" }, ctx);

    expect(result.content).toContain("a.ts:1: const foo = 1;");
    expect(result.content).not.toContain("bar");
  });

  test("supports case-insensitive search", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-search-"));
    await writeFile(join(root, "a.ts"), "const FOO = 1;", "utf8");
    const ctx = await createContext(root);

    const result = await searchTextTool.execute({ pattern: "foo", case_sensitive: false }, ctx);

    expect(result.content).toContain("FOO");
  });

  test("filters by glob", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-search-"));
    await writeFile(join(root, "a.ts"), "const foo = 1;", "utf8");
    await writeFile(join(root, "b.js"), "const foo = 1;", "utf8");
    const ctx = await createContext(root);

    const result = await searchTextTool.execute({ pattern: "foo", glob: "*.ts" }, ctx);

    expect(result.content).toContain("a.ts");
    expect(result.content).not.toContain("b.js");
  });

  test("supports context_lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-search-"));
    await writeFile(join(root, "a.ts"), "line1\nline2\nconst foo = 1;\nline4\nline5", "utf8");
    const ctx = await createContext(root);

    const result = await searchTextTool.execute({ pattern: "foo", context_lines: 1 }, ctx);

    expect(result.content).toContain("line2");
    expect(result.content).toContain("foo");
    expect(result.content).toContain("line4");
  });

  test("respects max_results truncation", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-search-"));
    await writeFile(join(root, "a.ts"), "foo\nfoo\nfoo", "utf8");
    const ctx = await createContext(root);

    const result = await searchTextTool.execute({ pattern: "foo", max_results: 2 }, ctx);

    expect(result.content).toContain("[truncated at 2 results]");
  });

  test("searches in subdirectory only", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-search-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "const foo = 1;", "utf8");
    await writeFile(join(root, "other.ts"), "const foo = 2;", "utf8");
    const ctx = await createContext(root);

    const result = await searchTextTool.execute({ pattern: "foo", path: "src" }, ctx);

    expect(result.content).toContain("src/main.ts");
    expect(result.content).not.toContain("other.ts");
  });
});
