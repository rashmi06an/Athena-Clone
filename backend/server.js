const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const dataDir = process.env.ATHENA_DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    console.error("Could not create dataDir:", err);
  }
}

const questionsPath = process.env.ATHENA_QUESTIONS_PATH || path.join(__dirname, "data", "questions.json");
const sessionsPath = process.env.ATHENA_SESSIONS_PATH || path.join(dataDir, "sessions.json");

function readQuestions() {
  if (fs.existsSync(questionsPath)) {
    return JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  }
  const fallbackPath = path.join(__dirname, "data", "questions.json");
  return JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
}

function readSessions() {
  if (!fs.existsSync(sessionsPath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  const dir = path.dirname(sessionsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function makeSessionId() {
  return `session-${Date.now()}`;
}

function questionForStudent(question) {
  return {
    id: question.id,
    question: question.question,
    options: question.options,
  };
}

app.get("/", (req, res) => {
  res.json({ message: "Exam backend is running" });
});

// Start a new exam session
app.post("/exam/start", (req, res) => {
  const { userId, name } = req.body;

  if (!userId || !name) {
    return res.status(400).json({
      message: "userId and name are required",
    });
  }

  const sessions = readSessions();

  const session = {
    sessionId: makeSessionId(),
    userId,
    name,
    startedAt: new Date().toISOString(),
    submittedAt: null,
    status: "in-progress",
    attempted: 0,
    correct: 0,
    wrong: 0,
    answers: [],
    violations: [],
  };

  sessions.push(session);
  saveSessions(sessions);

  res.status(201).json({
    message: "Exam session started",
    sessionId: session.sessionId,
  });
});

// Get one question
app.get("/exam/mcq/:id", (req, res) => {
  const questions = readQuestions();
  const id = Number(req.params.id);

  const question = questions.find((item) => item.id === id);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  res.json(questionForStudent(question));
});

// Get all questions without correct answers
app.get("/exam/mcq", (req, res) => {
  const questions = readQuestions();
  res.json(questions.map(questionForStudent));
});

// Submit one answer
app.post("/exam/answer", (req, res) => {
  const { sessionId, questionId, selectedAnswer } = req.body;

  if (!sessionId || questionId === undefined || selectedAnswer === undefined) {
    return res.status(400).json({
      message: "sessionId, questionId and selectedAnswer are required",
    });
  }

  const questions = readQuestions();
  const sessions = readSessions();

  const question = questions.find(
    (item) => item.id === Number(questionId)
  );

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.status !== "in-progress") {
    return res.status(400).json({ message: "Exam is already submitted" });
  }

  const alreadyAnswered = session.answers.find(
    (answer) => answer.questionId === Number(questionId)
  );

  if (alreadyAnswered) {
    return res.status(400).json({
      message: "Question already answered",
    });
  }

  const isCorrect = Number(selectedAnswer) === question.correctAnswer;

  session.answers.push({
    questionId: question.id,
    selectedAnswer: Number(selectedAnswer),
    isCorrect,
    answeredAt: new Date().toISOString(),
  });

  session.attempted += 1;

  if (isCorrect) {
    session.correct += 1;
  } else {
    session.wrong += 1;
  }

  saveSessions(sessions);

  res.json({
    message: "Answer saved",
    isCorrect,
    attempted: session.attempted,
    correct: session.correct,
    wrong: session.wrong,
  });
});

// Flag suspicious or proctoring violations (e.g. fullscreen exit)
app.post("/exam/flag", (req, res) => {
  const { sessionId, type, details } = req.body;

  if (!sessionId || !type) {
    return res.status(400).json({
      message: "sessionId and type are required",
    });
  }

  const sessions = readSessions();
  const session = sessions.find((item) => item.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (!session.violations) {
    session.violations = [];
  }

  const violationRecord = {
    id: `v-${Date.now()}`,
    type,
    details: details || "Proctoring violation event",
    timestamp: new Date().toISOString(),
  };

  session.violations.push(violationRecord);
  saveSessions(sessions);

  console.log(`[Security Flag] Session ${sessionId}: ${type} - ${details || ""}`);

  res.json({
    message: "Violation successfully flagged",
    violationCount: session.violations.length,
    latestViolation: violationRecord,
  });
});

// Get current session progress
app.get("/exam/session/:sessionId", (req, res) => {
  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === req.params.sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  res.json(session);
});

// Submit the whole exam
app.post("/exam/submit", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ message: "sessionId is required" });
  }

  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  session.status = "submitted";
  session.submittedAt = new Date().toISOString();

  saveSessions(sessions);

  res.json({
    message: "Exam submitted successfully",
    result: {
      attempted: session.attempted,
      correct: session.correct,
      wrong: session.wrong,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Exam backend running at http://localhost:${PORT}`);
});
