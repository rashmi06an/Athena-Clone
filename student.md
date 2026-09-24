# student.md — Athena Exam App: Setup & Integration Log

> **Purpose:** This file documents every step taken to fix node_modules issues
> and connect the frontend (Electron + React/Vite) to the backend (Express).

---

## Project Structure

```
Athena-Clone2/
├── backend/               ← Express REST API server
│   ├── data/
│   │   ├── questions.json  ← MCQ questions (with correct answers)
│   │   └── sessions.json   ← Live exam sessions store
│   ├── server.js          ← Express app (port 3000)
│   └── package.json
│
├── frontend/              ← React + Vite app, wrapped in Electron
│   ├── app/
│   │   ├── app.js         ← Electron main process
│   │   └── preload.js     ← Electron preload (IPC bridge)
│   ├── src/
│   │   ├── api.js         ← [NEW] API service layer (fetch → backend)
│   │   ├── App.jsx        ← React root component
│   │   ├── App.css        ← Styles
│   │   └── main.jsx       ← React entry point
│   ├── vite.config.js     ← Vite build + dev-server config
│   └── package.json
│
└── student.md             ← This file
```

---

## Step 1 — Diagnosed node_modules Issues

**Problem found:** The backend had **unmet peer dependencies** — `node_modules`
was missing entirely because `npm install` had never been run in `/backend`.

```
npm error missing: cors@^2.8.5, required by exam-backend@1.0.0
npm error missing: express@^5.1.0, required by exam-backend@1.0.0
```

**Fix applied:**

```bash
cd backend
npm install        # installed express + cors + all transitive deps (70 packages)
```

**Frontend node_modules:** Were intact. `npm audit` reported **0 vulnerabilities**.

---

## Step 2 — Vite Proxy Configuration

**File modified:** `frontend/vite.config.js`

**Problem:** The React renderer (running at `http://localhost:5173`) would hit
CORS errors if it called `http://localhost:3000` directly in development.

**Fix:** Added a Vite dev-server proxy so all requests to `/api/*` are
transparently forwarded to the Express server at `http://localhost:3000`,
with the `/api` prefix stripped before reaching Express.

```js
// vite.config.js
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
},
```

**Result:** `GET /api/exam/mcq` in the browser → `GET /exam/mcq` on the backend.
No CORS headers needed because the browser sees a same-origin request.

---

## Step 3 — Created `frontend/src/api.js` (API Service Layer)

**File created:** `frontend/src/api.js`

A clean service module that wraps every backend endpoint in typed async functions.
The React components never call `fetch()` directly — they import from `api.js`.

### Exported functions

| Function | HTTP Call | Description |
|---|---|---|
| `checkHealth()` | `GET /api/` | Verify backend is running |
| `startExam(userId, name)` | `POST /api/exam/start` | Create a new exam session |
| `getSession(sessionId)` | `GET /api/exam/session/:id` | Get session progress |
| `getAllQuestions()` | `GET /api/exam/mcq` | Fetch all questions (no answers) |
| `getQuestion(id)` | `GET /api/exam/mcq/:id` | Fetch one question |
| `submitAnswer(sessionId, qId, answer)` | `POST /api/exam/answer` | Submit one MCQ answer |
| `submitExam(sessionId)` | `POST /api/exam/submit` | Finish and score the exam |

---

## Step 4 — Rewrote `frontend/src/App.jsx` (Full Exam Flow)

**File modified:** `frontend/src/App.jsx`

The original `App.jsx` only handled camera + fullscreen permissions with no
backend connection. It was rewritten to implement a complete exam flow:

### Screen States

```
SETUP → REGISTER → EXAM → RESULT
```

| Screen | What happens |
|---|---|
| **SETUP** | Camera permission, fullscreen permission, backend health check badge |
| **REGISTER** | Student enters name + ID → `POST /api/exam/start` creates session |
| **EXAM** | Questions fetched from backend, answers submitted one-by-one with live feedback |
| **RESULT** | Final score shown (%, correct, wrong, attempted) |

### Key connections to backend

- On mount → `checkHealth()` → shows green/red badge
- On register submit → `startExam()` + `getAllQuestions()`
- On each answer → `submitAnswer()` → shows ✅/❌ feedback immediately
- On "Finish Exam" → `submitExam()` → shows score screen

