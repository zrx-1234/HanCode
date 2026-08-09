import { existsSync } from "node:fs";
import type { HanCodeTool } from "../agent/types";
import { decideShellCommand } from "../security/shellPolicy";
import { limitOutput } from "../security/outputLimit";
import { applyPermissionMode } from "../security/permissionMode";
import { bashInput } from "./schemas";
import { interpretExit, persistLargeOutput } from "./runCommand";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

type SpawnedCommand = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
};

export const bashTool: HanCodeTool = {
  definition: {
    name: "bash",
    description: "Run a Bash command string in the fixed workspace. Safe read/test commands may run automatically; risky, unknown, or complex commands require confirmation.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "Bash command string to execute." },
        timeout_ms: { type: "integer", description: "Timeout in milliseconds. Defaults to 30000, max 300000." },
        description: { type: "string", description: "Brief description of why this command is needed." },
      },
      required: ["command"],
    },
  },
  async execute(input, ctx) {
    const parsed = bashInput.parse(input);
    const commandText = parsed.command;
    const policyDecision = decideShellCommand(commandText, ctx.workspaceRoot, ctx.trustedDirs ?? []);
    const decision = applyPermissionMode(policyDecision, ctx.permissionMode);

    if (decision.action === "refuse") {
      await ctx.audit.log({
        time: new Date().toISOString(),
        command: "bash",
        args: ["-lc", commandText],
        commandText,
        cwd: ctx.workspaceRoot,
        decision: "refuse",
        reason: decision.reason,
        warning: decision.warning,
      });
      return { content: `Command refused: ${formatDecisionMessage(decision.reason, decision.warning)}`, isError: true };
    }

    if (decision.action === "confirm") {
      const allowed = await ctx.confirm({
        title: "HanCode bash command confirmation",
        message: formatDecisionMessage(decision.reason, decision.warning, parsed.description),
        commandText,
      });
      if (!allowed) {
        await ctx.audit.log({
          time: new Date().toISOString(),
          command: "bash",
          args: ["-lc", commandText],
          commandText,
          cwd: ctx.workspaceRoot,
          decision: "deny",
          reason: decision.reason,
          warning: decision.warning,
        });
        return { content: `Command denied by user: ${formatDecisionMessage(decision.reason, decision.warning)}`, isError: true };
      }
    }

    const shell = resolveBashExecutable();
    if (!shell) {
      await ctx.audit.log({
        time: new Date().toISOString(),
        command: "bash",
        args: ["-lc", commandText],
        commandText,
        cwd: ctx.workspaceRoot,
        decision: decision.action,
        reason: "Bash executable was not found.",
        warning: decision.warning,
        exitCode: null,
      });
      return { content: "Bash executable was not found. Install Git Bash or set HANCODE_BASH to the bash executable path.", isError: true };
    }

    const timeoutMs = Math.min(parsed.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const commandLine = [shell, "--noprofile", "--norc", "-lc", commandText];
    const started = Date.now();
    let proc: SpawnedCommand;
    try {
      proc = Bun.spawn(commandLine, {
        cwd: ctx.workspaceRoot,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: buildSafeEnvForShell(shell),
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      await ctx.audit.log({
        time: new Date(started).toISOString(),
        command: "bash",
        args: ["-lc", commandText],
        commandText,
        cwd: ctx.workspaceRoot,
        decision: decision.action,
        reason: decision.reason,
        warning: decision.warning,
        exitCode: null,
        durationMs,
        timedOut: false,
      });
      return { content: `Command failed to start: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const durationMs = Date.now() - started;
      const interpretation = interpretExit("bash", ["-lc", commandText], exitCode);
      const output = formatCommandOutput(commandText, exitCode, timedOut, stdout, stderr, interpretation.note);
      const persisted = await persistLargeOutput(ctx.workspaceRoot, output, started);

      await ctx.audit.log({
        time: new Date(started).toISOString(),
        command: "bash",
        args: ["-lc", commandText],
        commandText,
        cwd: ctx.workspaceRoot,
        decision: decision.action,
        reason: decision.reason,
        warning: decision.warning,
        exitCode,
        durationMs,
        timedOut,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        outputPath: persisted.relativePath,
      });

      const content = persisted.relativePath
        ? `${limitOutput(output)}\n\nFull output saved to ${persisted.relativePath}`
        : output;
      return { content, isError: timedOut || interpretation.isError };
    } finally {
      clearTimeout(timer);
    }
  },
};

export function resolveBashExecutable(): string | undefined {
  const configured = process.env.HANCODE_BASH;
  if (configured) return configured;

  if (process.platform !== "win32") {
    if (existsSync("/bin/bash")) return "/bin/bash";
    return "bash";
  }

  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? "bash.exe";
}

function formatDecisionMessage(reason: string, warning?: string, description?: string): string {
  return [reason, warning ? `Warning: ${warning}` : undefined, description ? `Description: ${description}` : undefined].filter(Boolean).join("\n");
}

function formatCommandOutput(commandText: string, exitCode: number | null, timedOut: boolean, stdout: string, stderr: string, note?: string): string {
  return [
    `Command: ${commandText}`,
    `Exit code: ${exitCode}${timedOut ? " (timed out)" : ""}`,
    note ? `Note: ${note}` : "",
    stdout ? `\nstdout:\n${stdout}` : "",
    stderr ? `\nstderr:\n${stderr}` : "",
  ].join("\n");
}

function buildSafeEnvForShell(shell: string): Record<string, string> {
  const keep = ["PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "COMSPEC"];
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", BASH_ENV: "" };
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  const pathKey = env.Path !== undefined ? "Path" : "PATH";
  const existingPath = env[pathKey] ?? "";
  const gitBashPaths = gitBashPathEntries(shell);
  if (gitBashPaths.length > 0) {
    env[pathKey] = [existingPath, ...gitBashPaths].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  }
  return env;
}

function gitBashPathEntries(shell: string): string[] {
  if (process.platform !== "win32") return [];
  const normalized = shell.replace(/\\/g, "/").toLowerCase();
  const gitRoot = normalized.endsWith("/bin/bash.exe")
    ? shell.slice(0, -"\\bin\\bash.exe".length)
    : normalized.endsWith("/usr/bin/bash.exe")
      ? shell.slice(0, -"\\usr\\bin\\bash.exe".length)
      : undefined;
  if (!gitRoot) return [];

  const entries = [`${gitRoot}\\bin`, `${gitRoot}\\usr\\bin`];
  return entries.filter(entry => existsSync(entry));
}
