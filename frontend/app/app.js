import { app, BrowserWindow, ipcMain, dialog, desktopCapturer } from "electron";
import { fork, execFile } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";

let electronWindow = null;
let startTimestamp = null;
let backendProcess = null;

// ─── Backend Process Management ─────────────────────────────────────────────
function checkBackendHealth(timeoutMs = 600) {
    return new Promise((resolve) => {
        const req = http.get("http://127.0.0.1:3000/", (res) => {
            resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function getBackendServerPath() {
    if (app.isPackaged) {
        const unpackedPath = path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "backend",
            "server.js"
        );
        if (fs.existsSync(unpackedPath)) return unpackedPath;
        return path.join(app.getAppPath(), "backend", "server.js");
    }
    return path.resolve(import.meta.dirname, "../../backend/server.js");
}

function getBackendDataPaths() {
    if (app.isPackaged) {
        const userData = app.getPath("userData");
        const dataDir = path.join(userData, "data");
        const questionsBundled = path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "backend",
            "data",
            "questions.json"
        );
        return {
            dataDir,
            questionsPath: fs.existsSync(questionsBundled)
                ? questionsBundled
                : path.join(app.getAppPath(), "backend", "data", "questions.json"),
            sessionsPath: path.join(dataDir, "sessions.json"),
        };
    }
    const rootBackendData = path.resolve(import.meta.dirname, "../../backend/data");
    return {
        dataDir: rootBackendData,
        questionsPath: path.join(rootBackendData, "questions.json"),
        sessionsPath: path.join(rootBackendData, "sessions.json"),
    };
}

async function ensureBackendRunning() {
    const isRunning = await checkBackendHealth();
    if (isRunning) {
        console.log("[Backend] Existing backend service detected on port 3000.");
        return;
    }

    const serverPath = getBackendServerPath();
    const { dataDir, questionsPath, sessionsPath } = getBackendDataPaths();

    console.log(`[Backend] Launching Express backend from: ${serverPath}`);
    console.log(`[Backend] Using data directory: ${dataDir}`);

    if (!fs.existsSync(dataDir)) {
        try {
            fs.mkdirSync(dataDir, { recursive: true });
        } catch (err) {
            console.error("[Backend] Failed to create data directory:", err);
        }
    }

    if (!fs.existsSync(sessionsPath)) {
        try {
            fs.writeFileSync(sessionsPath, "[]");
        } catch (err) {
            console.error("[Backend] Failed to initialize sessions file:", err);
        }
    }

    try {
        backendProcess = fork(serverPath, [], {
            env: {
                ...process.env,
                PORT: "3000",
                ATHENA_DATA_DIR: dataDir,
                ATHENA_QUESTIONS_PATH: questionsPath,
                ATHENA_SESSIONS_PATH: sessionsPath,
                ELECTRON_RUN_AS_NODE: "1",
            },
            stdio: "pipe",
        });

        if (backendProcess.stdout) {
            backendProcess.stdout.on("data", (data) =>
                console.log(`[Backend STDOUT] ${data.toString().trim()}`)
            );
        }
        if (backendProcess.stderr) {
            backendProcess.stderr.on("data", (data) =>
                console.error(`[Backend STDERR] ${data.toString().trim()}`)
            );
        }

        backendProcess.on("exit", (code, signal) => {
            console.log(`[Backend] Process exited (code: ${code}, signal: ${signal})`);
            backendProcess = null;
        });

        // Wait up to 3 seconds for backend to become responsive
        for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await checkBackendHealth(300)) {
                console.log("[Backend] Backend successfully initialized and responding.");
                break;
            }
        }
    } catch (err) {
        console.error("[Backend] Failed to start backend child process:", err);
    }
}

function cleanupBackend() {
    if (backendProcess) {
        console.log("[Backend] Stopping backend child process...");
        try {
            backendProcess.kill();
        } catch {
            // Process might already be stopped
        }
        backendProcess = null;
    }
}

// ─── Snapshot Directories ───────────────────────────────────────────────────
function getSnapshotsDir(type) {
    const baseDir = app.isPackaged
        ? path.join(app.getPath("userData"), "snapshots", type)
        : path.join(import.meta.dirname, type);

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    return baseDir;
}

// ─── Create the Renderer window ────────────────────────────────────────────
async function createWindow() {
    electronWindow = new BrowserWindow({
        title: "Athena Exam",
        height: 900,
        width: 1200,
        minWidth: 900,
        minHeight: 700,
        webPreferences: {
            devTools: !app.isPackaged,
            preload: path.join(import.meta.dirname, "preload.js"),
        },
    });

    // ── Enforce Keyboard Anti-Cheating Restrictions ──
    electronWindow.webContents.on("before-input-event", (event, input) => {
        const isMac = process.platform === "darwin";
        const cmdOrCtrl = isMac ? input.meta : input.control;
        const key = input.key ? input.key.toLowerCase() : "";

        // Block Quit / Close: Cmd+Q, Cmd+W
        if (cmdOrCtrl && (key === "q" || key === "w")) {
            event.preventDefault();
        }

        // Block Refresh / Reload: Cmd+R, Ctrl+R, F5
        if ((cmdOrCtrl && key === "r") || input.key === "F5") {
            event.preventDefault();
        }

        // Block DevTools shortcuts: Cmd+Alt+I, Ctrl+Shift+I, F12
        if (
            input.key === "F12" ||
            (cmdOrCtrl && input.alt && key === "i") ||
            (cmdOrCtrl && input.shift && key === "i")
        ) {
            if (app.isPackaged) {
                event.preventDefault();
            }
        }

        // Block standard clipboard & text manipulation in exam: Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+P, Cmd+S, Cmd+U
        if (cmdOrCtrl && ["c", "v", "x", "a", "p", "s", "u"].includes(key)) {
            event.preventDefault();
        }

        // Block screenshot shortcuts on macOS: Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5
        if (input.meta && input.shift && ["3", "4", "5"].includes(input.key)) {
            event.preventDefault();
        }

        // Block Escape key (prevent casual fullscreen exit)
        if (input.key === "Escape") {
            event.preventDefault();
        }
    });

    const distIndexPath = path.join(import.meta.dirname, "../dist/index.html");

    if (!app.isPackaged) {
        // In development, check if Vite dev server is running
        const isDevServerUp = await new Promise((resolve) => {
            const req = http.get("http://localhost:5173", () => resolve(true));
            req.on("error", () => resolve(false));
            req.setTimeout(500, () => {
                req.destroy();
                resolve(false);
            });
        });

        if (isDevServerUp) {
            console.log("[Electron] Loading dev server: http://localhost:5173");
            electronWindow.loadURL("http://localhost:5173");
            return;
        }
    }

    // Load built static production bundle
    if (fs.existsSync(distIndexPath)) {
        console.log(`[Electron] Loading built bundle: ${distIndexPath}`);
        electronWindow.loadFile(distIndexPath);
    } else {
        console.log("[Electron] dist/index.html not found, falling back to dev URL");
        electronWindow.loadURL("http://localhost:5173");
    }
}

// ─── IPC: Exam Timer ──────────────────────────────────────────────────────
ipcMain.handle("start-timer", () => {
    startTimestamp = Date.now();

    // Send timer tick to renderer every second
    setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send(
                "timer",
                ((Date.now() - startTimestamp) / 1000).toFixed(1)
            );
        }
    }, 1000);

    // Capture camera snapshot AND screen snapshot every 5 seconds
    setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send("camera-shot");
            electronWindow.webContents.send("screen-shot");
        }
    }, 5000);
});

