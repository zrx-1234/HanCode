import { describe, expect, test } from "bun:test";
import { getSkillRegistry, getSkillsRoot, SkillRegistry } from "../src/skills/registry";
import { listSkillScripts, loadSkillEntry } from "../src/skills/loader";
import { skillTool } from "../src/tools/skill";
import type { ToolContext } from "../src/agent/types";
import { testWebConfig } from "./helpers";

function createContext(skills?: ToolContext["skills"]): ToolContext {
  return {
    workspaceRoot: "/tmp/hancode-skills-test",
    readState: new Map(),
    confirm: async () => true,
    audit: { log: async () => {} },
    signal: new AbortController().signal,
    web: testWebConfig,
    permissionMode: "normal",
    skills,
  };
}

describe("SkillRegistry", () => {
  test("scans the bundled ppt-master skill", () => {
    const registry = new SkillRegistry(getSkillsRoot());
    const skill = registry.get("ppt-master");
    expect(skill).toBeDefined();
    expect(skill?.manifest.name).toBe("ppt-master");
    expect(skill?.manifest.entry).toBe("SKILL.md");
    expect(skill?.manifest.requiresPython).toBe(true);
    expect(skill?.manifest.triggers.length).toBeGreaterThan(0);
    expect(skill?.manifest.recommendedMaxTurns).toBeGreaterThan(0);
    expect(skill?.dir).toContain("skills");
  });

  test("findByTrigger matches Chinese and English triggers, ignores unrelated text", () => {
    const registry = new SkillRegistry(getSkillsRoot());
    expect(registry.findByTrigger("帮我做个PPT")?.name).toBe("ppt-master");
    expect(registry.findByTrigger("please create ppt for me")?.name).toBe("ppt-master");
    expect(registry.findByTrigger("refactor this function")).toBeUndefined();
  });

  test("getSkillRegistry singleton is populated", () => {
    const registry = getSkillRegistry();
    expect(registry.list().some(s => s.name === "ppt-master")).toBe(true);
  });

  test("skips directories without a skill.json without throwing", () => {
    const registry = new SkillRegistry(getSkillsRoot());
    // templates/ and references/ live under ppt-master, not under skills/ root,
    // so the root scan should still only surface skill-bearing dirs.
    const names = registry.list().map(s => s.name);
    expect(names).toContain("ppt-master");
  });
});

describe("skill loader", () => {
  test("loadSkillEntry resolves every ${SKILL_DIR} token to an absolute path", () => {
    const skill = getSkillRegistry().get("ppt-master")!;
    const entry = loadSkillEntry(skill);
    expect(entry).not.toContain("${SKILL_DIR}");
    expect(entry).toContain(skill.dir.replace(/\\/g, "/"));
  });

  test("listSkillScripts returns the core python scripts", () => {
    const skill = getSkillRegistry().get("ppt-master")!;
    const scripts = listSkillScripts(skill);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every(name => name.endsWith(".py"))).toBe(true);
    expect(scripts).toContain("source_to_md.py");
    expect(scripts).toContain("svg_to_pptx.py");
  });
});

describe("skill tool", () => {
  test("loads ppt-master with resolved instructions and script index", async () => {
    const result = await skillTool.execute({ name: "ppt-master" }, createContext(getSkillRegistry()));
    expect(result.isError).toBe(false);
    expect(result.content).toContain("ppt-master");
    expect(result.content).toContain("source_to_md.py");
    expect(result.content).not.toContain("${SKILL_DIR}");
  });

  test("returns error and lists available skills for an unknown name", async () => {
    const result = await skillTool.execute({ name: "nope" }, createContext(getSkillRegistry()));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown skill");
    expect(result.content).toContain("ppt-master");
  });

  test("returns error when the registry is unavailable", async () => {
    const result = await skillTool.execute({ name: "ppt-master" }, createContext(undefined));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not available");
  });
});
