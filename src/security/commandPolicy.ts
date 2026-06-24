import { isAbsolute, resolve } from "node:path";
import { assertInsideWorkspace } from "./paths";

export type CommandClassification = "read" | "test" | "write" | "destructive" | "unknown";

export type CommandDecision =
  | { action: "allow"; reason: string; classification: "read" | "test"; warning?: string }
  | { action: "confirm"; reason: string; classification: "write" | "destructive" | "unknown"; warning?: string }
  | { action: "refuse"; reason: string; classification?: CommandClassification; warning?: string };

const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);
const SHELL_TOKENS = ["|", "&&", "||", ";", "`", "$(", "${", ">", ">>", "<", "<<", "<(", ">(", "\n", "\r"];
const SYSTEM_PATH_MARKERS = [
  "c:\\windows",
  "c:/windows",
  "c:\\program files",
  "c:/program files",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/system",
];

export function decideCommand(command: string, args: string[], workspaceRoot: string): CommandDecision {
  const exe = baseCommand(command).toLowerCase();
  const allValues = [command, ...args];
  const warning = getDestructiveWarning(exe, args);

  if (!command.trim()) return { action: "refuse", reason: "Command cannot be empty.", classification: "unknown" };
  if (SHELLS.has(exe)) return { action: "refuse", reason: "Shell interpreters are not allowed in MVP.", classification: "unknown", warning };
  if (containsShellSyntax(allValues)) return { action: "refuse", reason: "Shell operators, pipes, redirects, and command substitutions are not allowed.", classification: "unknown", warning };
  if (touchesUnsafePath(command, args, workspaceRoot)) return { action: "refuse", reason: "Command targets a system path or path outside the workspace.", classification: "unknown", warning };
  if (isGlobalInstall(exe, args)) return { action: "refuse", reason: "Global dependency installs are not allowed.", classification: "write", warning };
  if (isInlineCodeExecution(exe, args)) return { action: "refuse", reason: "Inline code execution is not allowed.", classification: "unknown", warning };
  if (exe === "git" && args[0] === "push") return { action: "refuse", reason: "git push is not allowed in MVP.", classification: "write", warning };
  if (exe === "git" && args[0] === "reset" && args.includes("--hard")) return { action: "refuse", reason: "git reset --hard is not allowed.", classification: "destructive", warning };
  if (exe === "git" && args[0] === "clean" && args.some(isForceFlag)) return { action: "refuse", reason: "git clean with force is not allowed.", classification: "destructive", warning };
  if (exe === "rm" && args.some(isRecursiveFlag) && args.some(isForceFlag)) return { action: "refuse", reason: "rm -rf is not allowed.", classification: "destructive", warning };
  if ((exe === "curl" || exe === "wget") && looksLikeDownloadAndExecute(args)) return { action: "refuse", reason: "Download-and-execute patterns are not allowed.", classification: "unknown", warning };

  if (exe === "rm") return { action: "confirm", reason: "Deleting workspace files requires confirmation.", classification: "destructive", warning };
  if (exe === "git" && ["commit", "checkout", "switch", "reset", "restore"].includes(args[0] ?? "")) {
    return { action: "confirm", reason: "This git command may modify workspace state.", classification: "write", warning };
  }
  if (isWorkspaceInstall(exe, args)) return { action: "confirm", reason: "Installing dependencies modifies the workspace.", classification: "write", warning };
  if (args.some(arg => arg === "--write" || arg === "--fix" || arg === "--fix-type")) {
    return { action: "confirm", reason: "Formatter or fixer command may modify files.", classification: "write", warning };
  }

  const classification = classifyAllowedCommand(exe, args);
  if (classification) return { action: "allow", reason: "Allowed read/test/build command.", classification, warning };

  return { action: "confirm", reason: "Unknown command requires confirmation.", classification: "unknown", warning };
}

function baseCommand(command: string): string {
  return command.replace(/\\/g, "/").split("/").pop() ?? command;
}

function containsShellSyntax(values: string[]): boolean {
  return values.some(value => SHELL_TOKENS.some(token => value.includes(token)));
}

function touchesUnsafePath(command: string, args: string[], workspaceRoot: string): boolean {
  if (isUnsafePathToken(command, workspaceRoot)) return true;
  return extractPathArgs(baseCommand(command).toLowerCase(), args).some(arg => isUnsafePathToken(arg, workspaceRoot));
}

function extractPathArgs(exe: string, args: string[]): string[] {
  if (exe === "rm" || exe === "rmdir") return extractPositionalArgs(args);
  if (exe === "git") return extractGitPathArgs(args);
  return args.filter(isPathLike);
}

