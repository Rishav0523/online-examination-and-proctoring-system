import { SUBMISSION_GRACE_SECONDS, type Env } from '../config/environment';
import { allRows, firstRow } from '../database/queries/common';
import type {
  AttemptRow,
  AttemptStatus,
  ExamRow,
  ExamStatus,
  ExamUiState,
  StudentResultSummary,
} from '../types';
import { ApiError } from '../utils/http';
import { nowIso, secondsUntil } from '../utils/time';
import { finalizeAttempt, finalizeExpiredAttempts, type EvaluationOutcome } from './evaluation.service';

const GRACE_MS = SUBMISSION_GRACE_SECONDS * 1000;

interface StudentExamRow {
  id: number;
  title: string;
  subject: string;
  description: string;
  duration: number;
  total_marks: number;
  passing_marks: number;
  start_time: string;
  end_time: string;
  instructions: string;
  status: ExamStatus;
  results_published: number;
  question_count: number;
  attempt_id: number | null;
  attempt_status: AttemptStatus | null;
  attempt_start: string | null;
  attempt_expires: string | null;
  result_obtained: number | null;
  result_total: number | null;
  result_percentage: number | null;
  result_status: 'pass' | 'fail' | null;
  result_evaluated_at: string | null;
}

const STUDENT_EXAM_SELECT = `
  SELECT e.id, e.title, e.subject, e.description, e.duration, e.total_marks, e.passing_marks,
         e.start_time, e.end_time, e.instructions, e.status, e.results_published,
         (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
         a.id AS attempt_id, a.status AS attempt_status, a.start_time AS attempt_start,
         a.expires_at AS attempt_expires,
         r.obtained_marks AS result_obtained, r.total_marks AS result_total,
         r.percentage AS result_percentage, r.status AS result_status,
         r.evaluated_at AS result_evaluated_at
  FROM exams e
  LEFT JOIN exam_attempts a ON a.exam_id = e.id AND a.user_id = ?
  LEFT JOIN results r ON r.attempt_id = a.id
`;

function computeState(row: StudentExamRow, nowMs: number): { state: ExamUiState; canStart: boolean } {
  const start = Date.parse(row.start_time);
  const end = Date.parse(row.end_time);

  if (row.attempt_id && row.attempt_status === 'in_progress') {
    return { state: 'ongoing', canStart: false };
  }
  if (row.attempt_id) return { state: 'completed', canStart: false };
  if (row.status === 'closed' || nowMs > end) return { state: 'ended', canStart: false };
  if (nowMs < start) return { state: 'upcoming', canStart: false };
  if (row.status === 'active' && row.question_count > 0) return { state: 'available', canStart: true };
  return { state: 'locked', canStart: false };
}

function mapStudentExam(row: StudentExamRow, nowMs: number) {
  const { state, canStart } = computeState(row, nowMs);
  const released = Boolean(row.results_published);
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    description: row.description,
    duration: row.duration,
    totalMarks: row.total_marks,
    passingMarks: row.passing_marks,
    startTime: row.start_time,
    endTime: row.end_time,
    instructions: row.instructions,
    status: row.status,
    questionCount: row.question_count,
    state,
    canStart,
    attempt: row.attempt_id
      ? {
          id: row.attempt_id,
          status: row.attempt_status,
          startedAt: row.attempt_start,
          expiresAt: row.attempt_expires,
          remainingSeconds:
            row.attempt_status === 'in_progress' && row.attempt_expires
              ? secondsUntil(row.attempt_expires)
              : 0,
        }
      : null,
    result:
      released && row.result_status
        ? {
            obtainedMarks: row.result_obtained,
            totalMarks: row.result_total,
            percentage: row.result_percentage,
            status: row.result_status,
            evaluatedAt: row.result_evaluated_at,
          }
        : null,
  };
}

