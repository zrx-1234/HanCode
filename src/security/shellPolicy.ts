import { isAbsolute, resolve } from "node:path";
import type { CommandDecision } from "./commandPolicy";
import { assertInsideWorkspace } from "./paths";

export type ShellDecision = CommandDecision & { commandText: string };

type Segment = {
  text: string;
  operatorBefore?: "|" | "&&" | "||" | ";";
};

type ParsedCommand = {
  argv: string[];
  redirections: Redirection[];
  env: string[];
};

type Redirection = {
  op: "<" | ">" | ">>";
  target?: string;
};

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const READ_COMMANDS = new Set(["pwd", "ls", "rg", "grep", "cat", "head", "tail", "wc", "file", "stat", "find"]);
const WRITE_COMMANDS = new Set(["mkdir", "touch", "mv", "cp", "chmod", "chown", "prettier", "eslint"]);
const SYSTEM_PATH_MARKERS = ["/", "/etc", "/usr", "/bin", "/sbin", "/system", "c:\\windows", "c:/windows", "c:\\program files", "c:/program files"];
const SAFE_ENV = new Set(["CI", "NO_COLOR", "FORCE_COLOR", "NODE_ENV", "BUN_CONFIG_VERBOSE_FETCH"]);

export function decideShellCommand(commandText: string, workspaceRoot: string): ShellDecision {
  const text = commandText.trim();
  if (!text) return refuse(text, "Command cannot be empty.");
  if (hasCommandSubstitution(text)) return refuse(text, "Command substitution is not allowed in bash commands.");
  if (hasUnsupportedShellSyntax(text)) return confirm(text, "Shell syntax is too complex to prove safe.");

  const split = splitShellSegments(text);
  if (typeof split === "string") return confirm(text, split);
  if (split.length === 0) return refuse(text, "Command cannot be empty.");

  let sawConfirm: ShellDecision | undefined;
  let sawRead = false;
  let sawTest = false;

  for (const segment of split) {
    const parsed = parseSimpleCommand(segment.text);
    if (typeof parsed === "string") return confirm(text, parsed);
    if (parsed.argv.length === 0) return confirm(text, "Empty shell command segment requires confirmation.");

    const redirectionDecision = decideRedirections(text, parsed.redirections, workspaceRoot);
    if (redirectionDecision.action === "refuse") return redirectionDecision;
    if (redirectionDecision.action === "confirm") sawConfirm ??= redirectionDecision;

    const envDecision = decideEnvironment(text, parsed.env);
    if (envDecision.action === "confirm") sawConfirm ??= envDecision;

    const decision = decideSimpleCommand(text, parsed.argv, workspaceRoot, segment.operatorBefore);
    if (decision.action === "refuse") return decision;
    if (decision.action === "confirm") sawConfirm ??= decision;
    if (decision.action === "allow" && decision.classification === "read") sawRead = true;
    if (decision.action === "allow" && decision.classification === "test") sawTest = true;
  }

  if (sawConfirm) return sawConfirm;
  return { action: "allow", reason: "Allowed safe bash read/test command.", classification: sawTest && !sawRead ? "test" : "read", commandText: text };
}

function splitShellSegments(command: string): Segment[] | string {
  const segments: Segment[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let nextOperator: Segment["operatorBefore"];

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const next = command[i + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && !escaped) {
      quote = quote === char ? undefined : quote ?? char;
      current += char;
      continue;
    }
    if (!quote) {
      const two = `${char}${next ?? ""}`;
      if (two === "&&" || two === "||") {
        pushSegment(segments, current, nextOperator);
        current = "";
        nextOperator = two;
        i++;
        continue;
      }
      if (char === "|" || char === ";") {
        pushSegment(segments, current, nextOperator);
        current = "";
        nextOperator = char;
        continue;
      }
      if (char === "\n" || char === "\r") return "Multiline shell commands require confirmation.";
    }
    current += char;
  }

  if (quote) return "Unbalanced shell quotes require confirmation.";
  pushSegment(segments, current, nextOperator);
  return segments;
}

function pushSegment(segments: Segment[], text: string, operatorBefore: Segment["operatorBefore"]): void {
  const trimmed = text.trim();
  if (trimmed) segments.push({ text: trimmed, operatorBefore });
}

function parseSimpleCommand(segment: string): ParsedCommand | string {
  const tokens = tokenize(segment);
  if (typeof tokens === "string") return tokens;
  const argv: string[] = [];
  const redirections: Redirection[] = [];
  const env: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "<" || token === ">" || token === ">>") {
      redirections.push({ op: token, target: tokens[i + 1] });
      i++;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token) && argv.length === 0) {
      env.push(token);
      continue;
    }
    argv.push(token);
  }

  return { argv, redirections, env };
}

