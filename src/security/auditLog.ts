import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AuditLogger, CommandAuditEntry } from "../agent/types";

export class JsonlAuditLogger implements AuditLogger {
  constructor(private readonly workspaceRoot: string) {}

  async log(entry: CommandAuditEntry): Promise<void> {
    const dir = join(this.workspaceRoot, ".hancode");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "commands.jsonl"), `${JSON.stringify(redactEntry(entry))}\n`, "utf8");
  }
}

function redactEntry(entry: CommandAuditEntry): CommandAuditEntry {
  return {
    ...entry,
    args: entry.args.map((arg, index, args) => shouldRedact(arg, args[index - 1]) ? "[REDACTED]" : redactTokenLike(arg)),
  };
}

function shouldRedact(arg: string, previous?: string): boolean {
  const lower = previous?.toLowerCase() ?? "";
  return lower.includes("token") || lower.includes("api-key") || lower.includes("apikey") || lower.includes("password");
}

function redactTokenLike(arg: string): string {
  if (/^(sk-|sk-ant-|ghp_|github_pat_)[A-Za-z0-9_\-]+/.test(arg)) return "[REDACTED]";
  return arg;
}