async function fetchStudentExams(env: Env, userId: number): Promise<StudentExamRow[]> {
  return allRows<StudentExamRow>(
    env.DB,
    `${STUDENT_EXAM_SELECT} WHERE e.status <> 'draft' ORDER BY e.start_time DESC`,
    userId,
  );
}

async function fetchStudentExam(env: Env, userId: number, examId: number): Promise<StudentExamRow | null> {
  return firstRow<StudentExamRow>(
    env.DB,
    `${STUDENT_EXAM_SELECT} WHERE e.id = ? AND e.status <> 'draft' LIMIT 1`,
    userId,
    examId,
  );
}

async function releasedResultCount(env: Env, userId: number): Promise<number> {
  const row = await firstRow<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM results r
     JOIN exam_attempts a ON a.id = r.attempt_id
     JOIN exams e ON e.id = a.exam_id
     WHERE a.user_id = ? AND e.results_published = 1`,
    userId,
  );
  return Number(row?.n ?? 0);
}

async function recentResults(env: Env, userId: number, limit = 8): Promise<StudentResultSummary[]> {
  const rows = await allRows<{
    attempt_id: number;
    exam_id: number;
    exam_title: string;
    subject: string;
    obtained_marks: number;
    total_marks: number;
    percentage: number;
    status: 'pass' | 'fail';
    evaluated_at: string;
  }>(
    env.DB,
    `SELECT r.attempt_id, e.id AS exam_id, e.title AS exam_title, e.subject, r.obtained_marks, r.total_marks,
            r.percentage, r.status, r.evaluated_at
     FROM results r
     JOIN exam_attempts a ON a.id = r.attempt_id
     JOIN exams e ON e.id = a.exam_id
     WHERE a.user_id = ? AND e.results_published = 1
     ORDER BY r.evaluated_at DESC LIMIT ?`,
    userId,
    limit,
  );
  return rows.map((row) => ({
    attemptId: row.attempt_id,
    examId: row.exam_id,
    examTitle: row.exam_title,
    subject: row.subject,
    obtainedMarks: row.obtained_marks,
    totalMarks: row.total_marks,
    percentage: row.percentage,
    status: row.status,
    evaluatedAt: row.evaluated_at,
  }));
}

export async function getStudentExams(env: Env, userId: number) {
  await finalizeExpiredAttempts(env, { userId });
  const nowMs = Date.now();
  const rows = await fetchStudentExams(env, userId);
  return rows.map((row) => mapStudentExam(row, nowMs));
}

export async function getStudentExam(env: Env, userId: number, examId: number) {
  await finalizeExpiredAttempts(env, { userId });
  const row = await fetchStudentExam(env, userId, examId);
  if (!row) throw new ApiError(404, 'EXAM_NOT_FOUND', 'Examination not found.');
  return mapStudentExam(row, Date.now());
}

export async function startAttempt(env: Env, userId: number, examId: number): Promise<{
  attemptId: number;
  resumed: boolean;
  examTitle: string;
  duration: number;
  startTime: string;
  expiresAt: string;
  remainingSeconds: number;
}> {
  await finalizeExpiredAttempts(env, { userId });

  const exam = await firstRow<ExamRow>(env.DB, 'SELECT * FROM exams WHERE id = ?', examId);
  if (!exam || exam.status === 'draft') {
    throw new ApiError(404, 'EXAM_NOT_FOUND', 'Examination not found.');
  }
  if (exam.status !== 'active') {
    throw new ApiError(409, 'EXAM_NOT_ACTIVE', 'This examination is not currently open for attempts.');
  }

  const now = nowIso();
  const nowMs = Date.now();
  if (nowMs < Date.parse(exam.start_time)) {
    throw new ApiError(409, 'EXAM_NOT_STARTED', 'This examination has not started yet.');
  }
  if (nowMs > Date.parse(exam.end_time)) {
    throw new ApiError(409, 'EXAM_ENDED', 'The examination window has ended.');
  }

  const questionCount = await firstRow<{ n: number }>(
    env.DB,
    'SELECT COUNT(*) AS n FROM questions WHERE exam_id = ?',
    examId,
  );
  if (!questionCount || Number(questionCount.n) === 0) {
    throw new ApiError(409, 'EXAM_NOT_READY', 'This examination has no questions yet.');
  }

  const existing = await firstRow<AttemptRow>(
    env.DB,
    'SELECT * FROM exam_attempts WHERE user_id = ? AND exam_id = ?',
    userId,
    examId,
  );

  if (existing) {
    if (existing.status === 'in_progress' && nowMs <= Date.parse(existing.expires_at) + GRACE_MS) {
      return {
        attemptId: existing.id,
        resumed: true,
        examTitle: exam.title,
        duration: exam.duration,
        startTime: existing.start_time,
        expiresAt: existing.expires_at,
        remainingSeconds: secondsUntil(existing.expires_at),
      };
    }
    throw new ApiError(409, 'ALREADY_ATTEMPTED', 'You have already attempted this examination.');
  }

  const expiresAt = new Date(
    Math.min(nowMs + exam.duration * 60_000, Date.parse(exam.end_time)),
  ).toISOString();
  if (Date.parse(expiresAt) <= nowMs) {
    throw new ApiError(409, 'EXAM_ENDED', 'Not enough time remains in the examination window.');
  }

  try {
    const inserted = await env.DB
      .prepare(
        `INSERT INTO exam_attempts (user_id, exam_id, start_time, expires_at, status, consent_given, last_activity_at)
         VALUES (?, ?, ?, ?, 'in_progress', 1, ?)`,
      )
      .bind(userId, examId, now, expiresAt, now)
      .run();
    return {
      attemptId: Number(inserted.meta.last_row_id),
      resumed: false,
      examTitle: exam.title,
      duration: exam.duration,
      startTime: now,
      expiresAt,
      remainingSeconds: secondsUntil(expiresAt),
    };
  } catch (error) {
    console.error('Attempt insert failed', error);
    throw new ApiError(409, 'ALREADY_ATTEMPTED', 'An attempt for this examination already exists.');
  }
}

interface AttemptExamRow extends AttemptRow {
  exam_title: string;
  subject: string;
  duration: number;
  exam_total_marks: number;
  passing_marks: number;
  instructions: string;
  results_published: number;
  exam_status: ExamStatus;
}

async function loadAttemptExam(env: Env, userId: number, attemptId: number): Promise<AttemptExamRow | null> {
  return firstRow<AttemptExamRow>(
    env.DB,
    `SELECT a.*, e.title AS exam_title, e.subject, e.duration, e.total_marks AS exam_total_marks,
            e.passing_marks, e.instructions, e.results_published, e.status AS exam_status
     FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
     WHERE a.id = ? AND a.user_id = ?`,
    attemptId,
    userId,
  );
}

function studentOutcome(outcome: EvaluationOutcome) {
  return {
    attemptId: outcome.attemptId,
    examId: outcome.examId,
    examTitle: outcome.examTitle,
    status: outcome.attemptStatus,
    resultsPublished: outcome.resultsPublished,
    alreadySubmitted: outcome.alreadySubmitted,
    result: outcome.resultsPublished
      ? {
          obtainedMarks: outcome.result.obtained_marks,
          totalMarks: outcome.result.total_marks,
          percentage: outcome.result.percentage,
          status: outcome.result.status,
          evaluatedAt: outcome.result.evaluated_at,
        }
      : null,
  };
}

export async function getStudentAttempt(env: Env, userId: number, attemptId: number) {
  let attempt = await loadAttemptExam(env, userId, attemptId);
  if (!attempt) throw new ApiError(404, 'ATTEMPT_NOT_FOUND', 'Examination attempt not found.');

  if (
    attempt.status === 'in_progress' &&
    Date.now() > Date.parse(attempt.expires_at) + GRACE_MS
  ) {
    await finalizeAttempt(env, attemptId, { auto: true, expectedUserId: userId });
    attempt = await loadAttemptExam(env, userId, attemptId);
    if (!attempt) throw new ApiError(404, 'ATTEMPT_NOT_FOUND', 'Examination attempt not found.');
  }

  if (attempt.status !== 'in_progress') {
    const outcome = await finalizeAttempt(env, attemptId, {
      auto: true,
      expectedUserId: userId,
    });
    return {
      attemptId,
      examId: attempt.exam_id,
      examTitle: attempt.exam_title,
      status: attempt.status,
      finished: true,
      submittedAt: attempt.end_time,
      resultsPublished: outcome.resultsPublished,
      result: studentOutcome(outcome).result,
    };
  }

  const questions = await allRows<{
    id: number;
    question_text: string;
    marks: number;
    question_order: number;
  }>(
    env.DB,
    `SELECT id, question_text, marks, question_order FROM questions
     WHERE exam_id = ? ORDER BY question_order, id`,
    attempt.exam_id,
  );
  const options = await allRows<{
    id: number;
    question_id: number;
    option_text: string;
    option_order: number;
  }>(
    env.DB,
    `SELECT o.id, o.question_id, o.option_text, o.option_order
     FROM options o JOIN questions q ON q.id = o.question_id
     WHERE q.exam_id = ? ORDER BY o.option_order, o.id`,
    attempt.exam_id,
  );
  const answers = await allRows<{ question_id: number; selected_option_id: number | null }>(
    env.DB,
    'SELECT question_id, selected_option_id FROM student_answers WHERE attempt_id = ?',
    attemptId,
  );

  const optionsByQuestion = new Map<number, typeof options>();
  for (const option of options) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push(option);
    optionsByQuestion.set(option.question_id, list);
  }
  const answerMap: Record<number, number | null> = {};
  for (const answer of answers) answerMap[answer.question_id] = answer.selected_option_id;

  return {
    attemptId,
    examId: attempt.exam_id,
    examTitle: attempt.exam_title,
    subject: attempt.subject,
    instructions: attempt.instructions,
    status: attempt.status,
    startedAt: attempt.start_time,
    expiresAt: attempt.expires_at,
    serverNow: nowIso(),
    remainingSeconds: secondsUntil(attempt.expires_at),
    duration: attempt.duration,
    totalMarks: attempt.exam_total_marks,
    passingMarks: attempt.passing_marks,
    questions: questions.map((question) => ({
      id: question.id,
      text: question.question_text,
      marks: question.marks,
      order: question.question_order,
      options: (optionsByQuestion.get(question.id) ?? []).map((option) => ({
        id: option.id,
        text: option.option_text,
      })),
    })),
    answers: answerMap,
    finished: false,
  };
}

export async function saveAnswer(
  env: Env,
  userId: number,
  attemptId: number,
  questionId: number,
  optionId: number | null,
) {
  const attempt = await firstRow<AttemptRow>(
    env.DB,
    'SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?',
    attemptId,
    userId,
  );
  if (!attempt) throw new ApiError(404, 'ATTEMPT_NOT_FOUND', 'Examination attempt not found.');
  if (attempt.status !== 'in_progress') {
    throw new ApiError(409, 'ATTEMPT_CLOSED', 'This attempt has already been submitted.');
  }

  if (Date.now() > Date.parse(attempt.expires_at) + GRACE_MS) {
    await finalizeAttempt(env, attemptId, { auto: true, expectedUserId: userId });
    throw new ApiError(409, 'ATTEMPT_EXPIRED', 'The examination time has expired. Your saved answers were submitted.');
  }

  const question = await firstRow<{ id: number }>(
    env.DB,
    'SELECT id FROM questions WHERE id = ? AND exam_id = ?',
    questionId,
    attempt.exam_id,
  );
  if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Question not found in this examination.');

  if (optionId !== null) {
    const option = await firstRow<{ id: number }>(
      env.DB,
      'SELECT id FROM options WHERE id = ? AND question_id = ?',
      optionId,
      questionId,
    );
    if (!option) throw new ApiError(422, 'INVALID_OPTION', 'The selected option does not belong to this question.');
  }

  const now = nowIso();
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO student_answers (attempt_id, question_id, selected_option_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET selected_option_id = excluded.selected_option_id, updated_at = excluded.updated_at`,
      )
      .bind(attemptId, questionId, optionId, now),
    env.DB
      .prepare('UPDATE exam_attempts SET last_activity_at = ? WHERE id = ?')
      .bind(now, attemptId),
  ]);

  return { questionId, optionId, savedAt: now };
}

