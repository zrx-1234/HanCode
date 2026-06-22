import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { UserVisibleError } from "../utils/errors";

export type ResolvedWorkspacePath = {
  absolutePath: string;
  relativePath: string;
};

type ResolveOptions = {
  mustExist?: boolean;
  forWrite?: boolean;
};

const URL_LIKE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

export function assertInsideWorkspace(workspaceRoot: string, candidate: string): string {
  const rel = relative(workspaceRoot, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return rel || ".";
  throw new UserVisibleError(`Path escapes workspace: ${candidate}`);
}

export async function resolveWorkspacePath(
  workspaceRoot: string,
  inputPath: string,
  options: ResolveOptions = {},
): Promise<ResolvedWorkspacePath> {
  if (!inputPath.trim()) throw new UserVisibleError("Path cannot be empty.");
  if (inputPath.startsWith("\\\\") || inputPath.startsWith("//")) {
    throw new UserVisibleError("UNC/network paths are not allowed.");
  }
  if (URL_LIKE.test(inputPath) && !WINDOWS_DRIVE.test(inputPath)) {
    throw new UserVisibleError("URL-like paths are not allowed.");
  }

  const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(workspaceRoot, inputPath);
  assertInsideWorkspace(workspaceRoot, candidate);

  if (options.mustExist) {
    const real = await realpath(candidate);
    const relativePath = assertInsideWorkspace(workspaceRoot, real);
    return { absolutePath: real, relativePath };
  }

  if (options.forWrite) {
    const parent = await nearestExistingParent(candidate);
    const realParent = await realpath(parent);
    assertInsideWorkspace(workspaceRoot, realParent);
    await rejectEscapingSymlinkSegments(workspaceRoot, candidate);
  }

  return { absolutePath: candidate, relativePath: assertInsideWorkspace(workspaceRoot, candidate) };
}

async function nearestExistingParent(path: string): Promise<string> {
  let current = path;
  while (current && current !== resolve(current, "..")) {
    try {
      const s = await stat(current);
      if (s.isDirectory()) return current;
      return resolve(current, "..");
    } catch {
      current = resolve(current, "..");
    }
  }
  throw new UserVisibleError("No existing parent directory found.");
}

async function rejectEscapingSymlinkSegments(workspaceRoot: string, target: string): Promise<void> {
  const rel = relative(workspaceRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new UserVisibleError("Path escapes workspace.");
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  let current = workspaceRoot;
  for (const part of parts.slice(0, -1)) {
    current = `${current}${sep}${part}`;
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink()) {
        const real = await realpath(current);
        assertInsideWorkspace(workspaceRoot, real);
      }
    } catch {
      return;
    }
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory();
}

export async function isSymlink(path: string): Promise<boolean> {
  return (await lstat(path)).isSymbolicLink();
}
