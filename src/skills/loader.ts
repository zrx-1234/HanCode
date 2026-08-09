import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { SkillRecord } from "./types";

const SKILL_DIR_TOKEN = /\$\{SKILL_DIR\}/g;

/**
 * Reads a skill's entry document and resolves every `${SKILL_DIR}` token to
 * the skill's absolute directory. Paths are written with forward slashes so
 * they work verbatim inside Git Bash (the shell HanCode's `bash` tool uses).
 */
export function loadSkillEntry(skill: SkillRecord): string {
  const entryPath = join(skill.dir, skill.manifest.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Skill "${skill.name}" entry not found: ${entryPath}`);
  }
  const raw = readFileSync(entryPath, "utf8");
  const skillDir = skill.dir.replace(/\\/g, "/");
  return raw.replace(SKILL_DIR_TOKEN, skillDir);
}

/** Lists top-level `.py` scripts in a skill's `scripts/` directory. */
export function listSkillScripts(skill: SkillRecord): string[] {
  const scriptsDir = join(skill.dir, "scripts");
  if (!existsSync(scriptsDir)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(scriptsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(d => d.isFile() && d.name.endsWith(".py"))
    .map(d => d.name)
    .sort();
}
