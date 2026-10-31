import { SUBMISSION_GRACE_SECONDS, type Env } from '../config/environment';
import { allRows, firstRow } from '../database/queries/common';
import type { AttemptRow, AttemptStatus, ResultRow } from '../types';
import { ApiError } from '../utils/http';
import { isoNowMinusSeconds, nowIso, round2 } from '../utils/time';

interface AttemptExamRow extends AttemptRow {
  exam_title: string;
  subject: string;
  passing_marks: number;
  results_published: number;
}

export interface EvaluationOutcome {
  attemptId: number;
  examId: number;
  examTitle: string;
  subject: string;
  resultsPublished: boolean;
  attemptStatus: AttemptStatus;
  alreadySubmitted: boolean;
  result: ResultRow;
}

interface EvaluatedQuestion {
  id: number;
  marks: number;
  correct_option_id: number | null;
}

async function loadAttemptExam(env: Env, attemptId: number): Promise<AttemptExamRow | null> {
  return firstRow<AttemptExamRow>(
    env.DB,
    `SELECT a.*, e.title AS exam_title, e.subject, e.passing_marks, e.results_published
     FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
     WHERE a.id = ?`,
    attemptId,
  );
}

async function loadResult(env: Env, attemptId: number): Promise<ResultRow | null> {
  return firstRow<ResultRow>(env.DB, 'SELECT * FROM results WHERE attempt_id = ?', attemptId);
}

/**
 * Authoritative evaluation. All marks come from the database, never the client.
 * A conditional UPDATE plus a UNIQUE result row prevent duplicate submission.
 */
