import { resolve } from "node:path";

export type CommandDecision =
  | { action: "allow"; reason: string }
  | { action: "confirm"; reason: string }
  | { action: "refuse"; reason: string };

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const SHELL_TOKENS = ["|", "&&", "||", ";", "`", "$(", ">", ">>", "<", "<<"];
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
  const joined = [command, ...args].join(" ");
  const lowerJoined = joined.toLowerCase();

  if (SHELLS.has(exe)) return { action: "refuse", reason: "Shell interpreters are not allowed in MVP." };
  if (containsShellToken([command, ...args])) return { action: "refuse", reason: "Shell operators, pipes, and redirects are not allowed." };
  if (touchesSystemPath(args, workspaceRoot)) return { action: "refuse", reason: "Command targets a system path outside the workspace." };
  if (isGlobalInstall(exe, args)) return { action: "refuse", reason: "Global dependency installs are not allowed." };
  if ((exe === "node" || exe === "bun") && args.includes("-e")) return { action: "refuse", reason: "Inline code execution is not allowed." };
  if ((exe === "python" || exe === "python3" || exe === "py") && args.includes("-c")) return { action: "refuse", reason: "Inline code execution is not allowed." };
  if (exe === "git" && args[0] === "push") return { action: "refuse", reason: "git push is not allowed in MVP." };
  if (exe === "git" && args[0] === "reset" && args.includes("--hard")) return { action: "refuse", reason: "git reset --hard is not allowed." };
  if (exe === "git" && args[0] === "clean" && args.some(arg => arg.includes("f"))) return { action: "refuse", reason: "git clean with force is not allowed." };
  if (exe === "rm" && args.some(arg => arg.includes("r") && arg.includes("f"))) return { action: "refuse", reason: "rm -rf is not allowed." };
  if ((exe === "curl" || exe === "wget") && lowerJoined.includes(" sh")) return { action: "refuse", reason: "Download-and-execute patterns are not allowed." };

  if (exe === "rm") return { action: "confirm", reason: "Deleting workspace files requires confirmation." };
  if (exe === "git" && ["commit", "checkout", "switch", "reset"].includes(args[0] ?? "")) return { action: "confirm", reason: "This git command may modify workspace state." };
  if (isWorkspaceInstall(exe, args)) return { action: "confirm", reason: "Installing dependencies modifies the workspace." };
  if (args.some(arg => arg === "--write" || arg === "--fix" || arg === "--fix-type")) return { action: "confirm", reason: "Formatter or fixer command may modify files." };

  if (isAllowedReadOrTestCommand(exe, args)) return { action: "allow", reason: "Allowed read/test/build command." };

  return { action: "confirm", reason: "Unknown command requires confirmation." };
}

function baseCommand(command: string): string {
  return command.replace(/\\/g, "/").split("/").pop() ?? command;
}

function containsShellToken(values: string[]): boolean {
  return values.some(value => SHELL_TOKENS.some(token => value.includes(token)));
}

function touchesSystemPath(args: string[], workspaceRoot: string): boolean {
  const root = workspaceRoot.toLowerCase();
  return args.some(arg => {
    const lower = arg.toLowerCase();
    if (SYSTEM_PATH_MARKERS.some(marker => lower === marker || lower.startsWith(`${marker}/`) || lower.startsWith(`${marker}\\`))) return true;
    if (/^[a-z]:[\\/]/i.test(arg)) {
      const resolved = resolve(arg).toLowerCase();
      return !resolved.startsWith(root.toLowerCase());
    }
    return false;
  });
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

function isAllowedReadOrTestCommand(exe: string, args: string[]): boolean {
  if (exe === "git" && ["status", "diff", "log"].includes(args[0] ?? "")) return true;
  if (exe === "bun" && (args[0] === "test" || args[0] === "--version")) return true;
  if (exe === "bun" && args[0] === "run" && ["test", "typecheck", "check"].includes(args[1] ?? "")) return true;
  if (exe === "npm" && args[0] === "test") return true;
  if (exe === "node" && args[0] === "--version") return true;
  return false;
}
