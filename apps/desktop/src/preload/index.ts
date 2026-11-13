import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, PermissionMode } from "../../../../src/agent/types";

export type HanCodeDesktopApi = {
  pickWorkspace(): Promise<string | null>;
  openWorkspace(path: string): Promise<unknown>;
  showWorkspaceInFolder(path: string): Promise<void>;
  startTask(prompt: string, images?: Array<{ mediaType: string; data: string }>): Promise<{ taskId: string }>;
  stopTask(taskId: string): Promise<void>;
  clearSession(): Promise<unknown>;
  respondConfirmation(confirmationId: string, allowed: boolean): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  openExternal(url: string): Promise<void>;
  getConfig(): Promise<{ path: string; config: Record<string, unknown> }>;
  updateConfig(config: Record<string, unknown>): Promise<{ path: string; workspace?: unknown }>;
  listProfiles(): Promise<{ profiles: Array<{ name: string; active: boolean }> }>;
  saveProfile(name: string, config: Record<string, unknown>): Promise<{ profiles: Array<{ name: string; active: boolean }>; workspace?: unknown }>;
  deleteProfile(name: string): Promise<{ profiles: Array<{ name: string; active: boolean }> }>;
  activateProfile(name: string): Promise<{ profiles: Array<{ name: string; active: boolean }>; config: Record<string, unknown>; workspace?: unknown }>;
  openConfigFile(): Promise<void>;
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
};

const api: HanCodeDesktopApi = {
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  openWorkspace: path => ipcRenderer.invoke("workspace:open", path),
  showWorkspaceInFolder: path => ipcRenderer.invoke("workspace:show-in-folder", path),
  startTask: (prompt, images) => ipcRenderer.invoke("task:start", prompt, images),
  stopTask: taskId => ipcRenderer.invoke("task:stop", taskId),
  clearSession: () => ipcRenderer.invoke("session:clear"),
  respondConfirmation: (confirmationId, allowed) => ipcRenderer.invoke("confirmation:respond", confirmationId, allowed),
  setPermissionMode: mode => ipcRenderer.invoke("permission:setMode", mode),
  openExternal: url => ipcRenderer.invoke("shell:openExternal", url),
  getConfig: () => ipcRenderer.invoke("config:get"),
  updateConfig: config => ipcRenderer.invoke("config:update", config),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  saveProfile: (name, config) => ipcRenderer.invoke("profiles:save", name, config),
  deleteProfile: name => ipcRenderer.invoke("profiles:delete", name),
  activateProfile: name => ipcRenderer.invoke("profiles:activate", name),
  openConfigFile: () => ipcRenderer.invoke("config:open-file"),
  onAgentEvent(callback) {
    const listener = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent) => callback(agentEvent);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.off("agent:event", listener);
  },
};

contextBridge.exposeInMainWorld("hancode", api);
