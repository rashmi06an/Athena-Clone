// App.jsx — Athena Exam Platform with Enhanced Proctoring & Anti-Cheat
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  checkHealth,
  startExam,
  getAllQuestions,
  submitAnswer,
  submitExam,
  flagViolation,
} from './api.js'

// ─── Screen States ─────────────────────────────────────────────────────────────
const SCREEN = {
  SETUP: 'setup',
  REGISTER: 'register',
  EXAM: 'exam',
  RESULT: 'result',
}

// ─── Max Exam Duration (Seconds) ───────────────────────────────────────────────
const MAX_EXAM_DURATION_SECONDS = 900 // 15 minutes max allowed time

function App() {
  // ── System & Proctoring State ──
  const [screen, setScreen] = useState(SCREEN.SETUP)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [screenSharingEnabled, setScreenSharingEnabled] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [timer, setTimer] = useState('')
  const [backendStatus, setBackendStatus] = useState('checking') // 'checking' | 'ok' | 'error'
  const [showInAppRules, setShowInAppRules] = useState(false)

  // ── Background Apps Tracking ──
  const [detectedApps, setDetectedApps] = useState([])
  const [checkingApps, setCheckingApps] = useState(false)
  const [showAppsPrompt, setShowAppsPrompt] = useState(false)

  // ── Anti-Cheat & Lockdown ──
  const [isExamLocked, setIsExamLocked] = useState(false)
  const [violationsCount, setViolationsCount] = useState(0)

  // ── Registration State ──
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)

  // ── Exam State ──
  const [sessionId, setSessionId] = useState(null)
  const [questions, setQuestions] = useState([])
  const [currentQIdx, setCurrentQIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answerFeedback, setAnswerFeedback] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [examSubmitting, setExamSubmitting] = useState(false)

  // ── Result State ──
  const [result, setResult] = useState(null)

  // ── Video & Media Refs ──
  const videoRef = useRef(null)
  const screenVideoRef = useRef(null)

  // ─── Check Backend Health on Mount ─────────────────────────────────────────
  useEffect(() => {
    checkHealth()
      .then(() => setBackendStatus('ok'))
      .catch(() => setBackendStatus('error'))
  }, [])

  // ─── Track Background Applications on Startup ──────────────────────────────
  const scanBackgroundApps = useCallback(async () => {
    if (!window.athena?.getRunningApps) return
    setCheckingApps(true)
    try {
      const apps = await window.athena.getRunningApps()
      setDetectedApps(apps || [])
      if (apps && apps.length > 0) {
        setShowAppsPrompt(true)
      } else {
        setShowAppsPrompt(false)
      }
    } catch (err) {
      console.error('[Security] Error scanning background apps:', err)
    } finally {
      setCheckingApps(false)
    }
  }, [])

  useEffect(() => {
    scanBackgroundApps()
  }, [scanBackgroundApps])

  // ─── Electron IPC Listeners ────────────────────────────────────────────────
  useEffect(() => {
    if (!window.athena) return

    const removeTimerTickListener = window.athena.registerListenerForTimerTickFromMain(setTimer)
    const removeCameraSnapListener = window.athena.registerListenerForCameraSnapFromMain(saveVideoScreenShots)
    const removeScreenShotListener = window.athena.registerListenerForScreenShotFromMain(saveScreenShot)

    return () => {
      removeTimerTickListener?.()
      removeCameraSnapListener?.()
      removeScreenShotListener?.()
    }
  }, [])

  // ─── Keyboard Combinations & Context Menu Blocking ─────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
      const key = e.key ? e.key.toLowerCase() : ''

      // Block Quit, Close, Reload
      if (cmdOrCtrl && (key === 'q' || key === 'w' || key === 'r')) {
        e.preventDefault()
      }

      // Block standard text manipulation & clipboard in exam
      if (cmdOrCtrl && ['c', 'v', 'x', 'a', 'p', 's', 'u'].includes(key)) {
        e.preventDefault()
      }

      // Block DevTools & refresh keys
      if (e.key === 'F5' || e.key === 'F12' || (cmdOrCtrl && e.altKey && key === 'i') || (cmdOrCtrl && e.shiftKey && key === 'i')) {
        e.preventDefault()
      }

      // Prevent Escape during exam
      if (e.key === 'Escape' && screen === SCREEN.EXAM) {
        e.preventDefault()
      }
    }

    function handleContextMenu(e) {
      e.preventDefault()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('contextmenu', handleContextMenu, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [screen])

  // ─── Fullscreen Exit Detection & Violation Flagging ────────────────────────
  useEffect(() => {
    function handleFullscreenChange() {
      const isCurrentlyFullscreen = !!document.fullscreenElement
      setFullScreen(isCurrentlyFullscreen)

      if (screen === SCREEN.EXAM) {
        if (!isCurrentlyFullscreen) {
          // Flag violation to backend immediately and lock the exam
          setIsExamLocked(true)
          setViolationsCount((prev) => prev + 1)
          if (sessionId) {
            flagViolation(
              sessionId,
              'FULLSCREEN_EXIT',
              'Candidate exited fullscreen kiosk mode during active assessment'
            ).catch((err) => console.error('[Anti-Cheat] Failed to flag fullscreen exit:', err))
          }
        } else {
          // Re-entered fullscreen
          setIsExamLocked(false)
          if (sessionId) {
            flagViolation(
              sessionId,
              'FULLSCREEN_RESTORED',
              'Candidate re-entered fullscreen kiosk mode'
            ).catch((err) => console.error('[Anti-Cheat] Failed to flag fullscreen restoration:', err))
          }
        }
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [screen, sessionId])

  // ─── Exam Duration Limit & Auto-Reload ─────────────────────────────────────
  useEffect(() => {
    if (screen === SCREEN.EXAM && timer) {
      const elapsed = parseFloat(timer)
      if (elapsed >= MAX_EXAM_DURATION_SECONDS && !examSubmitting) {
        setExamSubmitting(true)
        if (sessionId) {
          flagViolation(
            sessionId,
            'MAX_DURATION_EXCEEDED',
            `Allocated exam time of ${MAX_EXAM_DURATION_SECONDS}s exceeded`
          ).catch(() => {})
          submitExam(sessionId).catch(() => {})
        }
        alert(
          `Allotted examination duration limit (${Math.round(
            MAX_EXAM_DURATION_SECONDS / 60
          )} minutes) has been reached. Concluding session and reloading application.`
        )
        setTimeout(() => {
          if (window.athena?.reloadApp) {
            window.athena.reloadApp()
          } else {
            window.location.reload()
          }
        }, 1000)
      }
    }
  }, [screen, timer, sessionId, examSubmitting])

  // ─── Camera Snapshot Handler ───────────────────────────────────────────────
  const saveVideoScreenShots = useCallback(async () => {
    if (!videoRef.current || !videoRef.current.srcObject) return
    try {
      const track = videoRef.current.srcObject.getVideoTracks()[0]
      if (!track) return
      const imageCapture = new ImageCapture(track)
      const blob = await imageCapture.takePhoto()
      const arrayBuffer = await blob.arrayBuffer()
      window.athena?.storeCameraSnapImageOnDisk(arrayBuffer)
    } catch (err) {
      console.error('[Proctor] Camera snapshot error:', err)
    }
  }, [])

  // ─── Screen Capture Snapshot Handler ───────────────────────────────────────
  const saveScreenShot = useCallback(async () => {
    if (!window.athena) return
    try {
      const sources = await window.athena.getDesktopSources()
      if (!sources || sources.length === 0) return

      const source = sources[0]
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
            maxWidth: 1920,
            maxHeight: 1080,
          },
        },
      })

      const video = document.createElement('video')
      video.srcObject = stream
      await new Promise((resolve) => { video.onloadedmetadata = resolve })
      video.play()

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)

      stream.getTracks().forEach((t) => t.stop())

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85)
      )
      const arrayBuffer = await blob.arrayBuffer()
      window.athena.storeScreenSnapImageOnDisk(arrayBuffer)
    } catch (err) {
      console.error('[Proctor] Screen capture error:', err)
    }
  }, [])

  // ─── Permissions & Media Streams ───────────────────────────────────────────
  async function getCameraAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraEnabled(true)
    } catch {
      alert('Camera access was denied or not detected. Please verify device permissions.')
    }
  }

  async function getScreenShareAccess() {
    if (!window.athena) {
      setScreenSharingEnabled(true)
      return
    }
    try {
      const sources = await window.athena.getDesktopSources()
      if (!sources || sources.length === 0) {
        alert('No desktop screen sources found.')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id,
            maxWidth: 1280,
            maxHeight: 720,
          },
        },
      })
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream
      }
      setScreenSharingEnabled(true)
    } catch (err) {
      console.error('[Proctor] Screen share access error:', err)
      alert('Screen capture access could not be acquired.')
    }
  }

  async function enableFullScreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      }
      setFullScreen(true)
      setIsExamLocked(false)
    } catch {
      alert('Cannot enter full screen mode. Please allow permissions in your display settings.')
    }
  }

  // ─── Start Timer (Main Process IPC) ────────────────────────────────────────
  async function startTimer() {
    try {
      await window.athena?.startTimerOnMain()
    } catch {
      // Browser preview mode fallback
    }
  }

  // ─── Registration Flow ─────────────────────────────────────────────────────
  async function handleRegister(e) {
    e.preventDefault()
    setRegisterError('')
    if (!studentName.trim() || !studentId.trim()) {
      setRegisterError('Please provide both your Full Name and Candidate ID.')
      return
    }

    if (detectedApps.length > 0) {
      setShowAppsPrompt(true)
      return
    }

    setIsRegistering(true)
    try {
      const data = await startExam(studentId.trim(), studentName.trim())
      setSessionId(data.sessionId)

      const qs = await getAllQuestions()
      setQuestions(qs)
      setCurrentQIdx(0)
      setSelected(null)
      setAnswerFeedback(null)

      startTimer()
      setScreen(SCREEN.EXAM)
    } catch (err) {
      setRegisterError(err.message || 'Unable to connect to exam session. Verify the server is active.')
    } finally {
      setIsRegistering(false)
    }
  }

  // ─── Submit Single MCQ Answer ──────────────────────────────────────────────
  async function handleSubmitAnswer() {
    if (selected === null || submitting || isExamLocked) return
    setSubmitting(true)
    try {
      const q = questions[currentQIdx]
      const fb = await submitAnswer(sessionId, q.id, selected)
      setAnswerFeedback(fb)
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Navigation ────────────────────────────────────────────────────────────
  function handleNext() {
    if (isExamLocked) return
    setSelected(null)
    setAnswerFeedback(null)
    setCurrentQIdx((prev) => prev + 1)
  }

  // ─── Submit Entire Exam ────────────────────────────────────────────────────
  async function handleFinishExam() {
    setExamSubmitting(true)
    try {
      const data = await submitExam(sessionId)
      setResult(data.result)
      setScreen(SCREEN.RESULT)
    } catch (err) {
      alert(err.message)
    } finally {
      setExamSubmitting(false)
    }
  }

  // ─── Reset / Restart ───────────────────────────────────────────────────────
  function handleRestart() {
    setScreen(SCREEN.SETUP)
    setStudentName('')
    setStudentId('')
    setSessionId(null)
    setQuestions([])
    setCurrentQIdx(0)
    setSelected(null)
    setAnswerFeedback(null)
    setResult(null)
    setIsExamLocked(false)
    setViolationsCount(0)
    scanBackgroundApps()
  }

  // ─── Shared Header ─────────────────────────────────────────────────────────
  const renderHeader = () => {
    let phaseName = 'Security Setup'
    if (screen === SCREEN.REGISTER) phaseName = 'Candidate Identification'
    if (screen === SCREEN.EXAM) phaseName = 'Assessment in Progress'
    if (screen === SCREEN.RESULT) phaseName = 'Evaluation Summary'

    return (
      <header className="chic-header">
        <div className="brand-section">
          <div className="brand-logo-mark">A</div>
          <div className="brand-title-group">
            <span className="brand-title">ATHENA</span>
            <span className="brand-subtitle">EXAMINATION SUITE</span>
          </div>
        </div>

        <div className="header-center-info">
          <span className="phase-pill">{phaseName}</span>
          {isExamLocked && (
            <span className="phase-pill" style={{ background: '#F5E7E7', color: '#7E2B2B', borderColor: '#DCB8B8' }}>
              🔒 Lockdown Active
            </span>
          )}
        </div>

        <div className="header-meta">
          <div className={`system-status-badge ${backendStatus}`}>
            <span className="status-dot"></span>
            {backendStatus === 'ok' && 'System Active'}
            {backendStatus === 'checking' && 'Connecting…'}
            {backendStatus === 'error' && 'Server Offline'}
          </div>

          {timer ? (
            <div className="header-timer-badge">
              <span>⏱</span>
              <span>{timer}s</span>
            </div>
          ) : null}
        </div>
      </header>
    )
  }

  // ─── Render Screen: SETUP ──────────────────────────────────────────────────
  if (screen === SCREEN.SETUP) {
    const readyToProceed = cameraEnabled && screenSharingEnabled && fullScreen && backendStatus === 'ok' && detectedApps.length === 0

    return (
      <div className="app-wrapper">
        {renderHeader()}

        <main className="main-content">
          <section className="section-hero">
            <div className="hero-eyebrow">Integrity Protocol</div>
            <h1 className="hero-title">Security & Environment Verification</h1>
            <p className="hero-description">
              Establish dual proctoring feeds, display lockdown, and background application closure before examination.
            </p>
          </section>

          {/* Background Apps Warning Banner if detected */}
          {detectedApps.length > 0 && (
            <div className="security-alert-box">
              <div className="alert-content">
                <strong>⚠️ Prohibited Applications Detected:</strong>
                <span> Please terminate {detectedApps.join(', ')} to proceed with testing.</span>
              </div>
              <button className="btn btn-outline" style={{ padding: '6px 14px', fontSize: 12 }} onClick={scanBackgroundApps} disabled={checkingApps}>
                {checkingApps ? 'Scanning…' : 'Re-scan Applications'}
              </button>
            </div>
          )}

          <div className="setup-grid">
            {/* Camera & Screen Dual Viewfinder */}
            <div className="camera-stage">
              <div>
                <h3 className="checkpoint-title" style={{ fontSize: 16, marginBottom: 4 }}>
                  Dual Proctoring Feed
                </h3>
                <p className="checkpoint-subtitle" style={{ marginBottom: 14 }}>
                  Synchronous optical camera & desktop display capture
                </p>
              </div>

              <div className="dual-preview-row">
                {/* Camera View */}
                <div className="camera-preview-container half-preview">
                  {cameraEnabled ? (
                    <>
                      <video ref={videoRef} autoPlay playsInline muted className="video-stream" />
                      <div className="camera-live-badge">
                        <span className="pulse-red"></span> CAMERA
                      </div>
                    </>
                  ) : (
                    <div className="camera-placeholder">
                      <div className="camera-placeholder-icon">📷</div>
                      <span style={{ fontSize: 11 }}>Camera Standby</span>
                    </div>
                  )}
                </div>

                {/* Screen Share View */}
                <div className="camera-preview-container half-preview">
                  {screenSharingEnabled ? (
                    <>
                      <video ref={screenVideoRef} autoPlay playsInline muted className="video-stream" />
                      <div className="camera-live-badge">
                        <span className="pulse-red"></span> SCREEN SHARE
                      </div>
                    </>
                  ) : (
                    <div className="camera-placeholder">
                      <div className="camera-placeholder-icon">🖥️</div>
                      <span style={{ fontSize: 11 }}>Screen Share Standby</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className={`btn ${cameraEnabled ? 'btn-success-indicator' : 'btn-dark'}`}
                  style={{ flex: 1 }}
                  disabled={cameraEnabled}
                  onClick={getCameraAccess}
                >
                  {cameraEnabled ? '✓ Camera Active' : 'Enable Camera'}
                </button>
                <button
                  className={`btn ${screenSharingEnabled ? 'btn-success-indicator' : 'btn-dark'}`}
                  style={{ flex: 1 }}
                  disabled={screenSharingEnabled}
                  onClick={getScreenShareAccess}
                >
                  {screenSharingEnabled ? '✓ Screen Shared' : 'Authorize Screen'}
                </button>
              </div>
            </div>

            {/* Checkpoints Stage */}
            <div className="checkpoints-stage">
              {/* Checkpoint 1: Camera */}
              <div className={`checkpoint-card ${cameraEnabled ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${cameraEnabled ? 'ready' : ''}`}>
                    {cameraEnabled ? '✓' : '1'}
                  </div>
                  <div>
                    <div className="checkpoint-title">Facial Proctoring</div>
                    <div className="checkpoint-subtitle">
                      {cameraEnabled ? 'Optical feed authorized' : 'Pending camera verification'}
                    </div>
                  </div>
                </div>
                {!cameraEnabled && (
                  <button className="btn btn-light" onClick={getCameraAccess}>
                    Enable
                  </button>
                )}
              </div>

              {/* Checkpoint 2: Screen Share */}
              <div className={`checkpoint-card ${screenSharingEnabled ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${screenSharingEnabled ? 'ready' : ''}`}>
                    {screenSharingEnabled ? '✓' : '2'}
                  </div>
                  <div>
                    <div className="checkpoint-title">Desktop Screen Share</div>
                    <div className="checkpoint-subtitle">
                      {screenSharingEnabled ? 'Desktop display stream active' : 'Pending screen capture authorization'}
                    </div>
                  </div>
                </div>
                {!screenSharingEnabled && (
                  <button className="btn btn-light" onClick={getScreenShareAccess}>
                    Authorize
                  </button>
                )}
              </div>

              {/* Checkpoint 3: Fullscreen Lockdown */}
              <div className={`checkpoint-card ${fullScreen ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${fullScreen ? 'ready' : ''}`}>
                    {fullScreen ? '✓' : '3'}
                  </div>
                  <div>
                    <div className="checkpoint-title">Display Lockdown</div>
                    <div className="checkpoint-subtitle">
                      {fullScreen ? 'Kiosk display activated' : 'Requires full-screen isolation'}
                    </div>
                  </div>
                </div>
                {!fullScreen && (
                  <button className="btn btn-light" onClick={enableFullScreen}>
                    Expand
                  </button>
                )}
              </div>

              {/* Checkpoint 4: Background Apps Isolation */}
              <div className={`checkpoint-card ${detectedApps.length === 0 ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${detectedApps.length === 0 ? 'ready' : ''}`}>
                    {detectedApps.length === 0 ? '✓' : '!'}
                  </div>
                  <div>
                    <div className="checkpoint-title">Process Isolation</div>
                    <div className="checkpoint-subtitle">
                      {detectedApps.length === 0
                        ? 'No prohibited background apps detected'
                        : `${detectedApps.length} external app(s) running`}
                    </div>
                  </div>
                </div>
                {detectedApps.length > 0 && (
                  <button className="btn btn-light" onClick={scanBackgroundApps} disabled={checkingApps}>
                    {checkingApps ? 'Checking…' : 'Re-check'}
                  </button>
                )}
              </div>

              {/* Checkpoint 5: Core Backend Bridge */}
              <div className={`checkpoint-card ${backendStatus === 'ok' ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${backendStatus === 'ok' ? 'ready' : ''}`}>
                    {backendStatus === 'ok' ? '✓' : '5'}
                  </div>
                  <div>
                    <div className="checkpoint-title">Core Backend Bridge</div>
                    <div className="checkpoint-subtitle">
                      {backendStatus === 'ok'
                        ? 'REST API connected (Port 3000)'
                        : 'Express server initializing…'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="button-row">
            <div className="rules-actions-group">
              <button
                className="btn btn-outline"
                onClick={() => window.athena?.showRules()}
                title="Electron Native Message Box"
              >
                Show Native Rules
              </button>
              <button
                className="btn btn-outline"
                onClick={() =>
                  alert(
                    'ATHENA EXAM PROTOCOL\n\n' +
                      '1. Fullscreen mode is mandatory. Exiting flags an automatic violation.\n' +
                      '2. Optical camera and screen share remain continuously audited.\n' +
                      '3. Close all background and external communication applications.\n' +
                      '4. Unauthorized assistance and keyboard shortcuts are disabled.\n' +
                      '5. Exceeding the maximum duration automatically concludes the evaluation.'
                  )
                }
                title="Chromium Alert Dialog"
              >
                Show Chromium Rules
              </button>
              <button className="btn btn-outline" onClick={() => setShowInAppRules(true)}>
                View Protocol Overview
              </button>
            </div>

            <button
              className="btn btn-dark"
              disabled={!readyToProceed}
              onClick={() => setScreen(SCREEN.REGISTER)}
            >
              Continue to Registration →
            </button>
          </div>
        </main>

        {/* Background Apps Modal Prompt */}
        {showAppsPrompt && detectedApps.length > 0 && (
          <div className="modal-backdrop">
            <div className="modal-sheet">
              <div className="modal-head">
                <h3 className="modal-title">Close Background Applications</h3>
              </div>
              <div className="modal-body">
                <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                  To maintain testing fairness and security, please close the following detected applications:
                </p>
                <div className="prohibited-apps-list">
                  {detectedApps.map((appName, idx) => (
                    <div key={idx} className="prohibited-app-pill">
                      <span>⚠️</span>
                      <strong>{appName}</strong>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 14 }}>
                  Once you close them, click <em>Re-check Applications</em> below to proceed.
                </p>
              </div>
              <div className="modal-foot">
                <button className="btn btn-dark" onClick={scanBackgroundApps} disabled={checkingApps}>
                  {checkingApps ? 'Verifying Process Tree…' : 'Re-check Applications'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-app chic rules modal */}
        {showInAppRules && (
          <div className="modal-backdrop" onClick={() => setShowInAppRules(false)}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3 className="modal-title">Athena Assessment Protocol</h3>
                <button
                  className="btn btn-outline"
                  style={{ padding: '4px 10px' }}
                  onClick={() => setShowInAppRules(false)}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                <ul className="rules-numbered-list">
                  <li>
                    <span className="rule-number">1</span>
                    <span><strong>Fullscreen Lockdown:</strong> Exiting fullscreen disables question answering and flags an alert to the backend.</span>
                  </li>
                  <li>
                    <span className="rule-number">2</span>
                    <span><strong>Dual Proctoring:</strong> Facial camera and desktop screen shares are periodically audited and archived.</span>
                  </li>
                  <li>
                    <span className="rule-number">3</span>
                    <span><strong>Application Isolation:</strong> External background browsers and communication apps must remain closed.</span>
                  </li>
                  <li>
                    <span className="rule-number">4</span>
                    <span><strong>Keyboard Protection:</strong> Application switching, copy-pasting, developer tools, and screenshot shortcuts are disabled.</span>
                  </li>
                  <li>
                    <span className="rule-number">5</span>
                    <span><strong>Time Enforcement:</strong> Exceeding the maximum allowed test duration automatically reloads and submits the assessment.</span>
                  </li>
                </ul>
              </div>
              <div className="modal-foot">
                <button className="btn btn-dark" onClick={() => setShowInAppRules(false)}>
                  Understood & Acknowledged
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Render Screen: REGISTER ───────────────────────────────────────────────
  if (screen === SCREEN.REGISTER) {
    return (
      <div className="app-wrapper">
        {renderHeader()}

        <main className="main-content">
          <section className="section-hero">
            <div className="hero-eyebrow">Session Association</div>
            <h1 className="hero-title">Candidate Credentials</h1>
            <p className="hero-description">
              Associate your unique academic identity with this evaluation session.
            </p>
          </section>

          <div className="register-card-wrapper">
            <div className="chic-card">
              <form onSubmit={handleRegister}>
                <div className="form-group">
                  <label className="form-label">Full Candidate Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="e.g. Rashmi Anand"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Student / Identification ID</label>
                  <input
                    type="text"
                    className="form-input"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="e.g. STU-2026-09"
                    required
                  />
                </div>

                {registerError && <div className="form-alert">{registerError}</div>}

                <div className="button-row" style={{ marginTop: 28 }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setScreen(SCREEN.SETUP)}
                  >
                    ← Back to Verification
                  </button>
                  <button type="submit" className="btn btn-dark" disabled={isRegistering}>
                    {isRegistering ? 'Initializing Session…' : 'Begin Assessment →'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ─── Render Screen: EXAM ───────────────────────────────────────────────────
  if (screen === SCREEN.EXAM) {
    const q = questions[currentQIdx]
    const isLast = currentQIdx === questions.length - 1

    return (
      <div className="app-wrapper">
        {renderHeader()}

        {/* Fullscreen Lockdown Alert Modal */}
        {isExamLocked && (
          <div className="lockdown-overlay">
            <div className="lockdown-card">
              <div className="lockdown-icon">🔒</div>
              <h2 className="lockdown-title">Security Violation: Fullscreen Exited</h2>
              <p className="lockdown-desc">
                Exam interaction has been suspended. Navigating away from fullscreen mode is a monitored violation
                and has been recorded in your proctoring log (Violations: {violationsCount}).
              </p>
              <button className="btn btn-dark" style={{ width: '100%' }} onClick={enableFullScreen}>
                Restore Full Screen & Resume Exam
              </button>
            </div>
          </div>
        )}

        <main className="main-content">
          {/* Question Stepper & Progress */}
          <div className="exam-nav-bar">
            <div className="question-stepper">
              {questions.map((_, idx) => {
                let cls = 'stepper-pill'
                if (idx === currentQIdx) cls += ' current'
                else if (idx < currentQIdx) cls += ' answered'
                return (
                  <div key={idx} className={cls}>
                    {idx + 1}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {violationsCount > 0 && (
                <div className="violation-pill">
                  ⚠️ {violationsCount} Violation{violationsCount > 1 ? 's' : ''} Flagged
                </div>
              )}
              <div className="exam-timer-block">
                <span>DUAL PROCTOR ACTIVE</span>
                <span>·</span>
                <span>{timer || '0.0'}s</span>
              </div>
            </div>
          </div>

          {/* Question Card */}
          <div className="chic-card" style={{ marginBottom: 24 }}>
            <div className="question-header">
              <span className="question-eyebrow">
                Item {currentQIdx + 1} of {questions.length}
              </span>
              <span className="phase-pill" style={{ fontSize: 10 }}>Multiple Choice</span>
            </div>

            <h2 className="question-statement">{q?.question}</h2>

            <div className="options-grid">
              {q?.options.map((opt, idx) => {
                let cls = 'option-row-btn'
                if (answerFeedback) {
                  if (idx === selected) {
                    cls += answerFeedback.isCorrect ? ' correct-choice' : ' wrong-choice'
                  }
                } else if (idx === selected) {
                  cls += ' selected'
                }

                return (
                  <button
                    key={idx}
                    className={cls}
                    disabled={!!answerFeedback || isExamLocked}
                    onClick={() => setSelected(idx)}
                  >
                    <div className="option-letter">{String.fromCharCode(65 + idx)}</div>
                    <span className="option-text">{opt}</span>
                  </button>
                )
              })}
            </div>

            {/* Answer Feedback Banner */}
            {answerFeedback && (
              <div className={`feedback-chic-banner ${answerFeedback.isCorrect ? 'correct' : 'wrong'}`}>
                <div>
                  {answerFeedback.isCorrect
                    ? '✓ Response confirmed. Accurate.'
                    : '✕ Response registered. Incorrect.'}
                </div>
                <div className="feedback-score-pill">
                  {answerFeedback.correct} of {answerFeedback.attempted} verified correct
                </div>
              </div>
            )}

            <div className="button-row">
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Session: <span style={{ fontFamily: 'var(--font-mono)' }}>{sessionId}</span>
              </div>

              {!answerFeedback ? (
                <button
                  className="btn btn-dark"
                  disabled={selected === null || submitting || isExamLocked}
                  onClick={handleSubmitAnswer}
                >
                  {submitting ? 'Confirming…' : 'Submit Answer'}
                </button>
              ) : isLast ? (
                <button
                  className="btn btn-dark"
                  disabled={examSubmitting || isExamLocked}
                  onClick={handleFinishExam}
                >
                  {examSubmitting ? 'Finalizing Evaluation…' : 'Complete Assessment'}
                </button>
              ) : (
                <button className="btn btn-dark" disabled={isExamLocked} onClick={handleNext}>
                  Next Item →
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ─── Render Screen: RESULT ─────────────────────────────────────────────────
  if (screen === SCREEN.RESULT) {
    const attempted = result?.attempted || 0
    const correct = result?.correct || 0
    const wrong = result?.wrong || 0
    const pct = attempted > 0 ? Math.round((correct / attempted) * 100) : 0

    return (
      <div className="app-wrapper">
        {renderHeader()}

        <main className="main-content">
          <div className="result-card-container">
            <div className="chic-card">
              <div className="result-eyebrow">Academic Assessment Record</div>
              <h1 className="result-heading">Evaluation Concluded</h1>

              {/* Score Dial */}
              <div className="score-display-card">
                <span className="score-numeral">{pct}%</span>
                <span className="score-label">Proficiency</span>
              </div>

              {/* Stat Tiles */}
              <div className="stats-grid">
                <div className="stat-tile">
                  <div className="stat-value" style={{ color: '#2C5A2C' }}>
                    {correct}
                  </div>
                  <div className="stat-title">Correct</div>
                </div>

                <div className="stat-tile">
                  <div className="stat-value" style={{ color: '#7E2F2F' }}>
                    {wrong}
                  </div>
                  <div className="stat-title">Incorrect</div>
                </div>

                <div className="stat-tile">
                  <div className="stat-value">
                    {attempted}
                  </div>
                  <div className="stat-title">Attempted</div>
                </div>
              </div>

              {/* Violations Flag Summary if any */}
              {violationsCount > 0 && (
                <div style={{ marginBottom: 20, padding: 12, background: '#F5E7E7', borderRadius: 'var(--radius-md)', color: '#7E2B2B', fontSize: 13, fontWeight: 600 }}>
                  ⚠️ {violationsCount} proctoring violation(s) were flagged and registered to your exam log.
                </div>
              )}

              {/* Session Meta */}
              <div className="session-metadata-strip">
                <span>Verified Candidate: <strong>{studentName || 'Student'}</strong></span>
                <span>·</span>
                <span>Reference: <code className="session-id-token">{sessionId}</code></span>
              </div>

              <div className="button-row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-dark" onClick={handleRestart}>
                  Initiate New Evaluation
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return null
}

export default App