export async function submitAttempt(env: Env, userId: number, attemptId: number) {
  const outcome = await finalizeAttempt(env, attemptId, { auto: false, expectedUserId: userId });
  return { submitted: true, ...studentOutcome(outcome) };
}

export async function getStudentDashboard(env: Env, userId: number) {
  await finalizeExpiredAttempts(env, { userId });
  const nowMs = Date.now();
  const rows = await fetchStudentExams(env, userId);
  const exams = rows.map((row) => mapStudentExam(row, nowMs));
  const summary = {
    available: exams.filter((exam) => exam.canStart).length,
    upcoming: exams.filter((exam) => exam.state === 'upcoming').length,
    ongoing: exams.filter((exam) => exam.state === 'ongoing').length,
    completed: exams.filter((exam) => exam.state === 'completed').length,
    publishedResults: await releasedResultCount(env, userId),
  };
  return {
    summary,
    exams,
    recentResults: await recentResults(env, userId, 5),
  };
}

export async function getStudentAttempts(env: Env, userId: number) {
  await finalizeExpiredAttempts(env, { userId });
  const rows = await allRows<{
    id: number;
    exam_id: number;
    exam_title: string;
    subject: string;
    start_time: string;
    expires_at: string;
    end_time: string | null;
    status: AttemptStatus;
    results_published: number;
    obtained_marks: number | null;
    total_marks: number | null;
    percentage: number | null;
    result_status: 'pass' | 'fail' | null;
    evaluated_at: string | null;
  }>(
    env.DB,
    `SELECT a.id, a.exam_id, e.title AS exam_title, e.subject, a.start_time, a.expires_at, a.end_time,
            a.status, e.results_published, r.obtained_marks, r.total_marks, r.percentage,
            r.status AS result_status, r.evaluated_at
     FROM exam_attempts a
     JOIN exams e ON e.id = a.exam_id
     LEFT JOIN results r ON r.attempt_id = a.id
     WHERE a.user_id = ?
     ORDER BY a.start_time DESC LIMIT 100`,
    userId,
  );

  return rows.map((row) => ({
    id: row.id,
    examId: row.exam_id,
    examTitle: row.exam_title,
    subject: row.subject,
    startedAt: row.start_time,
    expiresAt: row.expires_at,
    submittedAt: row.end_time,
    status: row.status,
    result:
      row.results_published && row.result_status
        ? {
            obtainedMarks: row.obtained_marks,
            totalMarks: row.total_marks,
            percentage: row.percentage,
            status: row.result_status,
            evaluatedAt: row.evaluated_at,
          }
        : null,
  }));
}

export async function getStudentResults(env: Env, userId: number) {
  const results = await recentResults(env, userId, 100);
  const pending = await firstRow<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM results r
     JOIN exam_attempts a ON a.id = r.attempt_id
     JOIN exams e ON e.id = a.exam_id
     WHERE a.user_id = ? AND e.results_published = 0`,
    userId,
  );
  return { results, pendingResults: Number(pending?.n ?? 0) };
}
