import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HanCodeTool } from "../agent/types";
import { decideCommand } from "../security/commandPolicy";
import { applyPermissionMode } from "../security/permissionMode";
import { DEFAULT_OUTPUT_LIMIT, limitOutput } from "../security/outputLimit";
import { runCommandInput } from "./schemas";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

type SpawnedCommand = {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
};

let outputSequence = 0;

export const runCommandTool: HanCodeTool = {
  definition: {
    name: "run_command",
    description: "Run a safe argv-style command in the fixed workspace. Use for tests, builds, and git inspection. Do not use shell syntax.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", description: "Executable name, e.g. bun or git. Not a shell string." },
        args: { type: "array", items: { type: "string" }, description: "Argument array." },
        timeout_ms: { type: "integer", description: "Timeout in milliseconds. Defaults to 30000, max 300000." },
        reason: { type: "string", description: "Why this command is needed." },
      },
      required: ["command"],
    },
  },
  async execute(input, ctx) {
    const parsed = runCommandInput.parse(input);
    const command = parsed.command;
    const args = parsed.args;
    const policyDecision = decideCommand(command, args, ctx.workspaceRoot, ctx.trustedDirs ?? []);
    const decision = applyPermissionMode(policyDecision, ctx.permissionMode);
    const commandLine = [command, ...args];

    if (decision.action === "refuse") {
      await ctx.audit.log({
        time: new Date().toISOString(),
        command,
        args,
        cwd: ctx.workspaceRoot,
        decision: "refuse",
        reason: decision.reason,
        warning: decision.warning,
      });
      return { content: `Command refused: ${formatDecisionMessage(decision.reason, decision.warning)}`, isError: true };
    }

    if (decision.action === "confirm") {
      const allowed = await ctx.confirm({
        title: "HanCode command confirmation",
        message: formatDecisionMessage(decision.reason, decision.warning, parsed.reason),
        command: commandLine,
      });
      if (!allowed) {
        await ctx.audit.log({
          time: new Date().toISOString(),
          command,
          args,
          cwd: ctx.workspaceRoot,
          decision: "deny",
          reason: decision.reason,
          warning: decision.warning,
        });
        return { content: `Command denied by user: ${formatDecisionMessage(decision.reason, decision.warning)}`, isError: true };
      }
    }

    const timeoutMs = Math.min(parsed.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const started = Date.now();
    let proc: SpawnedCommand;
    try {
      proc = Bun.spawn(commandLine, {
        cwd: ctx.workspaceRoot,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: buildSafeEnv(),
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      await ctx.audit.log({
        time: new Date(started).toISOString(),
        command,
        args,
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
      killProcessTree(proc);
    }, timeoutMs);

    // Stop the command as soon as the run is cancelled (Stop button): kill the
    // process tree and stop waiting for output instead of blocking until the
    // (possibly orphaned) pipes close.
    let aborted = false;
    let notifyStopped: () => void = () => {};
    const stopped = new Promise<void>(resolve => {
      notifyStopped = resolve;
    });
    const onAbort = () => {
      aborted = true;
      killProcessTree(proc);
      notifyStopped();
    };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort);

    try {
      const collected = Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      await Promise.race([collected, stopped]);

      if (aborted) {
        const durationMs = Date.now() - started;
        await ctx.audit.log({
          time: new Date(started).toISOString(),
          command,
          args,
          cwd: ctx.workspaceRoot,
          decision: decision.action,
          reason: decision.reason,
          warning: decision.warning,
          exitCode: null,
          durationMs,
          aborted: true,
        });
        return { content: `Command stopped by user: ${commandLine.join(" ")}`, isError: true };
      }
      const [stdout, stderr, exitCode] = await collected;
      const durationMs = Date.now() - started;
      const interpretation = interpretExit(command, args, exitCode);
      const output = formatCommandOutput(commandLine, exitCode, timedOut, stdout, stderr, interpretation.note);
      const persisted = await persistLargeOutput(ctx.workspaceRoot, output, started);
      await ctx.audit.log({
        time: new Date(started).toISOString(),
        command,
        args,
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
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
};

export function interpretExit(command: string, args: string[], exitCode: number): { isError: boolean; note?: string } {
  const exe = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  if (exe === "git" && args[0] === "diff" && args.includes("--quiet") && exitCode === 1) {
    return { isError: false, note: "git diff --quiet returned 1 because differences were found." };
  }
  return { isError: exitCode !== 0 };
}

/**
 * Terminate a spawned command together with its whole process tree. On
 * Windows `proc.kill()` only terminates the direct child — grandchildren
 * (e.g. bash spawning the real command) survive and keep the stdout/stderr
 * pipes open, which would block output reads until they exit on their own.
 */
export function killProcessTree(proc: { pid: number; kill(): void }): void {
  if (process.platform === "win32") {
    Bun.spawn(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    return;
  }
  proc.kill();
}

function formatDecisionMessage(reason: string, warning?: string, modelReason?: string): string {
  return [reason, warning ? `Warning: ${warning}` : undefined, modelReason ? `Reason: ${modelReason}` : undefined].filter(Boolean).join("\n");
}

function formatCommandOutput(commandLine: string[], exitCode: number | null, timedOut: boolean, stdout: string, stderr: string, note?: string): string {
  return [
    `Command: ${commandLine.join(" ")}`,
    `Exit code: ${exitCode}${timedOut ? " (timed out)" : ""}`,
    note ? `Note: ${note}` : "",
    stdout ? `\nstdout:\n${stdout}` : "",
    stderr ? `\nstderr:\n${stderr}` : "",
  ].join("\n");
}

export async function persistLargeOutput(workspaceRoot: string, output: string, started: number): Promise<{ relativePath?: string }> {
  if (output.length <= DEFAULT_OUTPUT_LIMIT) return {};
  const dir = join(workspaceRoot, ".hancode", "command-output");
  await mkdir(dir, { recursive: true });
  outputSequence += 1;
  const relativePath = `.hancode/command-output/${started}-${process.pid}-${outputSequence}.txt`;
  await writeFile(join(workspaceRoot, relativePath), output, "utf8");
  return { relativePath };
}

function buildSafeEnv(): Record<string, string> {
  const keep = ["PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "COMSPEC"];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
