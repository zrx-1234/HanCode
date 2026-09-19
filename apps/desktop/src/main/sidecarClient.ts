import type { App } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentEvent } from "../../../../src/agent/types";

export type SidecarResponse = {
  type: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type SidecarMessage = SidecarResponse | { type: "agent.event"; event: AgentEvent };

/** Name of the compiled sidecar executable inside the packaged resources. */
const SIDECAR_EXECUTABLE = "hancode-sidecar.exe";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class SidecarClient {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private eventHandler?: (event: AgentEvent) => void;

  constructor(private readonly app: App) {}

  onAgentEvent(handler: (event: AgentEvent) => void): void {
    this.eventHandler = handler;
  }

  async openWorkspace(workspacePath: string): Promise<unknown> {
    return await this.request({ type: "workspace.open", workspacePath });
  }

  async startTask(taskId: string, prompt: string): Promise<unknown> {
    return await this.request({ type: "task.start", taskId, prompt });
  }

  async stopTask(taskId: string): Promise<unknown> {
    return await this.request({ type: "task.stop", taskId });
  }

  async respondConfirmation(confirmationId: string, allowed: boolean): Promise<unknown> {
    return await this.request({ type: "confirmation.respond", confirmationId, allowed });
  }

  async setPermissionMode(mode: string): Promise<unknown> {
    return await this.request({ type: "permission.setMode", mode });
  }

  dispose(): void {
    this.child?.kill();
    this.child = undefined;
  }

  private async request(command: Record<string, unknown>): Promise<unknown> {
    const id = `req-${++this.sequence}`;
    this.ensureStarted();
    const child = this.child;
    if (!child) throw new Error("Sidecar failed to start.");

    const payload = { id, ...command };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return await promise;
  }

  private ensureStarted(): void {
    if (this.child) return;

    // Packaged: the sidecar is a standalone executable compiled with
    // `bun build --compile` (bundled Bun runtime, no host install needed).
    // Dev: run the TypeScript entry through the host Bun executable.
    const child = this.app.isPackaged
      ? spawn(join(process.resourcesPath, "sidecar", SIDECAR_EXECUTABLE), [], {
          cwd: process.resourcesPath,
          stdio: "pipe",
          windowsHide: true,
          env: {
            ...process.env,
            HANCODE_CONFIG_DIR: this.app.getPath("userData"),
            HANCODE_SKILLS_DIR: join(process.resourcesPath, "skills"),
          },
        })
      : spawn(resolveBunExecutable(), ["run", "src/desktop/sidecar.ts"], {
          cwd: process.cwd(),
          stdio: "pipe",
          windowsHide: true,
        });
    this.child = child;

    child.stderr.on("data", chunk => {
      console.error(`[sidecar] ${String(chunk)}`);
    });
    child.on("error", error => {
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
    child.on("exit", () => {
      this.child = undefined;
      for (const [, pending] of this.pending) pending.reject(new Error("HanCode sidecar exited."));
      this.pending.clear();
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => this.handleLine(line));
  }

  private handleLine(line: string): void {
    let message: SidecarMessage;
    try {
      message = JSON.parse(line) as SidecarMessage;
    } catch {
      console.error(`[sidecar] non-json stdout: ${line}`);
      return;
    }

    if (message.type === "agent.event") {
      this.eventHandler?.(message.event);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "Sidecar request failed."));
  }
}

function resolveBunExecutable(): string {
  const configured = process.env.HANCODE_BUN_PATH;
  if (configured) return configured;

  if (process.platform !== "win32") return "bun";

  const npmBun = resolveNpmShimTarget("bun.cmd");
  if (npmBun) return npmBun;

  const candidates = [
    join(process.env.APPDATA ?? "", "npm", "node_modules", "bun", "bin", "bun.exe"),
    join(process.env.LOCALAPPDATA ?? "", "bun", "bun.exe"),
  ];
  return candidates.find(candidate => candidate && existsSync(candidate)) ?? "bun.exe";
}

function resolveNpmShimTarget(shimName: string): string | undefined {
  const pathEntries = (process.env.PATH ?? "").split(";").filter(Boolean);
  for (const entry of pathEntries) {
    const shim = join(entry, shimName);
    if (!existsSync(shim)) continue;
    const text = readFileSync(shim, "utf8");
    const match = text.match(/"%dp0%\\([^\"]+)"/);
    if (!match) continue;
    const target = join(dirname(shim), match[1]);
    if (existsSync(target)) return target;
  }
  return undefined;
}
