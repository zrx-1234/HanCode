import { describe, expect, test } from "bun:test";
import { applyPermissionMode } from "../src/security/permissionMode";

describe("applyPermissionMode", () => {
  const allow = { action: "allow" as const, reason: "allowed", classification: "read" as const };
  const confirm = { action: "confirm" as const, reason: "needs confirm", classification: "unknown" as const };
  const destructive = { action: "confirm" as const, reason: "destructive", classification: "destructive" as const };
  const refuse = { action: "refuse" as const, reason: "refused" };

  test("normal mode passes through unchanged", () => {
    expect(applyPermissionMode(allow, "normal")).toEqual(allow);
    expect(applyPermissionMode(confirm, "normal")).toEqual(confirm);
    expect(applyPermissionMode(refuse, "normal")).toEqual(refuse);
  });

  test("safe mode turns allow into confirm", () => {
    const result = applyPermissionMode(allow, "safe");
    expect(result.action as string).toBe("confirm");
    expect(result.reason).toContain("Safe mode requires confirmation");
  });

  test("safe mode leaves confirm and refuse alone", () => {
    expect(applyPermissionMode(confirm, "safe")).toEqual(confirm);
    expect(applyPermissionMode(refuse, "safe")).toEqual(refuse);
  });

  test("super mode auto-approves confirm (non-destructive)", () => {
    const result = applyPermissionMode(confirm, "super");
    expect(result.action as string).toBe("allow");
    expect(result.reason).toContain("Super mode auto-approved");
  });

  test("super mode still requires confirmation for destructive commands", () => {
    const result = applyPermissionMode(destructive, "super");
    expect(result.action as string).toBe("confirm");
    expect(result.reason).toBe("destructive");
  });

  test("super mode refuses refuse", () => {
    expect(applyPermissionMode(refuse, "super")).toEqual(refuse);
  });

  test("preserves warning field through transformation", () => {
    const withWarning = { ...confirm, warning: "Be careful!" };
    const result = applyPermissionMode(withWarning, "super");
    expect(result.action as string).toBe("allow");
    expect(result.warning).toBe("Be careful!");
  });
});
