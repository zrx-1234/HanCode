import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, PermissionMode } from "../../../../src/agent/types";

export type HanCodeDesktopApi = {
  pickWorkspace(): Promise<string | null>;
  openWorkspace(path: string): Promise<unknown>;
  showWorkspaceInFolder(path: string): Promise<void>;
  startTask(prompt: string): Promise<{ taskId: string }>;
  stopTask(taskId: string): Promise<void>;
  respondConfirmation(confirmationId: string, allowed: boolean): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  openExternal(url: string): Promise<void>;
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
};

const api: HanCodeDesktopApi = {
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  openWorkspace: path => ipcRenderer.invoke("workspace:open", path),
  showWorkspaceInFolder: path => ipcRenderer.invoke("workspace:show-in-folder", path),
  startTask: prompt => ipcRenderer.invoke("task:start", prompt),
  stopTask: taskId => ipcRenderer.invoke("task:stop", taskId),
  respondConfirmation: (confirmationId, allowed) => ipcRenderer.invoke("confirmation:respond", confirmationId, allowed),
  setPermissionMode: mode => ipcRenderer.invoke("permission:setMode", mode),
  openExternal: url => ipcRenderer.invoke("shell:openExternal", url),
  onAgentEvent(callback) {
    const listener = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent) => callback(agentEvent);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.off("agent:event", listener);
  },
};

contextBridge.exposeInMainWorld("hancode", api);
