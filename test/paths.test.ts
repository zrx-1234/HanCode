import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveWorkspacePath } from "../src/security/paths";

async function tempWorkspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "hancode-paths-"));
}

describe("resolveWorkspacePath", () => {
  test("resolves relative paths inside workspace", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "export {};", "utf8");

    const resolved = await resolveWorkspacePath(root, "src/a.ts", { mustExist: true });
    expect(resolved.absolutePath).toBe(resolve(root, "src/a.ts"));
    expect(resolved.relativePath.replace(/\\/g, "/")).toBe("src/a.ts");
  });

  test("rejects traversal outside workspace", async () => {
    const root = await tempWorkspace();
    await expect(resolveWorkspacePath(root, "../secret.txt")).rejects.toThrow("escapes workspace");
  });

  test("rejects absolute paths outside workspace", async () => {
    const root = await tempWorkspace();
    const outside = resolve(root, "..", "outside.txt");
    await expect(resolveWorkspacePath(root, outside)).rejects.toThrow("escapes workspace");
  });

  test("rejects url-like paths", async () => {
    const root = await tempWorkspace();
    await expect(resolveWorkspacePath(root, "https://example.com/a.txt")).rejects.toThrow("URL-like");
  });
});
