import { readFile, rm } from "node:fs/promises";
import type { HanCodeTool, ToolContext, ToolExecutionResult } from "../agent/types";
import { buildImageContentBlocks } from "./images";
import { applyPermissionMode } from "../security/permissionMode";

const CAPTURE_TIMEOUT_MS = 15_000;

// Captures the virtual screen (all monitors combined) to a temporary PNG file
// and resolves with that file path. Windows-only in this first version.
export type ScreenCapture = (signal: AbortSignal) => Promise<string>;

const POWERSHELL_CAPTURE_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
  "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
  "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)",
  "$path = Join-Path $env:TEMP ('hancode-screenshot-' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds() + '.png')",
  "$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
  "$g.Dispose(); $bmp.Dispose()",
  "Write-Output $path",
].join("; ");

export const screenshotTool: HanCodeTool = {
  definition: {
    name: "screenshot",
    description:
      "Capture a screenshot of the whole screen (all monitors) and return it as an image block, " +
      "so the model can visually inspect what is currently displayed. Requires user confirmation " +
      "outside super mode. Windows only in this version.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  async execute(input, ctx) {
    return executeScreenshot(input, ctx);
  },
};

/** Separated from the tool object so tests can inject a fake capture function. */
export async function executeScreenshot(
  input: unknown,
  ctx: ToolContext,
  capture: ScreenCapture = captureScreenToFile,
): Promise<ToolExecutionResult> {
  if (input !== undefined && (input === null || typeof input !== "object" || Object.keys(input as object).length > 0)) {
    return { content: "screenshot takes no parameters.", isError: true };
  }

  // Screenshots read everything on all screens (including other apps), so they
  // are privacy-sensitive: confirm in safe/normal mode, auto-approve in super.
  const decision = applyPermissionMode(
    { action: "confirm", reason: "Capture the contents of all screens" },
    ctx.permissionMode,
  );
  if (decision.action === "confirm") {
    const allowed = await ctx.confirm({
      title: "HanCode screenshot confirmation",
      message: "Take a screenshot of all screens so the model can see what is currently displayed?",
      commandText: "screenshot",
    });
    if (!allowed) {
      await ctx.audit.log({
        time: new Date().toISOString(),
        command: "screenshot",
        args: [],
        cwd: ctx.workspaceRoot,
        decision: "deny",
        reason: decision.reason,
      });
      return { content: "Screenshot denied by user.", isError: true };
    }
  }

  await ctx.audit.log({
    time: new Date().toISOString(),
    command: "screenshot",
    args: [],
    cwd: ctx.workspaceRoot,
    decision: "allow",
    reason: decision.reason,
  });

  const path = await capture(ctx.signal);
  try {
    const bytes = await readFile(path);
    return {
      content: buildImageContentBlocks({
        label: `Screenshot of all screens (${bytes.length} bytes, image/png).`,
        bytes,
        mediaType: "image/png",
      }),
    };
  } finally {
    // The temp file is read into memory and never needed again.
    await rm(path, { force: true }).catch(() => {});
  }
}

/** Windows implementation: PowerShell + System.Drawing virtual-screen capture. */
async function captureScreenToFile(signal: AbortSignal): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("screenshot is only supported on Windows in this version.");
  }

  const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_CAPTURE_SCRIPT], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, CAPTURE_TIMEOUT_MS);
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    proc.kill();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  try {
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (aborted) throw new Error("screenshot was cancelled.");
    if (timedOut) throw new Error(`screenshot timed out after ${CAPTURE_TIMEOUT_MS}ms.`);
    if (exitCode !== 0) throw new Error(`screenshot capture failed (exit code ${exitCode}): ${stdout.trim()}`);
    const path = stdout.trim().split(/\r?\n/).pop() ?? "";
    if (!path) throw new Error("screenshot capture did not report an output file.");
    return path;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