---

## Step 5 — Updated `frontend/app/app.js` (Electron Main Process)

**File modified:** `frontend/app/app.js`

### What changed

The backend (`/backend`) is a **completely separate process** — it is never
started from inside Electron. The two folders are independent:

- **`/backend`** → started by the user with `node server.js`
- **`/frontend`** → started with `npm run dev` (Vite) + `npm run electron`

### Improvements made to app.js

- Camera snapshot directory is auto-created with `fs.mkdirSync` if it doesn't exist yet
- Timer tick sends 1-decimal-place seconds (e.g. `2.0`)
- `import.meta.dirname` used correctly for ESM compatibility

---

## Step 6 — Updated `frontend/src/App.css`

Added styles for all new UI elements:

- `.status-badge` — green/yellow/red backend status pill
- `.register-form` — label + input form layout
- `.exam-header` — question counter + timer row
- `.question-text` — larger question text
- `.option-btn` / `.option-btn.selected` / `.option-btn.correct` / `.option-btn.wrong`
- `.feedback-banner` — inline correct/wrong result after each answer
- `.score-circle` — gradient circle showing percentage on result screen
- `.score-breakdown` — correct / wrong / attempted count row

---

## How to Run

The **backend** and **frontend** are two completely separate processes.
Always start them in separate terminals.

```bash
# Terminal 1 — Start the Express backend (stays in /backend)
cd backend
node server.js
# → Exam backend running at http://localhost:3000

# Terminal 2 — Start the React/Vite dev server
cd frontend
npm run dev
# → http://localhost:5173

# Terminal 3 — Launch Electron (loads http://localhost:5173)
cd frontend
npm run electron
```

> The Vite proxy forwards all `/api/*` requests from the React app to
> `http://localhost:3000`, so the backend must be running first.

---

## Backend API Reference