export async function finalizeAttempt(
  env: Env,
  attemptId: number,
  options: { auto: boolean; expectedUserId?: number },
): Promise<EvaluationOutcome> {
  const attempt = await loadAttemptExam(env, attemptId);
  if (!attempt) throw new ApiError(404, 'ATTEMPT_NOT_FOUND', 'Examination attempt not found.');
  if (options.expectedUserId && attempt.user_id !== options.expectedUserId) {
    throw new ApiError(404, 'ATTEMPT_NOT_FOUND', 'Examination attempt not found.');
  }

  if (attempt.status !== 'in_progress') {
    const existing = await loadResult(env, attemptId);
    if (!existing) {
      throw new ApiError(409, 'ATTEMPT_CLOSED', 'This examination attempt is already closed.');
    }
    return {
      attemptId,
      examId: attempt.exam_id,
      examTitle: attempt.exam_title,
      subject: attempt.subject,
      resultsPublished: Boolean(attempt.results_published),
      attemptStatus: attempt.status,
      alreadySubmitted: true,
      result: existing,
    };
  }

  const now = nowIso();
  const deadline = new Date(Date.parse(attempt.expires_at) + SUBMISSION_GRACE_SECONDS * 1000).toISOString();
  const expired = now > deadline;

  const questions = await allRows<EvaluatedQuestion>(
    env.DB,
    `SELECT q.id, q.marks,
            (SELECT o.id FROM options o WHERE o.question_id = q.id AND o.is_correct = 1 ORDER BY o.id LIMIT 1) AS correct_option_id
     FROM questions q WHERE q.exam_id = ? ORDER BY q.question_order, q.id`,
    attempt.exam_id,
  );
  const answers = await allRows<{ question_id: number; selected_option_id: number | null }>(
    env.DB,
    'SELECT question_id, selected_option_id FROM student_answers WHERE attempt_id = ?',
    attemptId,
  );

  const answerMap = new Map<number, number | null>();
  for (const answer of answers) answerMap.set(answer.question_id, answer.selected_option_id);

  let obtainedMarks = 0;
  let totalMarks = 0;
  for (const question of questions) {
    totalMarks += question.marks;
    const selected = answerMap.get(question.id);
    if (selected != null && selected === question.correct_option_id) {
      obtainedMarks += question.marks;
    }
  }

  const percentage = totalMarks > 0 ? round2((obtainedMarks / totalMarks) * 100) : 0;
  const pass = totalMarks > 0 && obtainedMarks >= attempt.passing_marks;
  const finalStatus: AttemptStatus = expired ? 'expired' : 'submitted';
  const endTime = expired ? attempt.expires_at : now;

  const update = env.DB
    .prepare(
      `UPDATE exam_attempts SET status = ?, end_time = ?, last_activity_at = ?
       WHERE id = ? AND status = 'in_progress'`,
    )
    .bind(finalStatus, endTime, now, attemptId);
  const insert = env.DB
    .prepare(
      `INSERT INTO results (attempt_id, obtained_marks, total_marks, percentage, status, evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(attemptId, obtainedMarks, totalMarks, percentage, pass ? 'pass' : 'fail', now);

  let batchResults: D1Result[];
  try {
    batchResults = await env.DB.batch([update, insert]);
  } catch (error) {
    // A concurrent submission may have won the race; return its result instead.
    const existing = await loadResult(env, attemptId);
    if (existing) {
      const fresh = await loadAttemptExam(env, attemptId);
      return {
        attemptId,
        examId: attempt.exam_id,
        examTitle: attempt.exam_title,
        subject: attempt.subject,
        resultsPublished: Boolean(fresh?.results_published ?? attempt.results_published),
        attemptStatus: fresh?.status ?? 'submitted',
        alreadySubmitted: true,
        result: existing,
      };
    }
    console.error('Evaluation batch failed', error);
    throw new ApiError(500, 'EVALUATION_FAILED', 'Could not finalise this examination. Please try again.');
  }

  if (!batchResults[0]?.meta.changes) {
    const existing = await loadResult(env, attemptId);
    if (existing) {
      return {
        attemptId,
        examId: attempt.exam_id,
        examTitle: attempt.exam_title,
        subject: attempt.subject,
        resultsPublished: Boolean(attempt.results_published),
        attemptStatus: 'submitted',
        alreadySubmitted: true,
        result: existing,
      };
    }
    throw new ApiError(409, 'ATTEMPT_CLOSED', 'This examination attempt is already closed.');
  }

  return {
    attemptId,
    examId: attempt.exam_id,
    examTitle: attempt.exam_title,
    subject: attempt.subject,
    resultsPublished: Boolean(attempt.results_published),
    attemptStatus: finalStatus,
    alreadySubmitted: false,
    result: {
      id: 0,
      attempt_id: attemptId,
      obtained_marks: obtainedMarks,
      total_marks: totalMarks,
      percentage,
      status: pass ? 'pass' : 'fail',
      evaluated_at: now,
    },
  };
}

/** Lazy auto-submission: called on read paths so expired attempts close promptly. */
export async function finalizeExpiredAttempts(
  env: Env,
  options: { userId?: number; limit?: number } = {},
): Promise<number> {
  const cutoff = isoNowMinusSeconds(SUBMISSION_GRACE_SECONDS);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);
  const rows = options.userId
    ? await allRows<{ id: number }>(
        env.DB,
        `SELECT id FROM exam_attempts
         WHERE status = 'in_progress' AND expires_at <= ? AND user_id = ?
         ORDER BY expires_at ASC LIMIT ?`,
        cutoff,
        options.userId,
        limit,
      )
    : await allRows<{ id: number }>(
        env.DB,
        `SELECT id FROM exam_attempts
         WHERE status = 'in_progress' AND expires_at <= ?
         ORDER BY expires_at ASC LIMIT ?`,
        cutoff,
        limit,
      );

  let finalized = 0;
  for (const row of rows) {
    try {
      await finalizeAttempt(env, row.id, { auto: true });
      finalized += 1;
    } catch (error) {
      console.error('Auto-finalisation failed for attempt', row.id, error);
    }
  }
  return finalized;
}
