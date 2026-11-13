import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, readRawConfig, validateConfigObject, writeConfig } from "./config";

/**
 * Named configuration profiles ("方案"): saved copies of the config that can be
 * switched from the desktop settings dialog. The main `hancode.config.json`
 * always holds the *effective* config, so the CLI keeps working unchanged —
 * activating a profile simply copies its contents into the main file.
 *
 * Layout under the config directory:
 *   profiles/<name>.json  — one file per profile
 *   profiles/active       — plain-text marker holding the active profile name
 */

/** Name of the implicit profile backed by the main config file itself. */
export const DEFAULT_PROFILE = "default";

/** Profile names become filenames; keep them conservative. */
const NAME_PATTERN = /^[\w一-鿿-]{1,64}$/;

export type ProfileSummary = { name: string; active: boolean };

function profilesDir(): string {
  return join(getConfigDir(), "profiles");
}

function activeMarkerPath(): string {
  return join(profilesDir(), "active");
}

function profilePath(name: string): string {
  return join(profilesDir(), `${name}.json`);
}

function assertValidName(name: string): void {
  if (name === DEFAULT_PROFILE) return;
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid profile name: ${JSON.stringify(name)} (use 1-64 letters, digits, underscore, hyphen or CJK characters).`);
  }
}

/** Name of the currently active profile ("default" when no marker exists). */
export function getActiveProfile(): string {
  try {
    const name = readFileSync(activeMarkerPath(), "utf8").trim();
    if (name === DEFAULT_PROFILE || NAME_PATTERN.test(name)) return name;
  } catch {
    // No marker yet (or unreadable) → default profile.
  }
  return DEFAULT_PROFILE;
}

/** Lists the default profile plus every saved profile, marking the active one. */
export function listProfiles(): ProfileSummary[] {
  const active = getActiveProfile();
  const names = [DEFAULT_PROFILE];
  if (existsSync(profilesDir())) {
    for (const entry of readdirSync(profilesDir())) {
      if (!entry.endsWith(".json")) continue;
      names.push(entry.slice(0, -".json".length));
    }
    names.sort((a, b) => a.localeCompare(b));
  }
  return names.map(name => ({ name, active: name === active }));
}

/** Reads a saved profile's raw config. The default profile reads the main file. */
export function readProfile(name: string): Record<string, unknown> {
  assertValidName(name);
  if (name === DEFAULT_PROFILE) return readRawConfig();
  const path = profilePath(name);
  if (!existsSync(path)) throw new Error(`Profile not found: ${name}`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/**
 * Saves a profile file after validating it. When the profile is active and it
 * is not the default one, the main config is updated too so the two stay in
 * sync (the desktop Save button writes both).
 */
export function saveProfile(name: string, config: Record<string, unknown>): void {
  assertValidName(name);
  if (name === DEFAULT_PROFILE) {
    writeConfig(config);
    return;
  }
  validateConfigObject(config);
  mkdirSync(profilesDir(), { recursive: true });
  writeFileSync(profilePath(name), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  if (name === getActiveProfile()) writeConfig(config);
}

/**
 * Deletes a saved profile. The default profile cannot be deleted. Deleting the
 * *active* profile is allowed: the marker falls back to "default" while the
 * main config keeps its current contents (the deleted profile's values stay
 * effective until the user activates something else).
 */
export function deleteProfile(name: string): void {
  assertValidName(name);
  if (name === DEFAULT_PROFILE) throw new Error("The default profile cannot be deleted.");
  if (!existsSync(profilePath(name))) throw new Error(`Profile not found: ${name}`);
  rmSync(profilePath(name));
  if (name === getActiveProfile()) writeFileSync(activeMarkerPath(), DEFAULT_PROFILE, "utf8");
}

/**
 * Activates a profile: copies its contents into the main config file so it
 * becomes the effective configuration, and records it as the active profile.
 */
export function activateProfile(name: string): void {
  assertValidName(name);
  const config = readProfile(name);
  writeConfig(config);
  mkdirSync(profilesDir(), { recursive: true });
  writeFileSync(activeMarkerPath(), name, "utf8");
}
