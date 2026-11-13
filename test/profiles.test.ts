import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { activateProfile, DEFAULT_PROFILE, deleteProfile, getActiveProfile, listProfiles, readProfile, saveProfile } from "../src/profiles";

// Profiles live under HANCODE_CONFIG_DIR; point it at a fresh temp dir per
// test so the real project config never leaks in.
let dir: string;
let prevConfigDir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hancode-profiles-"));
  prevConfigDir = process.env.HANCODE_CONFIG_DIR;
  process.env.HANCODE_CONFIG_DIR = dir;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.HANCODE_CONFIG_DIR;
  else process.env.HANCODE_CONFIG_DIR = prevConfigDir;
});

describe("profiles", () => {
  test("starts with only the default profile active", () => {
    expect(getActiveProfile()).toBe(DEFAULT_PROFILE);
    expect(listProfiles()).toEqual([{ name: DEFAULT_PROFILE, active: true }]);
  });

  test("save / list / read round-trip", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({ model: "glm-latest" }), "utf8");
    saveProfile("work", { model: "claude-test", apiKey: "key", baseURL: "https://api.anthropic.test" });

    const names = listProfiles().map(p => p.name);
    expect(names).toContain(DEFAULT_PROFILE);
    expect(names).toContain("work");
    // default stays active until something else is activated
    expect(listProfiles().find(p => p.name === "work")?.active).toBe(false);

    expect(readProfile("work")).toEqual({ model: "claude-test", apiKey: "key", baseURL: "https://api.anthropic.test" });
    // reading the default profile returns the main config file contents
    expect(readProfile(DEFAULT_PROFILE)).toEqual({ model: "glm-latest" });
  });

  test("activate writes the profile into the main config and hot-reloads", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({ model: "glm-latest", apiKey: "main-key" }), "utf8");
    saveProfile("vision", { model: "glm-4.6v", vision: { model: "doubao-seed-2.1-pro" } });

    activateProfile("vision");

    expect(getActiveProfile()).toBe("vision");
    expect(listProfiles().find(p => p.name === "vision")?.active).toBe(true);
    // the main config now holds the profile's contents — loadConfig sees them
    const config = loadConfig(dir);
    expect(config.model).toBe("glm-4.6v");
    expect(config.vision.model).toBe("doubao-seed-2.1-pro");
  });

  test("saving the active profile also refreshes the main config", async () => {
    saveProfile("work", { model: "a" });
    activateProfile("work");

    saveProfile("work", { model: "b", maxTurns: 55 });
    expect(loadConfig(dir).model).toBe("b");
    expect(loadConfig(dir).maxTurns).toBe(55);
  });

  test("delete removes the file and falls back to default when active", async () => {
    saveProfile("work", { model: "a" });
    activateProfile("work");

    deleteProfile("work");
    expect(existsSync(join(dir, "profiles", "work.json"))).toBe(false);
    expect(getActiveProfile()).toBe(DEFAULT_PROFILE);
    // main config keeps the last effective contents
    expect(loadConfig(dir).model).toBe("a");
  });

  test("delete rejects the default profile and unknown names", () => {
    expect(() => deleteProfile(DEFAULT_PROFILE)).toThrow("cannot be deleted");
    expect(() => deleteProfile("ghost")).toThrow("not found");
  });

  test("invalid profile names are rejected", () => {
    expect(() => saveProfile("bad name", { model: "a" })).toThrow("Invalid profile name");
    expect(() => saveProfile("a/b", { model: "a" })).toThrow("Invalid profile name");
    expect(() => saveProfile("", { model: "a" })).toThrow("Invalid profile name");
    // CJK characters are allowed
    saveProfile("工作配置", { model: "a" });
    expect(listProfiles().map(p => p.name)).toContain("工作配置");
  });

  test("invalid profile config is rejected by validation", () => {
    expect(() => saveProfile("bad", { thinkingMode: "nope" })).toThrow("thinkingMode must be one of");
    expect(() => saveProfile("bad", { maxTurns: -1 })).toThrow("maxTurns must be a positive integer");
  });

  test("activating an unknown profile fails", () => {
    expect(() => activateProfile("ghost")).toThrow("Profile not found");
  });

  test("marker with a garbage name falls back to default", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({ model: "a" }), "utf8");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "profiles"), { recursive: true });
    await writeFile(join(dir, "profiles", "active"), "not a valid name!", "utf8");
    expect(getActiveProfile()).toBe(DEFAULT_PROFILE);
  });
});
