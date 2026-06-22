import type { HanCodeTool } from "../agent/types";
import { decideCommand } from "../security/commandPolicy";
import { limitOutput } from "../security/outputLimit";
import { runCommandInput } from "./schemas";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

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
    const args = parsed.args ?? [];
    const decision = decideCommand(parsed.command, args, ctx.workspaceRoot);
    const commandLine = [parsed.command, ...args];

    if (decision.action === "refuse") {
      await ctx.audit.log({
        time: new Date().toISOString(),
        command: parsed.command,
        args,
        cwd: ctx.workspaceRoot,
        decision: "refuse",
        reason: decision.reason,
      });
      return { content: `Command refused: ${decision.reason}`, isError: true };
    }

    if (decision.action === "confirm") {
      const allowed = await ctx.confirm({
        title: "HanCode command confirmation",
        message: `${decision.reason}${parsed.reason ? `\nReason: ${parsed.reason}` : ""}`,
        command: commandLine,
      });
      if (!allowed) {
        await ctx.audit.log({
          time: new Date().toISOString(),
          command: parsed.command,
          args,
          cwd: ctx.workspaceRoot,
          decision: "deny",
          reason: decision.reason,
        });
        return { content: `Command denied by user: ${decision.reason}`, isError: true };
      }
    }

    const timeoutMs = Math.min(parsed.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const started = Date.now();
    const proc = Bun.spawn(commandLine, {
      cwd: ctx.workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: buildSafeEnv(),
    });

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
      await ctx.audit.log({
        time: new Date(started).toISOString(),
        command: parsed.command,
        args,
        cwd: ctx.workspaceRoot,
        decision: decision.action,
        reason: decision.reason,
        exitCode,
        durationMs,
        timedOut,
      });

      const output = [
        `Command: ${commandLine.join(" ")}`,
        `Exit code: ${exitCode}${timedOut ? " (timed out)" : ""}`,
        stdout ? `\nstdout:\n${stdout}` : "",
        stderr ? `\nstderr:\n${stderr}` : "",
      ].join("\n");
      return { content: limitOutput(output), isError: timedOut || exitCode !== 0 };
    } finally {
      clearTimeout(timer);
    }
  },
};

function buildSafeEnv(): Record<string, string> {
  const keep = ["PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "COMSPEC"];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
