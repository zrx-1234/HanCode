#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "../agent/prompt";
import { runAgent } from "../agent/loop";
import { createAgentSession } from "../agent/types";
import type { AgentEvent, AgentSession, ConfirmationRequest, PermissionMode } from "../agent/types";
import { loadConfig } from "../config";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

type SidecarCommand =
  | { id: string; type: "workspace.open"; workspacePath: string }
  | { id: string; type: "task.start"; taskId: string; prompt: string }
  | { id: string; type: "task.stop"; taskId: string }
  | { id: string; type: "confirmation.respond"; confirmationId: string; allowed: boolean }
  | { id: string; type: "permission.setMode"; mode: PermissionMode }
  | { id: string; type: "shutdown" };

type WorkspaceState = {
  config: ReturnType<typeof loadConfig>;
  system: string;
  session: AgentSession;
  permissionMode: PermissionMode;
};

type PendingConfirmation = {
  resolve: (allowed: boolean) => void;
};

let workspace: WorkspaceState | undefined;
let activeTask: { taskId: string; controller: AbortController } | undefined;
const pendingConfirmations = new Map<string, PendingConfirmation>();
let pendingPermissionMode: PermissionMode = "normal";

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let command: SidecarCommand;
  try {
    command = JSON.parse(trimmed) as SidecarCommand;
  } catch (error) {
    sendEvent({ type: "run.error", taskId: "unknown", message: `Invalid sidecar command: ${error instanceof Error ? error.message : String(error)}` });
    continue;
  }
  void handleCommand(command);
}

async function handleCommand(command: SidecarCommand): Promise<void> {
  try {
    switch (command.type) {
      case "workspace.open": {
        const config = loadConfig(command.workspacePath);
        workspace = {
          config,
          system: buildSystemPrompt(config.workspaceRoot),
          session: createAgentSession(),
          permissionMode: pendingPermissionMode,
        };
        sendResponse(command.id, true, {
          workspaceRoot: config.workspaceRoot,
          model: config.model,
          baseURL: config.baseURL,
          effort: config.effort,
          maxTurns: config.maxTurns,
          webEnabled: config.web.enabled,
        });
        return;
      }
      case "task.start": {
        if (!workspace) throw new Error("Open a workspace before starting a task.");
        if (activeTask) throw new Error("A task is already running.");
        const controller = new AbortController();
        activeTask = { taskId: command.taskId, controller };
        sendResponse(command.id, true, { taskId: command.taskId });
        runTask(command.taskId, command.prompt, controller).catch(error => {
          sendEvent({ type: "run.error", taskId: command.taskId, message: errorToMessage(error) });
        });
        return;
      }
      case "task.stop": {
        if (activeTask?.taskId === command.taskId) {
          sendEvent({ type: "run.stopped", taskId: command.taskId });
          activeTask.controller.abort();
          resolveAllConfirmations(false);
          activeTask = undefined;
        }
        sendResponse(command.id, true);
        return;
      }
      case "confirmation.respond": {
        const pending = pendingConfirmations.get(command.confirmationId);
        if (!pending) throw new Error(`Unknown confirmation id: ${command.confirmationId}`);
        pendingConfirmations.delete(command.confirmationId);
        pending.resolve(command.allowed);
        sendResponse(command.id, true);
        return;
      }
      case "permission.setMode": {
        pendingPermissionMode = command.mode;
        if (workspace) workspace.permissionMode = command.mode;
        sendResponse(command.id, true, { mode: command.mode });
        return;
      }
      case "shutdown": {
        activeTask?.controller.abort();
        resolveAllConfirmations(false);
        sendResponse(command.id, true);
        process.exit(0);
      }
    }
  } catch (error) {
    sendResponse(command.id, false, undefined, errorToMessage(error));
  }
}

async function runTask(taskId: string, prompt: string, controller: AbortController): Promise<void> {
  if (!workspace) throw new Error("Workspace is not open.");
  const current = workspace;
  try {
    await runAgent({
      taskId,
      prompt,
      workspaceRoot: current.config.workspaceRoot,
      apiKey: current.config.apiKey,
      model: current.config.model,
      baseURL: current.config.baseURL,
      maxTurns: current.config.maxTurns,
      effort: current.config.effort,
      web: current.config.web,
      system: current.system,
      session: current.session,
      signal: controller.signal,
      permissionMode: current.permissionMode,
      emit: event => sendEvent(event),
      confirm: request => requestConfirmation(taskId, request),
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      sendEvent({ type: "run.error", taskId, message: "Missing or invalid Anthropic credentials. Set apiKey in hancode.config.json." });
    } else if (error instanceof Anthropic.RateLimitError) {
      sendEvent({ type: "run.error", taskId, message: "Anthropic rate limit reached. Try again later." });
    } else if (error instanceof Anthropic.APIError) {
      sendEvent({ type: "run.error", taskId, message: `Anthropic API error ${error.status}: ${error.message}` });
    } else if (!controller.signal.aborted) {
      sendEvent({ type: "run.error", taskId, message: errorToMessage(error) });
    }
  } finally {
    if (activeTask?.taskId === taskId) activeTask = undefined;
    resolveAllConfirmations(false);
  }
}

async function requestConfirmation(taskId: string, request: ConfirmationRequest): Promise<boolean> {
  const confirmationId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sendEvent({ type: "confirmation.requested", taskId, confirmationId, request });
  return await new Promise<boolean>(resolve => {
    pendingConfirmations.set(confirmationId, { resolve });
  });
}

function resolveAllConfirmations(allowed: boolean): void {
  for (const [, pending] of pendingConfirmations) pending.resolve(allowed);
  pendingConfirmations.clear();
}

function sendResponse(id: string, ok: boolean, result?: unknown, error?: string): void {
  writeJson(ok ? { type: "response", id, ok, result } : { type: "response", id, ok, error });
}

function sendEvent(event: AgentEvent): void {
  writeJson({ type: "agent.event", event });
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
