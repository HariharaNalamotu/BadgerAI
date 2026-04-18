"use strict";
const { app, BrowserWindow, shell } = require("electron");
const path   = require("path");
const http   = require("http");
const os     = require("os");
const fs     = require("fs");
const { spawn } = require("child_process");

const SERVICE_PORT = 8765;
let pythonProcess  = null;
let mainWindow     = null;

// ── Find Python ──────────────────────────────────────────────────────────────
function findPython() {
  const home = os.homedir();
  const candidates = [
    process.env.BADGERAI_PYTHON,
    path.join(home, "anaconda3",  "envs", "badgerai", "python.exe"),
    path.join(home, "miniconda3", "envs", "badgerai", "python.exe"),
    path.join(home, "AppData", "Local", "anaconda3",  "envs", "badgerai", "python.exe"),
    path.join(home, "AppData", "Local", "miniconda3", "envs", "badgerai", "python.exe"),
    "python",
  ].filter(Boolean);

  for (const p of candidates) {
    if (!path.isAbsolute(p)) return p;
    if (fs.existsSync(p)) return p;
  }
  return "python";
}

// ── Project root ─────────────────────────────────────────────────────────────
function getProjectRoot() {
  if (!app.isPackaged) {
    // dev: frontend/electron/main.cjs → go up two levels to repo root
    return path.join(__dirname, "..", "..");
  }
  // packaged: extraResources lands in resources/
  return process.resourcesPath;
}

// ── Service health check ──────────────────────────────────────────────────────
function checkService() {
  return new Promise(resolve => {
    const req = http.get(
      `http://127.0.0.1:${SERVICE_PORT}/v1/health`,
      res => resolve(res.statusCode === 200)
    );
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

// ── Start Python RAG service ──────────────────────────────────────────────────
async function startService() {
  const already = await checkService();
  if (already) {
    console.log("[electron] RAG service already running");
    return;
  }

  const python = findPython();
  const cwd    = getProjectRoot();
  console.log(`[electron] Starting service: ${python} in ${cwd}`);

  pythonProcess = spawn(
    python,
    ["-m", "uvicorn", "rag_service.server:app",
     "--host", "127.0.0.1", "--port", String(SERVICE_PORT)],
    { cwd, stdio: "ignore", detached: false, windowsHide: true }
  );

  pythonProcess.on("error", err =>
    console.error("[electron] Python service error:", err.message)
  );
}

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          820,
    minWidth:        900,
    minHeight:       600,
    backgroundColor: "#0a0a0a",
    titleBarStyle:   "default",
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "dist", "index.html")
    );
  }

  // Open external links in the default browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await startService();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (pythonProcess) {
    pythonProcess.kill("SIGTERM");
    pythonProcess = null;
  }
  if (process.platform !== "darwin") app.quit();
});
