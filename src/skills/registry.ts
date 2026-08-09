import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillManifest, SkillRecord } from "./types";

/**
 * Absolute path to the `skills/` directory at the project root.
 *
 * Resolved relative to this source file (src/skills/registry.ts -> ../../skills)
 * so it works both under `bun run src/...` and when the sidecar is spawned with
 * a cwd of the project root. Mirrors the `getAppRoot()` pattern in config.ts.
 */
export function getSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "skills");
}

function validateManifest(value: unknown): SkillManifest {
  if (!value || typeof value !== "object") throw new Error("skill.json is not an object");
  const m = value as Record<string, unknown>;
  if (typeof m.name !== "string" || m.name.trim() === "") throw new Error("skill.json: name is required");
  if (typeof m.description !== "string") throw new Error("skill.json: description is required");
  if (typeof m.entry !== "string" || m.entry.trim() === "") throw new Error("skill.json: entry is required");
  const triggers = Array.isArray(m.triggers) && m.triggers.every(t => typeof t === "string")
    ? (m.triggers as string[])
    : [];
  return {
    name: m.name,
    description: m.description,
    version: typeof m.version === "string" ? m.version : undefined,
    triggers,
    entry: m.entry,
    requiresPython: typeof m.requiresPython === "boolean" ? m.requiresPython : undefined,
    requirements: typeof m.requirements === "string" ? m.requirements : undefined,
    recommendedMaxTurns: typeof m.recommendedMaxTurns === "number" ? m.recommendedMaxTurns : undefined,
    notes: typeof m.notes === "string" ? m.notes : undefined,
  };
}

/**
 * Scans a skills directory and indexes every `skill.json` it finds.
 * Invalid manifests are skipped (never throw) so one broken skill cannot
 * disable the whole registry.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, SkillRecord>();

  constructor(private readonly rootDir: string = getSkillsRoot()) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.rootDir)) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(this.rootDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.rootDir, entry.name);
      const manifestPath = join(dir, "skill.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
        this.skills.set(manifest.name, { name: manifest.name, manifest, dir });
      } catch {
        // Skip malformed skill silently; a broken skill must not break the agent.
      }
    }
  }

  list(): SkillRecord[] {
    return [...this.skills.values()];
  }

  get(name: string): SkillRecord | undefined {
    return this.skills.get(name);
  }

  getDir(name: string): string | undefined {
    return this.skills.get(name)?.dir;
  }

  /** Returns the first skill whose trigger appears (case-insensitive) in `text`. */
  findByTrigger(text: string): SkillRecord | undefined {
    const lower = text.toLowerCase();
    for (const skill of this.skills.values()) {
      for (const trigger of skill.manifest.triggers) {
        if (trigger && lower.includes(trigger.toLowerCase())) return skill;
      }
    }
    return undefined;
  }
}

let shared: SkillRegistry | undefined;

/** Process-wide singleton registry; scans the default skills dir once. */
export function getSkillRegistry(): SkillRegistry {
  if (!shared) shared = new SkillRegistry();
  return shared;
}
