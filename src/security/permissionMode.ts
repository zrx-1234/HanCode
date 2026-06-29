import type { PermissionMode } from "../agent/types";

export type PermissionDecisionLike = {
  action: "allow" | "confirm" | "refuse";
  reason: string;
};

export function applyPermissionMode<T extends PermissionDecisionLike>(decision: T, mode: PermissionMode): T {
  if (decision.action === "refuse" || mode === "normal") return decision;
  if (mode === "safe" && decision.action === "allow") {
    return { ...decision, action: "confirm", reason: `Safe mode requires confirmation: ${decision.reason}` };
  }
  if (mode === "super" && decision.action === "confirm") {
    return { ...decision, action: "allow", reason: `Super mode auto-approved: ${decision.reason}` };
  }
  return decision;
}
