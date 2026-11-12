import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

// loadConfig resolves hancode.config.json from HANCODE_CONFIG_DIR; point it at
// a fresh temp dir per test so real project config never leaks in.
let dir: string;
let prevConfigDir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hancode-config-"));
  prevConfigDir = process.env.HANCODE_CONFIG_DIR;
  process.env.HANCODE_CONFIG_DIR = dir;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.HANCODE_CONFIG_DIR;
  else process.env.HANCODE_CONFIG_DIR = prevConfigDir;
});

describe("loadConfig", () => {
  test("defaults when no config file exists", () => {
    const config = loadConfig(dir);
    expect(config.maxTurns).toBe(100);
    expect(config.effort).toBe("auto");
    expect(config.thinkingMode).toBe("auto");
    expect(config.baseURL).toBe("https://api.anthropic.com");
    expect(config.compactionThresholdTokens).toBe(100_000);
    // vision routing is disabled by default (empty model)
    expect(config.vision.model).toBe("");
    expect(config.vision.baseURL).toBe("https://api.anthropic.com");
  });

  test("reads explicit values from the config file", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({
      model: "glm-latest",
      baseURL: "https://ark.cn-beijing.volces.com/api/coding",
      maxTurns: 50,
      effort: "xhigh",
      thinkingMode: "budget",
    }), "utf8");
    const config = loadConfig(dir);
    expect(config.model).toBe("glm-latest");
    expect(config.maxTurns).toBe(50);
    expect(config.effort).toBe("xhigh");
    expect(config.thinkingMode).toBe("budget");
  });

  test("rejects an invalid thinkingMode", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({ thinkingMode: "nope" }), "utf8");
    expect(() => loadConfig(dir)).toThrow("thinkingMode must be one of");
  });

  test("vision config falls back to the main baseURL and apiKey", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({
      baseURL: "https://ark.cn-beijing.volces.com/api/coding",
      apiKey: "main-key",
      vision: { model: "glm-4.6v" },
    }), "utf8");
    const config = loadConfig(dir);
    expect(config.vision.model).toBe("glm-4.6v");
    expect(config.vision.baseURL).toBe("https://ark.cn-beijing.volces.com/api/coding");
    expect(config.vision.apiKey).toBe("main-key");
  });

  test("vision config can override baseURL and apiKey", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({
      baseURL: "https://ark.cn-beijing.volces.com/api/coding",
      apiKey: "main-key",
      vision: { model: "glm-4.6v", baseURL: "https://api.anthropic.com", apiKey: "vision-key" },
    }), "utf8");
    const config = loadConfig(dir);
    expect(config.vision.model).toBe("glm-4.6v");
    expect(config.vision.baseURL).toBe("https://api.anthropic.com");
    expect(config.vision.apiKey).toBe("vision-key");
  });

  test("empty vision model keeps routing disabled", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({
      vision: { model: "", baseURL: "https://vision.example.com", apiKey: "vision-key" },
    }), "utf8");
    const config = loadConfig(dir);
    expect(config.vision.model).toBe("");
    expect(config.vision.baseURL).toBe("https://vision.example.com");
  });

  test("rejects a non-string vision model", async () => {
    await writeFile(join(dir, "hancode.config.json"), JSON.stringify({ vision: { model: 123 } }), "utf8");
    expect(() => loadConfig(dir)).toThrow("vision.model must be a string");
  });
});
