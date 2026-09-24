/**
 * api.js — Frontend API service layer
 *
 * All requests use the /api prefix, which Vite's dev-server proxy
 * forwards to the Express backend running on http://localhost:3000.
 *
 * In production (Electron loading a built bundle) the Electron main
 * process starts the Express server and the renderer hits it directly
 * at http://localhost:3000.  A BACKEND_URL env-var or window variable
 * can be used to switch at runtime if needed.
 */
const BASE_URL =
  (typeof window !== 'undefined' && window.__BACKEND_URL__) ||
  (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? 'http://127.0.0.1:3000'
    : '/api');

// ─── helpers ────────────────────────────────────────────────────────────────

async function request(method, endpoint, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, options);

  let data;
  try {
    data = await res.json();
  } catch {
    data = { message: 'Non-JSON response from server' };
  }

  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }

  return data;
}

// ─── Health check ────────────────────────────────────────────────────────────

/** Returns { message: "Exam backend is running" } */
export async function checkHealth() {
  return request('GET', '/');
}

// ─── Exam session ─────────────────────────────────────────────────────────────

/**
 * Start a new exam session.
 * @param {string} userId  Unique student identifier
 * @param {string} name    Student display name
 * @returns {{ message: string, sessionId: string }}
 */
export async function startExam(userId, name) {
  return request('POST', '/exam/start', { userId, name });
}

/**
 * Get the current progress/state of a session.
 * @param {string} sessionId
 */
export async function getSession(sessionId) {
  return request('GET', `/exam/session/${sessionId}`);
}

/**
 * Submit the entire exam.
 * @param {string} sessionId
 * @returns {{ message: string, result: { attempted, correct, wrong } }}
 */
export async function submitExam(sessionId) {
  return request('POST', '/exam/submit', { sessionId });
}

// ─── Questions ────────────────────────────────────────────────────────────────

/**
 * Fetch all MCQ questions (without correct answers).
 * @returns {Array<{ id, question, options }>}
 */
export async function getAllQuestions() {
  return request('GET', '/exam/mcq');
}

/**
 * Fetch a single MCQ question by id.
 * @param {number} id
 */
export async function getQuestion(id) {
  return request('GET', `/exam/mcq/${id}`);
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/**
 * Submit a student's answer for one question.
 * @param {string} sessionId
 * @param {number} questionId
 * @param {number} selectedAnswer  0-based index of chosen option
 * @returns {{ message, isCorrect, attempted, correct, wrong }}
 */
export async function submitAnswer(sessionId, questionId, selectedAnswer) {
  return request('POST', '/exam/answer', { sessionId, questionId, selectedAnswer });
}
