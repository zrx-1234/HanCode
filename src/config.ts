import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HanCodeConfig = {
  workspaceRoot: string;
  apiKey: string;
  model: string;
  baseURL: string;
  maxTurns: number;
};

type ConfigFile = {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  maxTurns?: number;
};

export function loadConfig(workspacePath: string): HanCodeConfig {
  const workspaceRoot = resolveWorkspaceRoot(workspacePath);
  const configFile = readConfigFile();
  return {
    workspaceRoot,
    apiKey: configFile.apiKey ?? "",
    model: configFile.model || "claude-opus-4-8",
    baseURL: configFile.baseURL || "https://api.anthropic.com",
    maxTurns: configFile.maxTurns ?? 20,
  };
}

export function resolveWorkspaceRoot(workspacePath: string): string {
  const candidate = resolve(process.cwd(), workspacePath.trim() || ".");
  const real = realpathSync(candidate);
  if (!statSync(real).isDirectory()) throw new Error(`Workspace is not a directory: ${workspacePath}`);
  return real;
}

function readConfigFile(): ConfigFile {
  const path = join(getAppRoot(), "hancode.config.json");
  if (!existsSync(path)) return {};

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ConfigFile;
  if (parsed.maxTurns !== undefined && (!Number.isInteger(parsed.maxTurns) || parsed.maxTurns <= 0)) {
    throw new Error("hancode.config.json: maxTurns must be a positive integer.");
  }
  return parsed;
}

function getAppRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}
