import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { SkillRecord } from "./types";

export type PythonCheck = {
  available: boolean;
  executable: string | undefined;
  message: string;
};

// On Windows, python3/python are usually resolved via PATHEXT, so shell:true is required.
const SHELL = process.platform === "win32";

/** Finds a usable Python interpreter, preferring `python3` then `python`. */
export function detectPython(): string | undefined {
  for (const candidate of ["python3", "python"]) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "pipe", shell: SHELL });
      if (result.status === 0) return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/**
 * Checks whether the skill's Python dependencies look installed by probing a
 * representative subset. Never throws - returns a human-readable message the
 * agent can relay to the user when something is missing.
 */
export function checkSkillDeps(skill: SkillRecord, executable?: string): PythonCheck {
  const python = executable ?? detectPython();
  if (!python) {
    return {
      available: false,
      executable: undefined,
      message: "Python not found. Install Python 3 and ensure 'python3' (or 'python' on Windows) is on PATH.",
    };
  }
  // Probe core packages the ppt-master pipeline depends on (python-pptx, PyMuPDF, mammoth, Pillow).
  const probe = spawnSync(python, ["-c", "import pptx, fitz, mammoth, PIL"], { stdio: "pipe", shell: SHELL });
  if (probe.status !== 0) {
    const reqPath = skill.manifest.requirements
      ? join(skill.dir, skill.manifest.requirements).replace(/\\/g, "/")
      : `${skill.dir.replace(/\\/g, "/")}/requirements.txt`;
    return {
      available: false,
      executable: python,
      message: `Python found (${python}) but required packages are missing. Install them:\n  ${python} -m pip install -r ${reqPath}`,
    };
  }
  return { available: true, executable: python, message: `Python ready (${python}).` };
}
