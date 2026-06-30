import type { PermissionMode } from "../agent/types";

export type PermissionDecisionLike = {
  action: "allow" | "confirm" | "refuse";
  reason: string;
  classification?: string;
  warning?: string;
};

/**
 * Apply the user's permission mode to a policy decision.
 *
 * - safe  : even "allow" decisions become "confirm"
 * - normal: pass through unchanged
 * - super : auto-approve "confirm" decisions, EXCEPT for commands classified
 *           as "destructive" (e.g. rm, git reset --hard). Destructive commands
 *           always require explicit user confirmation regardless of mode.
 */
export function applyPermissionMode<T extends PermissionDecisionLike>(decision: T, mode: PermissionMode): T {
  if (decision.action === "refuse" || mode === "normal") return decision;

  if (mode === "safe" && decision.action === "allow") {
    return { ...decision, action: "confirm", reason: `Safe mode requires confirmation: ${decision.reason}` };
  }

  if (mode === "super" && decision.action === "confirm") {
    // Never auto-approve destructive commands, even in super mode.
    if (decision.classification === "destructive") return decision;
    return { ...decision, action: "allow", reason: `Super mode auto-approved: ${decision.reason}` };
  }

  return decision;
}
