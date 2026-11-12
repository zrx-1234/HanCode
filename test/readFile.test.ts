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

  // Minimal valid 1x1 PNG.
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNAAQEAAAABIwD+V9twAAAABJRU5ErkJggg==",
    "base64",
  );

  test("returns image content blocks for a PNG file", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    await writeFile(join(root, "shot.png"), PNG_1X1);
    const ctx = await createContext(root);

    const result = await readFileTool.execute({ path: "shot.png" }, ctx);

    expect(Array.isArray(result.content)).toBe(true);
    const blocks = result.content as unknown as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("text");
    const image = blocks[1] as { type: string; source: { type: string; media_type: string; data: string } };
    expect(image.type).toBe("image");
    expect(image.source.type).toBe("base64");
    expect(image.source.media_type).toBe("image/png");
    expect(image.source.data).toBe(PNG_1X1.toString("base64"));
    // images never register readState (edit_file works on utf8 text only)
    expect(ctx.readState.size).toBe(0);
  });

  test("recognizes uppercase .JPG extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    await writeFile(join(root, "photo.JPG"), PNG_1X1);
    const ctx = await createContext(root);

    const result = await readFileTool.execute({ path: "photo.JPG" }, ctx);

    const blocks = result.content as unknown as Array<Record<string, unknown>>;
    const image = blocks[1] as { source: { media_type: string } };
    expect(image.source.media_type).toBe("image/jpeg");
  });

  test("rejects offset/limit for image files", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    await writeFile(join(root, "shot.png"), PNG_1X1);
    const ctx = await createContext(root);

    await expect(readFileTool.execute({ path: "shot.png", offset: 0 }, ctx)).rejects.toThrow("not supported for image");
  });

  test("rejects images above the size limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "hancode-read-"));
    // >4MB of fake PNG data (extension is what routes it to the image branch).
    await writeFile(join(root, "big.png"), Buffer.alloc(4_000_001, 1));
    const ctx = await createContext(root);

    await expect(readFileTool.execute({ path: "big.png" }, ctx)).rejects.toThrow("too large");
  });
});
