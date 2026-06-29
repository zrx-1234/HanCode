//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
electron = __toESM(electron, 1);
let node_path = require("node:path");
let node_child_process = require("node:child_process");
let node_fs = require("node:fs");
let node_readline = require("node:readline");
//#region apps/desktop/src/main/sidecarClient.ts
var SidecarClient = class {
	app;
	child;
	sequence = 0;
	pending = /* @__PURE__ */ new Map();
	eventHandler;
	constructor(app) {
		this.app = app;
	}
	onAgentEvent(handler) {
		this.eventHandler = handler;
	}
	async openWorkspace(workspacePath) {
		return await this.request({
			type: "workspace.open",
			workspacePath
		});
	}
	async startTask(taskId, prompt) {
		return await this.request({
			type: "task.start",
			taskId,
			prompt
		});
	}
	async stopTask(taskId) {
		return await this.request({
			type: "task.stop",
			taskId
		});
	}
	async respondConfirmation(confirmationId, allowed) {
		return await this.request({
			type: "confirmation.respond",
			confirmationId,
			allowed
		});
	}
	async setPermissionMode(mode) {
		return await this.request({
			type: "permission.setMode",
			mode
		});
	}
	dispose() {
		this.child?.kill();
		this.child = void 0;
	}
	async request(command) {
		const id = `req-${++this.sequence}`;
		this.ensureStarted();
		const child = this.child;
		if (!child) throw new Error("Sidecar failed to start.");
		const payload = {
			id,
			...command
		};
		const promise = new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve,
				reject
			});
		});
		child.stdin.write(`${JSON.stringify(payload)}\n`);
		return await promise;
	}
	ensureStarted() {
		if (this.child) return;
		const child = (0, node_child_process.spawn)(resolveBunExecutable(), ["run", this.app.isPackaged ? `${process.resourcesPath}/sidecar.ts` : "src/desktop/sidecar.ts"], {
			cwd: this.app.isPackaged ? process.resourcesPath : process.cwd(),
			stdio: "pipe",
			windowsHide: true
		});
		this.child = child;
		child.stderr.on("data", (chunk) => {
			console.error(`[sidecar] ${String(chunk)}`);
		});
		child.on("error", (error) => {
			for (const [, pending] of this.pending) pending.reject(error);
			this.pending.clear();
		});
		child.on("exit", () => {
			this.child = void 0;
			for (const [, pending] of this.pending) pending.reject(/* @__PURE__ */ new Error("HanCode sidecar exited."));
			this.pending.clear();
		});
		(0, node_readline.createInterface)({ input: child.stdout }).on("line", (line) => this.handleLine(line));
	}
	handleLine(line) {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			console.error(`[sidecar] non-json stdout: ${line}`);
			return;
		}
		if (message.type === "agent.event") {
			this.eventHandler?.(message.event);
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.ok) pending.resolve(message.result);
		else pending.reject(new Error(message.error || "Sidecar request failed."));
	}
};
function resolveBunExecutable() {
	const configured = process.env.HANCODE_BUN_PATH;
	if (configured) return configured;
	if (process.platform !== "win32") return "bun";
	const npmBun = resolveNpmShimTarget("bun.cmd");
	if (npmBun) return npmBun;
	return [(0, node_path.join)(process.env.APPDATA ?? "", "npm", "node_modules", "bun", "bin", "bun.exe"), (0, node_path.join)(process.env.LOCALAPPDATA ?? "", "bun", "bun.exe")].find((candidate) => candidate && (0, node_fs.existsSync)(candidate)) ?? "bun.exe";
}
function resolveNpmShimTarget(shimName) {
	const pathEntries = (process.env.PATH ?? "").split(";").filter(Boolean);
	for (const entry of pathEntries) {
		const shim = (0, node_path.join)(entry, shimName);
		if (!(0, node_fs.existsSync)(shim)) continue;
		const match = (0, node_fs.readFileSync)(shim, "utf8").match(/"%dp0%\\([^\"]+)"/);
		if (!match) continue;
		const target = (0, node_path.join)((0, node_path.dirname)(shim), match[1]);
		if ((0, node_fs.existsSync)(target)) return target;
	}
}
//#endregion
//#region apps/desktop/src/main/index.ts
var { app, BrowserWindow, dialog, ipcMain, shell } = electron.default;
var mainWindow;
var sidecar;
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 960,
		minHeight: 640,
		title: "HanCode Desktop",
		webPreferences: {
			preload: (0, node_path.join)(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	sidecar.onAgentEvent((event) => {
		mainWindow?.webContents.send("agent:event", event);
	});
	if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	else mainWindow.loadFile((0, node_path.join)(__dirname, "../renderer/index.html"));
}
app.whenReady().then(() => {
	sidecar = new SidecarClient(app);
	registerIpc();
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	sidecar.dispose();
	if (process.platform !== "darwin") app.quit();
});
function registerIpc() {
	ipcMain.handle("workspace:pick", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ["openDirectory"],
			title: "Select HanCode workspace"
		});
		return result.canceled ? null : result.filePaths[0];
	});
	ipcMain.handle("workspace:open", async (_event, workspacePath) => {
		return await sidecar.openWorkspace(workspacePath);
	});
	ipcMain.handle("workspace:show-in-folder", async (_event, workspacePath) => {
		await shell.openPath(workspacePath);
	});
	ipcMain.handle("task:start", async (_event, prompt) => {
		const taskId = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		await sidecar.startTask(taskId, prompt);
		return { taskId };
	});
	ipcMain.handle("task:stop", async (_event, taskId) => {
		await sidecar.stopTask(taskId);
	});
	ipcMain.handle("permission:setMode", async (_event, mode) => {
		await sidecar.setPermissionMode(mode);
	});
	ipcMain.handle("shell:openExternal", async (_event, url) => {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http/https links can be opened.");
		await shell.openExternal(parsed.toString());
	});
	ipcMain.handle("confirmation:respond", async (_event, confirmationId, allowed) => {
		await sidecar.respondConfirmation(confirmationId, allowed);
	});
}
//#endregion