Base URL (dev): `http://localhost:3000`  
Frontend accesses via proxy: `/api/...` → `http://localhost:3000/...`

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/` | — | Health check |
| POST | `/exam/start` | `{ userId, name }` | Start session → returns `sessionId` |
| GET | `/exam/mcq` | — | All questions (no correct answers) |
| GET | `/exam/mcq/:id` | — | Single question by ID |
| POST | `/exam/answer` | `{ sessionId, questionId, selectedAnswer }` | Record answer |
| GET | `/exam/session/:sessionId` | — | Get session state |
| POST | `/exam/submit` | `{ sessionId }` | Submit exam → returns score |

---

## Files Changed Summary

| File | Action | Reason |
|---|---|---|
| `backend/` (node_modules) | `npm install` | Missing — no packages installed |
| `frontend/vite.config.js` | Modified | Added `/api` proxy to backend |
| `frontend/src/api.js` | **Created** | API service layer for all backend calls |
| `frontend/src/App.jsx` | Rewritten | Full exam flow connected to backend |
| `frontend/src/App.css` | Extended | Styles for new UI screens |
| `frontend/app/app.js` | Modified | Auto-spawn backend, clean shutdown |
| `backend/data/sessions.json` | Reset to `[]` | Cleared test data after verification |

---

*Last updated: 2026-09-22 by Antigravity AI agent*

---

## Addendum — Restored Rules Buttons (2026-09-22)

During the `App.jsx` rewrite, two buttons from the original code were accidentally
removed from the **Setup screen**. They were restored:

| Button | Behaviour |
|---|---|
| **Show Native Rules** | Calls `window.athena.showRules()` → IPC → `ipcMain.on("show-rules")` → `dialog.showMessageBox()` (Electron native dialog) |
| **Show Chromium Rules** | Calls browser-native `alert()` — works in both Electron and plain browser |

Both buttons appear in `bottom-actions` on the SETUP screen next to "Continue to Register".

---

## Step 7 — Packaging as Standalone Executable macOS DMG (2026-09-24)

### Goal
Turn the entire Athena Exam application (Frontend React/Vite renderer + Electron shell + Express backend + SQLite/JSON data stores) into a single, standalone executable macOS `.dmg` installer file so that any student or examiner can run it without opening terminal windows or manually starting Node.js servers.

---

### Key Challenges & Solutions for Production Desktop Packaging

#### 1. Vite Asset Path Resolution (`frontend/vite.config.js`)
- **Issue:** Vite's default `base` is `'/'`. In a built Electron app loaded from local disk (`file://.../dist/index.html`), `<script src="/assets/index.js">` resolves to `file:///assets/index.js` (root of the user's hard drive), resulting in a blank white screen.
- **Fix:** Added `base: './'` in [vite.config.js](file:///Users/rashmianand/Downloads/Athena-Clone2/frontend/vite.config.js#L6) so all generated asset paths are relative (`./assets/...`).

#### 2. Backend API Endpoint Resolution (`frontend/src/api.js`)
- **Issue:** In development, Vite dev-server proxies `/api/*` to `http://localhost:3000`. In a packaged production app running over `file://`, relative requests like `fetch('/api/exam/mcq')` resolve to `file:///api/exam/mcq` and immediately throw a network `TypeError`.
- **Fix:** Updated [api.js](file:///Users/rashmianand/Downloads/Athena-Clone2/frontend/src/api.js#L12-L16) to automatically detect the protocol:
  ```javascript
  const BASE_URL =
    (typeof window !== 'undefined' && window.__BACKEND_URL__) ||
    (typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? 'http://127.0.0.1:3000'
      : '/api');
  ```

#### 3. Read-Only ASAR & User Data Persistence (`backend/server.js` & `frontend/app/app.js`)
- **Issue:** Packaged Electron applications run inside read-only `.asar` archives or read-only `/Applications` directories. When the backend attempts to write exam progress to `sessions.json` or Electron saves camera/screen snapshots, writes fail with `EROFS` or `EACCES`.
- **Fix:** 
  - Updated [server.js](file:///Users/rashmianand/Downloads/Athena-Clone2/backend/server.js#L12-L48) to support `ATHENA_DATA_DIR` and `ATHENA_SESSIONS_PATH` environment variables with automatic directory creation and safe fallbacks.
  - In [app.js](file:///Users/rashmianand/Downloads/Athena-Clone2/frontend/app/app.js), dynamic data is routed to macOS's standard writable user directory (`app.getPath("userData")`, i.e., `~/Library/Application Support/athena-clone/`).
  - Snapshots are saved to `~/Library/Application Support/athena-clone/snapshots/` in production.

#### 4. Automatic Express Backend Process Management (`frontend/app/app.js`)
- **Issue:** In the packaged app, the user cannot be required to run `node backend/server.js`. The Electron main process must manage the backend lifecycle.
- **Fix:** Implemented an automated background process manager in [app.js](file:///Users/rashmianand/Downloads/Athena-Clone2/frontend/app/app.js):
  - On launch: Checks if `http://127.0.0.1:3000/` is already active.
  - If not running: Electron automatically spawns the unpacked Express backend script (`process.resourcesPath/app.asar.unpacked/backend/server.js`) using Node child process fork with `ELECTRON_RUN_AS_NODE: '1'`.
  - Health check polling: Waits until the Express server reports ready before opening the UI.
  - On quit: Gracefully terminates the backend child process with `SIGTERM`.

#### 5. Custom macOS App Icon
- Generated a high-resolution, Apple-style squircle icon with a glowing geometric logo and compiled it to a 512x512 PNG at [build/icon.png](file:///Users/rashmianand/Downloads/Athena-Clone2/build/icon.png).
- `electron-builder` automatically converted this into [icon.icns](file:///Users/rashmianand/Downloads/Athena-Clone2/dist-electron/mac-arm64/Athena.app/Contents/Resources/icon.icns) and `.VolumeIcon.icns` for the mounted disk image.

#### 6. Electron-Builder Root Configuration (`package.json`)
- Configured root [package.json](file:///Users/rashmianand/Downloads/Athena-Clone2/package.json) with:
  - `"main": "frontend/app/app.js"`
  - `"type": "module"`
  - `build.mac.target`: `dmg` for `arm64` (Apple Silicon)
  - `build.asarUnpack`: `backend/**/*` so backend scripts and node_modules exist on the physical filesystem for the child process.
  - `build.dmg.contents`: Standard macOS drag-and-drop installer layout to `/Applications`.
  - `build.mac.identity`: `null` (allows clean local builds without needing an Apple Developer signing certificate).

---

## Output Artifacts

The final DMG installer and packaged app are generated in the `dist-electron/` folder:

| File | Size | Description |
|---|---|---|
| `dist-electron/Athena-1.0.0-arm64.dmg` | **~129 MB** | **Standalone macOS executable DMG installer** |
| `dist-electron/Athena-1.0.0-arm64.dmg.blockmap` | 139 KB | Block map for delta updates |
| `dist-electron/mac-arm64/Athena.app` | ~380 MB | Unpacked ready-to-run macOS application bundle |

---

## Detailed Steps to Run Everything

### Option A — Run the Packaged DMG (Recommended for Testing & Distribution)

1. **Locate the DMG:**
   Open the generated DMG in Finder or terminal:
   ```bash
   open dist-electron/Athena-1.0.0-arm64.dmg
   ```
2. **Install or Run:**
   - A Finder window opens with **Athena** and a shortcut to **Applications**.
   - Drag **Athena.app** into the **Applications** folder (or simply double-click **Athena.app** directly inside the disk image to test it).
3. **Open the App:**
   - Launch **Athena** from `/Applications` or Spotlight.
   - *Note on Gatekeeper:* If macOS displays a message saying the developer cannot be verified (standard for apps built locally without an expensive Apple Developer ID certificate):
     - Go to **System Settings → Privacy & Security → Open Anyway**, or right-click `Athena.app` and choose **Open**.
4. **Everything Runs Automatically:**
   - Electron initializes.
   - The Express backend starts in the background on port 3000.
   - The green `Backend: Online` badge appears on the Setup screen.
   - Camera and screen proctoring permissions are granted.
   - Proceed through **Setup → Register → Exam → Submit**.
   - On exiting the app, the background server terminates automatically.

---

### Option B — Run the Packaged Binary Directly from Terminal

You can launch the packaged app executable directly to see real-time console and backend logs:

```bash
./dist-electron/mac-arm64/Athena.app/Contents/MacOS/Athena
```

You will see:
```text
[Backend] Launching Express backend from: .../backend/server.js
[Backend] Using data directory: .../Library/Application Support/athena-clone/data
[Backend STDOUT] Exam backend running at http://localhost:3000
[Backend] Backend successfully initialized and responding.
[Electron] Loading built bundle: .../dist/index.html
```

---

### Option C — Run in Development Mode (For Modifying Code)

If you wish to continue developing with live hot-reloading:

```bash
# Terminal 1 — Start the Express backend
cd backend
node server.js
# → Exam backend running at http://localhost:3000

# Terminal 2 — Start the Vite dev server with hot reload
cd frontend
npm run dev
# → http://localhost:5173

# Terminal 3 — Launch Electron pointed at dev server
cd frontend
npm run electron
```

---

### How to Rebuild the DMG in the Future

Whenever you make changes to either the frontend or backend, simply run:

```bash
npm run build
```
from the root directory (`/Users/rashmianand/Downloads/Athena-Clone2`). This will:
1. Recompile the React/Vite frontend into `frontend/dist/`.
2. Package the app bundle with `electron-builder`.
3. Produce a new `dist-electron/Athena-1.0.0-arm64.dmg`.

---

## Updated Files Summary

| File | Change | Purpose |
|---|---|---|
| `package.json` (root) | Configured | Added electron-builder DMG configuration, scripts, unpacked backend rules, and metadata |
| `frontend/vite.config.js` | Modified | Added `base: './'` for relative asset loading from `file://` |
| `frontend/src/api.js` | Modified | Added dynamic `BASE_URL` switching between `/api` (Vite dev) and `http://127.0.0.1:3000` (`file://` production) |
| `backend/server.js` | Modified | Added support for `ATHENA_DATA_DIR` and `ATHENA_SESSIONS_PATH` to store exam data in user-writable paths |
| `frontend/app/app.js` | Modified | Auto-spawns Express backend child process in production, handles clean shutdown, safe snapshot paths, and dynamic loadFile |
| `build/icon.png` | **Created** | High-res 512x512 custom application icon |
| `dist-electron/` | **Generated** | Contains the built `Athena-1.0.0-arm64.dmg` installer and `Athena.app` bundle |
| `student.md` | Updated | Step-by-step documentation of all packaging decisions, fixes, and execution guides |

---

## Step 8 — Editorial Redesign: Minimal & Chic Luxury UI (Black, Grey, White & Beige) (2026-09-24)

### Aesthetic Concept & Palette
The interface was completely overhauled to transform the app from a basic utility into an editorial-grade, minimalist luxury software experience inspired by high-end design aesthetics:

- **Warm Beige / Limestone Canvas (`#F6F4EE`):** Warm parchment background with subtle radial depth gradients.
- **Architectural White (`#FFFFFF`):** High-clarity elevated surface cards with soft warm-tone shadows.
- **Rich Obsidian Matte Black (`#121211`):** High-contrast primary action buttons, active MCQ selections, circular score badges, and logo marks.
- **Charcoal & Warm Grey (`#5C5B55` / `#8C8A82`):** Refined secondary typography, subtle micro-labels, and metadata badges.
- **Sand & Limestone Borders (`#EAE6DC` / `#D5CFC1`):** Delicate architectural borders and dividers.

### Typography System
- **Headers & Display:** `Cormorant Garamond` — Classical, editorial luxury serif for question titles, evaluation numerals, and brand logomark.
- **Body & Controls:** `Plus Jakarta Sans` — Modern, ultra-clean geometric sans for legibility and effortless interaction.
- **Timers & Reference Tokens:** `SF Mono` / monospace — Clean numerical tracking for seconds elapsed and session identifiers.

---

### Component & Screen Enhancements

#### 1. Persistent Chic Header Bar
- **Brand Identity:** Minimalist obsidian square mark `[A]` paired with spaced serif logotype `ATHENA · EXAMINATION SUITE`.
- **Phase Tracker:** Centered beige pill dynamically indicating `Security Setup`, `Candidate Identification`, `Assessment in Progress`, or `Evaluation Summary`.
- **System Telemetry:** Live backend status pill with pulsing indicator (`System Active` / `Connecting` / `Server Offline`).
- **Proctoring Timer:** Monospace digital clock pill displaying live elapsed exam seconds.

#### 2. Security Setup Screen (`SCREEN.SETUP`)
- **Optical Stream Viewfinder:** Sleek live camera preview card with subtle vignette, glowing `● LIVE FEED` badge, and calibration status toggle.
- **Two-Column Integrity Checkpoints:** Interactive verification cards for:
  1. *Facial Proctoring* (Camera authorization)
  2. *Environment Lockdown* (Full-screen kiosk activation)
  3. *Core Backend Bridge* (Express REST API synchronization)
- **Protocol Action Bar:**
  - *Continue to Registration →* button in rich matte obsidian.
  - *Show Native Rules* (Electron IPC modal).
  - *Show Chromium Rules* (Native browser dialog).
  - *View Protocol Overview* (In-app chic blurred-glass modal).

#### 3. Candidate Registration (`SCREEN.REGISTER`)
- Centered card with generous whitespace and clear hierarchy.
- Refined input fields with warm limestone backgrounds, transitioning on focus to crisp white with subtle charcoal focus rings.
- Candidate Name and Roll/Student ID validation.

#### 4. Assessment Interface (`SCREEN.EXAM`)
- **Question Stepper Bar:** Top pill navigation displaying item numbers (answered vs current item).
- **Question Statement:** Rendered in large, high-legibility Cormorant Garamond serif typography.
- **MCQ Option Rows:**
  - Clean cards with minimalist letter badge (`A`, `B`, `C`, `D`).
  - Active selection in rich obsidian black with crisp white text.
  - Answer evaluation banners featuring refined sage-green (correct) and terracotta (incorrect) cues.

#### 5. Evaluation Summary (`SCREEN.RESULT`)
- **Circular Proficiency Dial:** High-contrast obsidian & sand circular percentage gauge.
- **Three-Pillar Metrics Grid:** Individual limestone cards for *Correct*, *Incorrect*, and *Total Attempted*.
- **Candidate Metadata Strip:** Displays student name and unique session ID.
- **Re-test Capability:** One-click button to restart or initiate a fresh assessment without restarting the app.

---

### Verification & DMG Rebuild
1. **Frontend Compilation:** Built with Vite in ~98ms with zero bundle warnings.
2. **DMG Packaging:** Rebuilt with `electron-builder` to generate an updated, ready-to-distribute `dist-electron/Athena-1.0.0-arm64.dmg`.



