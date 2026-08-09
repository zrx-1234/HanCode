import { z } from "zod";

export const readFileInput = z.object({
  path: z.string(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const listFilesInput = z.object({
  path: z.string().optional(),
  pattern: z.string().optional(),
  max_results: z.number().int().positive().optional(),
});

export const searchTextInput = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  case_sensitive: z.boolean().optional(),
  max_results: z.number().int().positive().optional(),
  context_lines: z.number().int().nonnegative().optional(),
});

export const editFileInput = z.object({
  path: z.string(),
  old_text: z.string(),
  new_text: z.string(),
});

export const writeFileInput = z.object({
  path: z.string(),
  content: z.string(),
  overwrite: z.boolean().optional(),
});

export const runCommandInput = z.object({
  command: z.string().trim().min(1, "Command cannot be empty."),
  args: z.array(z.string()).default([]),
  timeout_ms: z.number().int().positive().optional(),
  reason: z.string().trim().optional(),
});

export const bashInput = z.object({
  command: z.string().trim().min(1, "Command cannot be empty."),
  timeout_ms: z.number().int().positive().optional(),
  description: z.string().trim().optional(),
});

export const webSearchInput = z.object({
  query: z.string().trim().min(1, "Query cannot be empty."),
  allowed_domains: z.array(z.string().trim().min(1)).optional(),
  blocked_domains: z.array(z.string().trim().min(1)).optional(),
  num_results: z.number().int().positive().optional(),
}).refine(value => !(value.allowed_domains && value.blocked_domains), {
  message: "allowed_domains and blocked_domains cannot both be provided.",
});

export const webFetchInput = z.object({
  url: z.string().trim().url(),
  prompt: z.string().trim().optional(),
  max_chars: z.number().int().positive().optional(),
});

export const agentToolInput = z.object({
  agents: z.array(
    z.object({
      id: z.string().optional(),
      prompt: z.string().min(1, "Sub-agent prompt cannot be empty."),
      max_turns: z.number().int().positive().optional(),
      effort: z.enum(["auto", "low", "medium", "high", "xhigh", "max"]).optional(),
      model: z.string().optional(),
    }),
  ).min(1, "At least one sub-agent is required."),
});

export const skillInput = z.object({
  name: z.string().trim().min(1, "Skill name cannot be empty."),
});
