# 🏛️ ATHENA — Examination & Remote Proctoring Suite

> **A high-security, editorial-grade desktop examination platform combining automated proctoring, process tree lockdown, dual stream auditing, and standalone macOS DMG packaging.**

---

## 📖 Overview

**Athena** is an examination and assessment suite engineered for remote testing environments. Wrapped in an Electron shell with a React (Vite) interface and backed by an Express REST API, Athena enforces strict academic integrity while delivering an editorial UI designed around warm limestone beige, architectural white, charcoal grey, and matte obsidian black.

---

## 🛡️ Proctoring & Anti-Cheat Features

Athena features security checkpoints and background monitors to deter unauthorized assistance:

### 1. 🔒 Fullscreen Lockdown & Instant Backend Flagging
- **Strict Kiosk Enforcement:** The assessment requires full-screen isolation.
- **Lockdown on Exit:** If a candidate attempts to minimize, window-toggle, or exit fullscreen mode during an active exam:
  - The examination interface is **immediately locked** and question selection is disabled.
  - An automated violation payload is transmitted to the Express backend (`POST /exam/flag`) registering a `FULLSCREEN_EXIT` event with timestamps.
  - The student is presented with a security lockdown modal and must re-engage fullscreen mode to resume.
  - Cumulative violations are displayed on the header and attached to the candidate's final record.

### 2. 🔍 Background Application Tracking on Startup
- **Process Tree Auditing:** On application launch, the Electron main process invokes native macOS process auditing to inspect running applications.
- **Prohibited Application Detection:** Detects unauthorized external applications such as browsers (Chrome, Safari, Firefox), communication tools (Slack, Discord, WhatsApp, Zoom), or terminal utilities.
- **Mandatory Closure Prompt:** Candidates are blocked from entering the assessment until prohibited applications are terminated, with real-time re-scanning verification.

### 3. ⌨️ Low-Level Keyboard Shortcut Interception
- Prevents system navigation, cheating, and context-switching shortcuts directly at the Electron input pipeline:
  - **Window Closure:** `Cmd + Q`, `Cmd + W`
  - **Interface Reload:** `Cmd + R`, `Ctrl + R`, `F5`
  - **Clipboard & Text Manipulation:** `Cmd + C`, `Cmd + V`, `Cmd + X`, `Cmd + A`, `Cmd + P`, `Cmd + S`, `Cmd + U`
  - **macOS Screenshot Shortcuts:** `Cmd + Shift + 3`, `Cmd + Shift + 4`, `Cmd + Shift + 5`
  - **Developer Tools:** `Cmd + Option + I`, `Ctrl + Shift + I`, `F12`
  - **Escape Key:** Disabled during active exams to prevent inadvertent kiosk exits.
  - **Context Menu:** Right-click inspect and context menus are completely disabled.

### 4. 🎥 Dual Proctoring Streams (Camera + Desktop Screen Share)
- **Facial Presence Stream:** Real-time web camera feed authorized during security calibration.
- **Desktop Screen Share Stream:** Synchronous screen share capture monitoring the candidate's entire display workspace.
- **Automated Archiving:** Electron automatically captures high-resolution camera and screen frames every 5 seconds, archiving them directly to the user's secure application data directory (`user-camera-snap` and `user-screen-snap`).

### 5. ⏱️ Duration Enforcement & Automatic App Reload
- **Allotted Time Tracker:** Tracks active exam seconds via high-precision main process IPC.
- **Automated Concluding Action:** If the exam duration exceeds the maximum permitted duration (e.g. 15 minutes / 900 seconds), the session is automatically finalized, flagged, and the application is cleanly reloaded to conclude the test.

---

## 🎨 Design System & Aesthetic Concept

The UI is inspired by modern editorial aesthetics:

- **Warm Limestone Beige (`#F6F4EE` & `#FAF8F4`):** Warm parchment background with subtle radial depth gradients.
- **Architectural White (`#FFFFFF`):** High-clarity elevated surface cards with soft warm-tone shadows.
- **Rich Obsidian Matte Black (`#121211`):** High-contrast primary action buttons, active MCQ selections, circular score badges, and monogram logos.
- **Charcoal & Warm Grey (`#5C5B55` / `#8C8A82`):** Refined secondary typography and status indicators.
- **Typography:**
  - **Headings & Display:** `Cormorant Garamond` (Google Fonts)
  - **Body & Controls:** `Plus Jakarta Sans` (Google Fonts)
  - **Timers & Tokens:** `SF Mono` / Monospace

---

