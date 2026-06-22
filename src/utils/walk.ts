import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { isSymlink } from "../security/paths";

const DEFAULT_EXCLUDES = new Set([".git", "node_modules", "dist", ".hancode"]);

export async function* walkFiles(root: string, start: string): AsyncGenerator<{ absolutePath: string; relativePath: string }> {
  const entries = await readdir(start, { withFileTypes: true });
  for (const entry of entries) {
    if (DEFAULT_EXCLUDES.has(entry.name)) continue;
    const absolutePath = join(start, entry.name);
    if (entry.isDirectory()) {
      if (await isSymlink(absolutePath).catch(() => false)) continue;
      yield* walkFiles(root, absolutePath);
    } else if (entry.isFile()) {
      yield { absolutePath, relativePath: relative(root, absolutePath).replace(/\\/g, "/") };
    }
  }
}
