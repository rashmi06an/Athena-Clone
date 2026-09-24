// App.jsx — Athena Exam Platform (Chic Minimal Black, Grey, White & Beige)
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  checkHealth,
  startExam,
  getAllQuestions,
  submitAnswer,
  submitExam,
} from './api.js'

// ─── Screen States ─────────────────────────────────────────────────────────────
const SCREEN = {
  SETUP: 'setup',
  REGISTER: 'register',
  EXAM: 'exam',
  RESULT: 'result',
}

function App() {
  // ── System & Proctoring State ──
  const [screen, setScreen] = useState(SCREEN.SETUP)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [timer, setTimer] = useState('')
  const [backendStatus, setBackendStatus] = useState('checking') // 'checking' | 'ok' | 'error'
  const [showInAppRules, setShowInAppRules] = useState(false)

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

  // ── Video Ref ──
  const videoRef = useRef(null)

  // ─── Backend Health Check ──────────────────────────────────────────────────
  useEffect(() => {
    checkHealth()
      .then(() => setBackendStatus('ok'))
      .catch(() => setBackendStatus('error'))
  }, [])

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

  // ─── Camera Snapshot ───────────────────────────────────────────────────────
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
      console.error('[Proctor] Camera snap error:', err)
    }
  }, [])

  // ─── Screen Capture ────────────────────────────────────────────────────────
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
      console.error('[Proctor] Screen snap error:', err)
    }
  }, [])

  // ─── Permissions ───────────────────────────────────────────────────────────
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

  async function enableFullScreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      }
      setFullScreen(true)
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
    if (selected === null || submitting) return
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
    const readyToProceed = cameraEnabled && fullScreen && backendStatus === 'ok'

    return (
      <div className="app-wrapper">
        {renderHeader()}

        <main className="main-content">
          <section className="section-hero">
            <div className="hero-eyebrow">Integrity Protocol</div>
            <h1 className="hero-title">Security & Environment Verification</h1>
            <p className="hero-description">
              Establish optical proctoring and display lockdown to guarantee an authenticated testing environment.
            </p>
          </section>

          <div className="setup-grid">
            {/* Camera Viewfinder */}
            <div className="camera-stage">
              <div>
                <h3 className="checkpoint-title" style={{ fontSize: 16, marginBottom: 4 }}>
                  Optical Stream
                </h3>
                <p className="checkpoint-subtitle" style={{ marginBottom: 14 }}>
                  Continuous facial presence verification
                </p>
              </div>

              <div className="camera-preview-container">
                {cameraEnabled ? (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted className="video-stream" />
                    <div className="camera-live-badge">
                      <span className="pulse-red"></span> LIVE FEED
                    </div>
                  </>
                ) : (
                  <div className="camera-placeholder">
                    <div className="camera-placeholder-icon">📷</div>
                    <span>Camera sensor standby</span>
                  </div>
                )}
              </div>

              <button
                className={`btn ${cameraEnabled ? 'btn-success-indicator' : 'btn-dark'}`}
                disabled={cameraEnabled}
                onClick={getCameraAccess}
              >
                {cameraEnabled ? '✓ Camera Synchronized' : 'Calibrate Optical Feed'}
              </button>
            </div>

            {/* Checkpoints & Security Requirements */}
            <div className="checkpoints-stage">
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

              <div className={`checkpoint-card ${fullScreen ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${fullScreen ? 'ready' : ''}`}>
                    {fullScreen ? '✓' : '2'}
                  </div>
                  <div>
                    <div className="checkpoint-title">Environment Lockdown</div>
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

              <div className={`checkpoint-card ${backendStatus === 'ok' ? 'active' : ''}`}>
                <div className="checkpoint-info">
                  <div className={`checkpoint-icon-box ${backendStatus === 'ok' ? 'ready' : ''}`}>
                    {backendStatus === 'ok' ? '✓' : '3'}
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
                      '1. Remain focused within the exam interface.\n' +
                      '2. Camera stream must remain uninterrupted.\n' +
                      '3. Navigating away triggers proctoring logs.\n' +
                      '4. Unauthorized assistance is strictly prohibited.\n' +
                      '5. Submit answers sequentially and conclude upon completion.'
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
                    <span>Maintain direct eye contact with the display. Background anomalies will be registered.</span>
                  </li>
                  <li>
                    <span className="rule-number">2</span>
                    <span>Video and screen captures are securely audited at scheduled intervals.</span>
                  </li>
                  <li>
                    <span className="rule-number">3</span>
                    <span>Keyboard shortcuts and workspace switching are locked during live testing.</span>
                  </li>
                  <li>
                    <span className="rule-number">4</span>
                    <span>Each question permits one final confirmed submission.</span>
                  </li>
                  <li>
                    <span className="rule-number">5</span>
                    <span>Conclude the evaluation by clicking 'Finish Exam' when all questions are answered.</span>
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

            <div className="exam-timer-block">
              <span>PROCTOR ACTIVE</span>
              <span>·</span>
              <span>{timer || '0.0'}s</span>
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
                    disabled={!!answerFeedback}
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
                  disabled={selected === null || submitting}
                  onClick={handleSubmitAnswer}
                >
                  {submitting ? 'Confirming…' : 'Submit Answer'}
                </button>
              ) : isLast ? (
                <button
                  className="btn btn-dark"
                  disabled={examSubmitting}
                  onClick={handleFinishExam}
                >
                  {examSubmitting ? 'Finalizing Evaluation…' : 'Complete Assessment'}
                </button>
              ) : (
                <button className="btn btn-dark" onClick={handleNext}>
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