let electron = require("electron");
//#region apps/desktop/src/preload/index.ts
electron.contextBridge.exposeInMainWorld("hancode", {
	pickWorkspace: () => electron.ipcRenderer.invoke("workspace:pick"),
	openWorkspace: (path) => electron.ipcRenderer.invoke("workspace:open", path),
	showWorkspaceInFolder: (path) => electron.ipcRenderer.invoke("workspace:show-in-folder", path),
	startTask: (prompt) => electron.ipcRenderer.invoke("task:start", prompt),
	stopTask: (taskId) => electron.ipcRenderer.invoke("task:stop", taskId),
	respondConfirmation: (confirmationId, allowed) => electron.ipcRenderer.invoke("confirmation:respond", confirmationId, allowed),
	setPermissionMode: (mode) => electron.ipcRenderer.invoke("permission:setMode", mode),
	openExternal: (url) => electron.ipcRenderer.invoke("shell:openExternal", url),
	onAgentEvent(callback) {
		const listener = (_event, agentEvent) => callback(agentEvent);
		electron.ipcRenderer.on("agent:event", listener);
		return () => electron.ipcRenderer.off("agent:event", listener);
	}
});
//#endregion