function tokenize(segment: string): string[] | string {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    const next = segment[i + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && !escaped) {
      quote = quote === char ? undefined : quote ?? char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      flush(tokens, current);
      current = "";
      continue;
    }
    if (!quote && (char === "<" || char === ">")) {
      flush(tokens, current);
      current = "";
      if (char === ">" && next === ">") {
        tokens.push(">>");
        i++;
      } else {
        tokens.push(char);
      }
      continue;
    }
    current += char;
  }

  if (quote) return "Unbalanced shell quotes require confirmation.";
  flush(tokens, current);
  return tokens;
}

function flush(tokens: string[], token: string): void {
  if (token) tokens.push(token);
}

function decideRedirections(commandText: string, redirections: Redirection[], workspaceRoot: string): ShellDecision {
  for (const redirection of redirections) {
    if (!redirection.target) return confirm(commandText, "Shell redirection without a target requires confirmation.");
    if (isUnsafePathToken(redirection.target, workspaceRoot)) return refuse(commandText, "Shell redirection targets a system path or path outside the workspace.");
    if (redirection.op === ">" || redirection.op === ">>") return confirm(commandText, "Output redirection may modify workspace files.", "This command writes shell output to a file.");
  }
  return allowRead(commandText, "Input redirection targets a workspace path.");
}

function decideEnvironment(commandText: string, env: string[]): ShellDecision {
  for (const assignment of env) {
    const name = assignment.split("=", 1)[0];
    if (!SAFE_ENV.has(name)) return confirm(commandText, `Environment assignment ${name}= requires confirmation.`);
  }
  return allowRead(commandText, "Allowed safe environment assignment.");
}

function decideSimpleCommand(commandText: string, argv: string[], workspaceRoot: string, operatorBefore?: Segment["operatorBefore"]): ShellDecision {
  const exe = baseCommand(argv[0]).toLowerCase();
  const args = argv.slice(1);
  const warning = getWarning(exe, args);

  if (operatorBefore && (operatorBefore === "&&" || operatorBefore === "||" || operatorBefore === ";") && exe === "cd") {
    return confirm(commandText, "Changing directories inside shell command chains requires confirmation.");
  }
  if (SHELLS.has(exe)) return refuse(commandText, "Nested shell wrappers are not allowed inside bash commands.", warning);
  if (isInlineCodeExecution(exe, args)) return refuse(commandText, "Inline code execution is not allowed in bash commands.", warning);
  if (touchesUnsafePath(argv, workspaceRoot)) return refuse(commandText, "Command targets a system path or path outside the workspace.", warning);
  if (isGlobalInstall(exe, args)) return refuse(commandText, "Global dependency installs are not allowed.", warning);
  if ((exe === "curl" || exe === "wget") && looksLikeDownloadAndExecute(args)) return refuse(commandText, "Download-and-execute patterns are not allowed.", warning);
  if (exe === "git" && args[0] === "push") return confirm(commandText, "git push requires confirmation.", "This command may publish commits to a remote repository.");
  if (exe === "git" && args[0] === "reset" && args.includes("--hard")) return confirm(commandText, "git reset --hard requires confirmation.", warning, "destructive");
  if (exe === "git" && args[0] === "clean" && args.some(isForceFlag)) return confirm(commandText, "git clean with force requires confirmation.", warning, "destructive");

  if (exe === "rm") return confirm(commandText, "Deleting workspace files requires confirmation.", warning, "destructive");
  if (exe === "git" && ["commit", "checkout", "switch", "reset", "restore"].includes(args[0] ?? "")) return confirm(commandText, "This git command may modify workspace state.", warning);
  if (isWorkspaceInstall(exe, args)) return confirm(commandText, "Installing dependencies modifies the workspace.", warning);
  if (WRITE_COMMANDS.has(exe) || args.some(arg => arg === "--write" || arg === "--fix" || arg === "--fix-type")) return confirm(commandText, "This command may modify workspace files.", warning);

  const classification = classifyAllowed(exe, args);
  if (classification) return { action: "allow", reason: "Allowed safe bash read/test command.", classification, commandText };

  return confirm(commandText, "Unknown bash command requires confirmation.", warning);
}

function classifyAllowed(exe: string, args: string[]): "read" | "test" | undefined {
  if (exe === "git" && ["status", "diff", "log", "show"].includes(args[0] ?? "")) return "read";
  if (exe === "bun" && args[0] === "test") return "test";
  if (exe === "bun" && args[0] === "--version") return "read";
  if (exe === "bun" && args[0] === "run" && ["test", "typecheck", "check"].includes(args[1] ?? "")) return args[1] === "test" ? "test" : "read";
  if (exe === "npm" && args[0] === "test") return "test";
  if (exe === "node" && args[0] === "--version") return "read";
  if (READ_COMMANDS.has(exe)) return "read";
  return undefined;
}

