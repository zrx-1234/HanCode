/** Manifest describing a single installable skill. */
export type SkillManifest = {
  name: string;
  description: string;
  version?: string;
  /** Lowercased substring triggers that suggest this skill is relevant. */
  triggers: string[];
  /** Entry document (relative to the skill dir) loaded by the `skill` tool. */
  entry: string;
  /** Whether the skill's scripts require a Python runtime. */
  requiresPython?: boolean;
  /** requirements file (relative to the skill dir) used in dependency hints. */
  requirements?: string;
  /** Suggested minimum maxTurns for the skill's workflow. */
  recommendedMaxTurns?: number;
  /** Free-form notes shown to the model alongside the entry. */
  notes?: string;
};

/** A loaded skill: its manifest plus the resolved directory on disk. */
export type SkillRecord = {
  name: string;
  manifest: SkillManifest;
  dir: string;
};
