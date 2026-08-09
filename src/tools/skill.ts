import type { HanCodeTool, ToolContext, ToolExecutionResult } from "../agent/types";
import { skillInput } from "./schemas";
import { loadSkillEntry, listSkillScripts } from "../skills/loader";
import { checkSkillDeps } from "../skills/python";

export const SKILL_TOOL_NAME = "skill";

/**
 * Loads a skill's instruction document (SKILL.md) into the conversation on
 * demand. Skills are bundled workflow guides - the `ppt-master` skill, for
 * example, turns source documents into PPTX via a multi-step pipeline that the
 * model drives using the regular file/bash tools.
 *
 * The returned text has `${SKILL_DIR}` resolved to an absolute path, so the
 * model can invoke the skill's Python scripts directly through `bash`.
 */
export const skillTool: HanCodeTool = {
  definition: {
    name: SKILL_TOOL_NAME,
    description:
      "Load a skill's full instruction document by name. Skills are bundled workflow guides (SKILL.md) with associated Python scripts and templates. When the user's request matches a skill's trigger (e.g. 'make a PPT', '做PPT'), call this tool first to load the skill, then follow its instructions using the available tools. Returns the instruction text with ${SKILL_DIR} resolved to an absolute path, a script index, and a Python environment check.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Skill name, e.g. ppt-master." },
      },
      required: ["name"],
    },
  },
  async execute(input, ctx: ToolContext): Promise<ToolExecutionResult> {
    const parsed = skillInput.parse(input);
    const registry = ctx.skills;
    if (!registry) {
      return { content: "Skill system is not available in this context.", isError: true };
    }

    const skill = registry.get(parsed.name);
    if (!skill) {
      const available = registry.list().map(s => `- ${s.name}: ${s.manifest.description}`).join("\n");
      return {
        content: `Unknown skill: ${parsed.name}.\nAvailable skills:\n${available || "(none)"}`,
        isError: true,
      };
    }

    try {
      const entry = loadSkillEntry(skill);
      const scripts = listSkillScripts(skill);
      const pyCheck = skill.manifest.requiresPython ? checkSkillDeps(skill) : undefined;

      const parts: string[] = [`# Skill: ${skill.name} (v${skill.manifest.version ?? "unknown"})`, "", entry];

      if (scripts.length > 0) {
        parts.push("", `## Scripts available in \`${skill.name}/scripts/\``, scripts.map(s => `- ${s}`).join("\n"));
      }
      if (pyCheck) {
        parts.push("", "## Python environment", pyCheck.message);
        if (!pyCheck.available) {
          parts.push("", "Install the dependencies above, then call this skill again before running its scripts.");
        }
      }
      if (skill.manifest.recommendedMaxTurns) {
        parts.push(
          "",
          "## Workflow length",
          `This skill is a long workflow; recommended maxTurns >= ${skill.manifest.recommendedMaxTurns}. If the current run's maxTurns is lower, prefer the skill's split/resume mode or raise maxTurns in hancode.config.json.`,
        );
      }
      if (skill.manifest.notes) {
        parts.push("", "## Notes", skill.manifest.notes);
      }

      return { content: parts.join("\n"), isError: false };
    } catch (error) {
      return {
        content: `Failed to load skill ${parsed.name}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
};