## 🏗️ Project Architecture

```
Athena-Clone2/
├── dist-electron/                 ← Packaged build output
│   ├── Athena-1.0.0-arm64.dmg    ← Standalone macOS DMG installer (~129 MB)
│   └── mac-arm64/Athena.app       ← Ready-to-run macOS Application Bundle
│
├── backend/                       ← Express REST API server
│   ├── data/
│   │   ├── questions.json         ← Multiple-choice question bank
│   │   └── sessions.json          ← Persistent session records & violation logs
│   ├── server.js                  ← API routes (port 3000)
│   └── package.json
│
├── frontend/                      ← React + Vite Renderer & Electron Shell
│   ├── app/
│   │   ├── app.js                 ← Electron main process (lifecycle, IPC, proctoring)
│   │   └── preload.js             ← Secure IPC bridge (contextBridge)
│   ├── src/
│   │   ├── api.js                 ← API client layer (Vite dev proxy + production fallback)
│   │   ├── App.jsx                ← React root (Setup, Register, Exam, Result)
│   │   ├── App.css                ← Minimal chic design stylesheet
│   │   └── main.jsx               ← React mounting
│   ├── vite.config.js             ← Vite bundler configuration (base: './')
│   └── package.json
│
├── build/
│   └── icon.png                   ← High-resolution 512x512 app icon
├── package.json                   ← Root orchestrator & electron-builder configuration
├── student.md                     ← Chronological engineering & integration log
└── README.md                      ← This documentation
```

---

## 🚀 How to Run

### Method 1: Install & Launch via the Standalone DMG (Recommended)

1. Open the generated disk image:
   ```bash
   open dist-electron/Athena-1.0.0-arm64.dmg
   ```
2. In the opened Finder window, drag **Athena.app** into your **Applications** folder (or double-click **Athena.app** directly to test).
3. Open **Athena** from `/Applications` or Spotlight.
   > **Note on macOS Gatekeeper:** If prompted that the developer cannot be verified (standard for ad-hoc local builds without Apple Developer ID):
   > - Right-click **Athena.app** → choose **Open** → click **Open**, or allow via **System Settings → Privacy & Security**.
4. The Express backend spawns automatically in the background, background applications are scanned, and dual camera/screen proctoring is enabled.

---

### Method 2: Launch Direct Packaged Binary from Terminal

To launch the packaged executable and inspect live console / server output:

```bash
./dist-electron/mac-arm64/Athena.app/Contents/MacOS/Athena
```

---

### Method 3: Development Mode (Live Hot Reloading)

To run in development mode across separate terminal instances:

```bash
# Terminal 1 — Start the Express backend
cd backend
node server.js
# → Exam backend running at http://localhost:3000

# Terminal 2 — Start the Vite dev server with hot reload
cd frontend
npm run dev
# → http://localhost:5173

# Terminal 3 — Launch the Electron shell
cd frontend
npm run electron
```

---

## 🛠️ How to Rebuild the DMG

Whenever you modify frontend components, backend logic, or styles, rebuild the DMG from the root directory:

```bash
npm run build
```

This script:
1. Recompiles the React application into `frontend/dist/`.
2. Packages the unpacked Express backend and dependencies.
3. Assembles the standalone installer at `dist-electron/Athena-1.0.0-arm64.dmg`.

---

## 📡 REST API Reference

Base URL (Dev): `http://localhost:3000`  
Production: Handled by Electron local bridge (`http://127.0.0.1:3000`)

| Method | Endpoint | Payload | Description |
|---|---|---|---|
| `GET` | `/` | — | Health check verification |
| `POST` | `/exam/start` | `{ userId, name }` | Creates a new exam session |
| `GET` | `/exam/mcq` | — | Retrieves all questions (omitting correct answers) |
| `GET` | `/exam/mcq/:id` | — | Retrieves a specific question by ID |
| `POST` | `/exam/answer` | `{ sessionId, questionId, selectedAnswer }` | Records a candidate's MCQ answer |
| `POST` | `/exam/flag` | `{ sessionId, type, details }` | **Flags an anti-cheat violation** (e.g. `FULLSCREEN_EXIT`) |
| `GET` | `/exam/session/:id`| — | Fetches live session progress and logged violations |
| `POST` | `/exam/submit` | `{ sessionId }` | Concludes exam and returns final score evaluation |

---

## 📄 Documentation

A full historical log of every engineering phase, bug fix, architectural decision, and design update is maintained in [student.md](file:///Users/rashmianand/Downloads/Athena-Clone2/student.md).