function extractPositionalArgs(args: string[]): string[] {
  const paths: string[] = [];
  let afterDashDash = false;
  for (const arg of args) {
    if (afterDashDash) {
      paths.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDashDash = true;
      continue;
    }
    if (!arg.startsWith("-")) paths.push(arg);
  }
  return paths;
}

function extractGitPathArgs(args: string[]): string[] {
  const subcommand = args[0];
  if (!subcommand || !["checkout", "restore", "reset"].includes(subcommand)) return [];
  const dashDash = args.indexOf("--");
  if (dashDash >= 0) return args.slice(dashDash + 1);
  if (subcommand === "restore") return extractPositionalArgs(args.slice(1));
  return [];
}

function isPathLike(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(value) || value.includes("/") || value.includes("\\");
}

function isUnsafePathToken(value: string, workspaceRoot: string): boolean {
  if (!isPathLike(value)) return false;
  const lower = value.toLowerCase();
  if (SYSTEM_PATH_MARKERS.some(marker => lower === marker || lower.startsWith(`${marker}/`) || lower.startsWith(`${marker}\\`))) return true;
  if (value.startsWith("\\\\") || value.startsWith("//")) return true;

  const candidate = isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value);
  try {
    assertInsideWorkspace(workspaceRoot, candidate);
    return false;
  } catch {
    return true;
  }
}

function isGlobalInstall(exe: string, args: string[]): boolean {
  if ((exe === "npm" || exe === "pnpm") && ["install", "i", "add"].includes(args[0] ?? "") && args.includes("-g")) return true;
  if (exe === "bun" && args[0] === "add" && args.includes("-g")) return true;
  return exe === "yarn" && args[0] === "global" && args[1] === "add";
}

function isWorkspaceInstall(exe: string, args: string[]): boolean {
  if (exe === "bun" && ["install", "add"].includes(args[0] ?? "")) return true;
  if ((exe === "npm" || exe === "pnpm") && ["install", "i", "add"].includes(args[0] ?? "")) return true;
  return exe === "yarn" && ["install", "add"].includes(args[0] ?? "");
}

function isInlineCodeExecution(exe: string, args: string[]): boolean {
  if ((exe === "node" || exe === "bun") && args.includes("-e")) return true;
  if ((exe === "python" || exe === "python3" || exe === "py") && args.includes("-c")) return true;
  if ((exe === "perl" || exe === "ruby") && args.includes("-e")) return true;
  if (exe === "php" && args.includes("-r")) return true;
  return exe === "deno" && args[0] === "eval";
}

function classifyAllowedCommand(exe: string, args: string[]): "read" | "test" | undefined {
  if (exe === "git" && ["status", "diff", "log", "show"].includes(args[0] ?? "")) return "read";
  if (exe === "bun" && args[0] === "test") return "test";
  if (exe === "bun" && args[0] === "--version") return "read";
  if (exe === "bun" && args[0] === "run" && ["test", "typecheck", "check"].includes(args[1] ?? "")) return args[1] === "test" ? "test" : "read";
  if (exe === "npm" && args[0] === "test") return "test";
  if (exe === "node" && args[0] === "--version") return "read";
  return undefined;
}

function isRecursiveFlag(arg: string): boolean {
  return arg === "--recursive" || (/^-[^-]/.test(arg) && arg.includes("r"));
}

function isForceFlag(arg: string): boolean {
  return arg === "--force" || (/^-[^-]/.test(arg) && arg.includes("f"));
}

function looksLikeDownloadAndExecute(args: string[]): boolean {
  return args.some(arg => ["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(baseCommand(arg).toLowerCase()));
}

function getDestructiveWarning(exe: string, args: string[]): string | undefined {
  if (exe === "rm") {
    if (args.some(isRecursiveFlag) && args.some(isForceFlag)) return "This command recursively and forcibly removes files.";
    if (args.some(isRecursiveFlag)) return "This command recursively removes files.";
    if (args.some(isForceFlag)) return "This command forcibly removes files.";
  }
  if (exe === "git" && args[0] === "reset" && args.includes("--hard")) return "This command may discard uncommitted changes.";
  if (exe === "git" && args[0] === "clean" && args.some(isForceFlag)) return "This command may permanently delete untracked files.";
  if (exe === "git" && args[0] === "commit" && args.includes("--amend")) return "This command rewrites the last commit.";
  if (exe === "git" && args[0] === "commit" && args.includes("--no-verify")) return "This command skips configured commit hooks.";
  if (exe === "git" && ["checkout", "restore"].includes(args[0] ?? "") && args.includes("--") && args.slice(args.indexOf("--") + 1).length > 0) {
    return "This command may discard working tree changes for the selected paths.";
  }
  return undefined;
}