function touchesUnsafePath(argv: string[], workspaceRoot: string): boolean {
  const exe = baseCommand(argv[0]).toLowerCase();
  return extractPathArgs(exe, argv.slice(1)).some(arg => isUnsafePathToken(arg, workspaceRoot));
}

function extractPathArgs(exe: string, args: string[]): string[] {
  if (exe === "rm" || exe === "rmdir" || exe === "mkdir" || exe === "touch" || exe === "cat" || exe === "head" || exe === "tail" || exe === "wc" || exe === "file" || exe === "stat") return extractPositionalArgs(args);
  if (exe === "cp" || exe === "mv") return extractPositionalArgs(args);
  if (exe === "rg" || exe === "grep" || exe === "find") return extractPositionalArgs(args).filter(arg => !looksLikeSearchPattern(arg));
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
  if (!subcommand) return [];
  const dashDash = args.indexOf("--");
  if (dashDash >= 0) return args.slice(dashDash + 1);
  if (subcommand === "restore") return extractPositionalArgs(args.slice(1));
  return [];
}

function isUnsafePathToken(value: string, workspaceRoot: string): boolean {
  if (!isPathLike(value)) return false;
  const normalized = normalizeShellPath(value);
  const lower = normalized.toLowerCase();
  if (normalized.startsWith("\\\\") || normalized.startsWith("//")) return true;
  if (SYSTEM_PATH_MARKERS.some(marker => lower === marker || lower.startsWith(`${marker}/`) || lower.startsWith(`${marker}\\`))) return true;

  const candidate = isAbsolute(normalized) ? resolve(normalized) : resolve(workspaceRoot, normalized);
  try {
    assertInsideWorkspace(workspaceRoot, candidate);
    return false;
  } catch {
    return true;
  }
}

function normalizeShellPath(value: string): string {
  const match = value.match(/^\/([a-zA-Z])\/(.*)$/);
  if (match) return `${match[1]}:/${match[2]}`;
  return value;
}

function isPathLike(value: string): boolean {
  return value === "/" || value.startsWith(".") || value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(value) || value.includes("/") || value.includes("\\");
}

function looksLikeSearchPattern(value: string): boolean {
  return !isPathLike(value) && !value.startsWith(".");
}

function hasCommandSubstitution(command: string): boolean {
  return command.includes("$(") || command.includes("`");
}

function hasUnsupportedShellSyntax(command: string): boolean {
  return command.includes("<<") || command.includes("<(") || command.includes(">(") || /\b(for|while|until|if|case|function)\b/.test(command) || command.includes("(){") || command.includes("() {");
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

function looksLikeDownloadAndExecute(args: string[]): boolean {
  return args.some(arg => SHELLS.has(baseCommand(arg).toLowerCase()));
}

function isRecursiveFlag(arg: string): boolean {
  return arg === "--recursive" || (/^-[^-]/.test(arg) && arg.includes("r"));
}

function isForceFlag(arg: string): boolean {
  return arg === "--force" || (/^-[^-]/.test(arg) && arg.includes("f"));
}

function getWarning(exe: string, args: string[]): string | undefined {
  if (exe === "rm") {
    if (args.some(isRecursiveFlag) && args.some(isForceFlag)) return "This command recursively and forcibly removes files.";
    if (args.some(isRecursiveFlag)) return "This command recursively removes files.";
    if (args.some(isForceFlag)) return "This command forcibly removes files.";
  }
  if (exe === "git" && args[0] === "push") return "This command may publish commits to a remote repository.";
  if (exe === "git" && args[0] === "reset" && args.includes("--hard")) return "This command may discard uncommitted changes.";
  if (exe === "git" && args[0] === "clean" && args.some(isForceFlag)) return "This command may permanently delete untracked files.";
  if (exe === "git" && args[0] === "commit" && args.includes("--amend")) return "This command rewrites the last commit.";
  if (exe === "git" && args[0] === "commit" && args.includes("--no-verify")) return "This command skips configured commit hooks.";
  return undefined;
}

function baseCommand(command: string): string {
  return command.replace(/\\/g, "/").split("/").pop() ?? command;
}

function allowRead(commandText: string, reason: string): ShellDecision {
  return { action: "allow", reason, classification: "read", commandText };
}

function confirm(commandText: string, reason: string, warning?: string, classification: "unknown" | "write" | "destructive" = "unknown"): ShellDecision {
  return { action: "confirm", reason, classification, warning, commandText };
}

function refuse(commandText: string, reason: string, warning?: string): ShellDecision {
  return { action: "refuse", reason, classification: "unknown", warning, commandText };
}