// ─── IPC: Save camera snapshot to disk ───────────────────────────────────
ipcMain.handle("store-camera-snap-image-on-disk", (_event, data) => {
    const snapDir = getSnapshotsDir("user-camera-snap");
    const filePath = path.join(snapDir, `${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(data));
    console.log(`[Camera] Snapshot saved: ${filePath}`);
});

// ─── IPC: Get desktop sources for screen capture ──────────────────────────
ipcMain.handle("get-desktop-sources", async () => {
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
});

// ─── IPC: Save screen snapshot to disk ────────────────────────────────────
ipcMain.handle("store-screen-snap-image-on-disk", (_event, data) => {
    const snapDir = getSnapshotsDir("user-screen-snap");
    const filePath = path.join(snapDir, `${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(data));
    console.log(`[Screen] Snapshot saved: ${filePath}`);
});

// ─── IPC: Show exam rules dialog ──────────────────────────────────────────
ipcMain.on("show-rules", () => {
    if (electronWindow && !electronWindow.isDestroyed()) {
        dialog.showMessageBox(electronWindow, {
            type: "info",
            title: "Athena Exam Rules",
            message: "Exam Rules",
            detail:
                "1. Stay on the exam screen.\n" +
                "2. Camera must remain enabled.\n" +
                "3. Do not leave the exam.\n" +
                "4. Do not use external assistance.\n" +
                "5. Click Finish Exam when done.",
        });
    }
});

// ─── IPC: Detect Running Background Applications (macOS) ──────────────────
ipcMain.handle("get-running-apps", async () => {
    if (process.platform !== "darwin") {
        return [];
    }
    return new Promise((resolve) => {
        execFile(
            "osascript",
            [
                "-e",
                'tell application "System Events" to get name of every process whose background only is false',
            ],
            (err, stdout) => {
                if (err || !stdout) {
                    return resolve([]);
                }
                const apps = stdout
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean);

                const safeList = new Set([
                    "finder",
                    "electron",
                    "athena",
                    "athena exam",
                    "system events",
                    "loginwindow",
                    "dock",
                ]);

                const prohibited = apps.filter((app) => !safeList.has(app.toLowerCase()));
                resolve(prohibited);
            }
        );
    });
});

// ─── IPC: Reload Application Window ───────────────────────────────────────
ipcMain.on("reload-app", () => {
    if (electronWindow && !electronWindow.isDestroyed()) {
        console.log("[Electron] Reloading application window per proctoring policy...");
        electronWindow.reload();
    }
});

// ─── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    await ensureBackendRunning();
    await createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("before-quit", cleanupBackend);
app.on("will-quit", cleanupBackend);

app.on("window-all-closed", () => {
    cleanupBackend();
    if (process.platform !== "darwin") {
        app.quit();
    }
});