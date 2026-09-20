import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SidecarClient } from "./sidecarClient";

let mainWindow: InstanceType<typeof BrowserWindow> | undefined;
let sidecar: SidecarClient;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "HanCode Desktop",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  sidecar.onAgentEvent(event => {
    mainWindow?.webContents.send("agent:event", event);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ensureUserConfig();
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

/**
 * Seeds `hancode.config.json` in userData on first launch so users have an
 * obvious place to put their API key. The sidecar reads it from there
 * (HANCODE_CONFIG_DIR) when the app is packaged.
 */
function ensureUserConfig(): void {
  const target = join(app.getPath("userData"), "hancode.config.json");
  if (existsSync(target)) return;
  const source = app.isPackaged
    ? join(process.resourcesPath, "hancode.config.example.json")
    : join(app.getAppPath(), "hancode.config.example.json");
  if (!existsSync(source)) return;
  try {
    copyFileSync(source, target);
  } catch (error) {
    console.error(`[hancode] failed to seed user config: ${error}`);
  }
}

function registerIpc(): void {
  ipcMain.handle("workspace:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "Select HanCode workspace",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("workspace:open", async (_event, workspacePath: string) => {
    return await sidecar.openWorkspace(workspacePath);
  });

  ipcMain.handle("workspace:show-in-folder", async (_event, workspacePath: string) => {
    await shell.openPath(workspacePath);
  });

  ipcMain.handle("task:start", async (_event, prompt: string) => {
    const taskId = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await sidecar.startTask(taskId, prompt);
    return { taskId };
  });

  ipcMain.handle("task:stop", async (_event, taskId: string) => {
    await sidecar.stopTask(taskId);
  });

  ipcMain.handle("permission:setMode", async (_event, mode: string) => {
    await sidecar.setPermissionMode(mode);
  });

  ipcMain.handle("config:get", async () => {
    return await sidecar.getConfig();
  });

  ipcMain.handle("config:update", async (_event, config: Record<string, unknown>) => {
    return await sidecar.updateConfig(config);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http/https links can be opened.");
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle("confirmation:respond", async (_event, confirmationId: string, allowed: boolean) => {
    await sidecar.respondConfirmation(confirmationId, allowed);
  });
}
