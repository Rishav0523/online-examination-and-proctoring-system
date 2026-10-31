import type { Env } from '../config/environment';
import { allRows, firstRow, scalar } from '../database/queries/common';
import { mapExam, mapQuestion, mapUser } from '../database/mappers';
import type {
  AttemptStatus,
  ExamRow,
  ExamStatus,
  OptionRow,
  QuestionRow,
  UserRow,
} from '../types';
import { ApiError } from '../utils/http';
import { nowIso } from '../utils/time';
import { Fields } from '../middleware/validation';
import { finalizeExpiredAttempts } from './evaluation.service';

const EXAM_STATUSES = ['draft', 'published', 'active', 'closed'] as const;

async function getExamRow(env: Env, examId: number): Promise<ExamRow> {
  const exam = await firstRow<ExamRow>(env.DB, 'SELECT * FROM exams WHERE id = ?', examId);
  if (!exam) throw new ApiError(404, 'EXAM_NOT_FOUND', 'Examination not found.');
  return exam;
}

async function countAttemptsForExam(env: Env, examId: number): Promise<number> {
  return scalar(env.DB, 'SELECT COUNT(*) AS value FROM exam_attempts WHERE exam_id = ?', examId);
}

async function recomputeTotals(env: Env, examId: number): Promise<number> {
  const total = await scalar(
    env.DB,
    'SELECT COALESCE(SUM(marks), 0) AS value FROM questions WHERE exam_id = ?',
    examId,
  );
  await env.DB
    .prepare('UPDATE exams SET total_marks = ?, updated_at = ? WHERE id = ?')
    .bind(total, nowIso(), examId)
    .run();
  return total;
}

export async function getAdminDashboard(env: Env) {
  await finalizeExpiredAttempts(env, { limit: 25 });

  const batch = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM exams'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM exams WHERE status = 'active'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM exams WHERE status = 'closed'"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM exam_attempts'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM proctoring_logs'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM proctoring_logs WHERE review_status = 'unreviewed'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM results WHERE status = 'pass'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM results WHERE status = 'fail'"),
    env.DB.prepare(
      `SELECT e.title AS label, COUNT(a.id) AS value
       FROM exams e LEFT JOIN exam_attempts a ON a.exam_id = e.id
       GROUP BY e.id ORDER BY value DESC, e.start_time DESC LIMIT 6`,
    ),
    env.DB.prepare(
      `SELECT event_type AS label, COUNT(*) AS value
       FROM proctoring_logs GROUP BY event_type ORDER BY value DESC`,
    ),
    env.DB.prepare(
      `SELECT status AS label, COUNT(*) AS value FROM results GROUP BY status`,
    ),
  ]);

  const count = (index: number): number => {
    const rows = (batch[index]?.results ?? []) as Array<{ n?: number }>;
    return Number(rows[0]?.n ?? 0);
  };
  const series = (index: number) =>
    ((batch[index]?.results ?? []) as Array<{ label: string; value: number }>).map((row) => ({
      label: row.label,
      value: Number(row.value ?? 0),
    }));

  const recentEvents = await allRows<{
    id: number;
    event_type: string;
    severity: string;
    timestamp: string;
    review_status: string;
    student_name: string;
    exam_title: string;
  }>(
    env.DB,
    `SELECT p.id, p.event_type, p.severity, p.timestamp, p.review_status,
            u.full_name AS student_name, e.title AS exam_title
     FROM proctoring_logs p
     JOIN exam_attempts a ON a.id = p.attempt_id
     JOIN users u ON u.id = a.user_id
     JOIN exams e ON e.id = a.exam_id
     ORDER BY p.timestamp DESC, p.id DESC LIMIT 8`,
  );

  return {
    stats: {
      totalStudents: count(0),
      totalExams: count(1),
      activeExams: count(2),
      completedExams: count(3),
      totalAttempts: count(4),
      proctoringEvents: count(5),
      unreviewedEvents: count(6),
      passCount: count(7),
      failCount: count(8),
    },
    charts: {
      attemptsByExam: series(9),
      eventsByType: series(10),
      resultsDistribution: series(11),
    },
    recentEvents: recentEvents.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      timestamp: row.timestamp,
      reviewStatus: row.review_status,
      studentName: row.student_name,
      examTitle: row.exam_title,
    })),
  };
}

export interface StudentFilters {
  search?: string;
  status?: 'active' | 'inactive' | 'all';
  department?: string;
}

export async function listStudents(env: Env, filters: StudentFilters) {
  const conditions = ["u.role = 'student'"];
  const params: (string | number)[] = [];

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push('(u.full_name LIKE ? OR u.student_id LIKE ? OR u.email LIKE ?)');
    params.push(term, term, term);
  }
  if (filters.status && filters.status !== 'all') {
    conditions.push('u.is_active = ?');
    params.push(filters.status === 'active' ? 1 : 0);
  }
  if (filters.department?.trim()) {
    conditions.push('u.department = ?');
    params.push(filters.department.trim());
  }

  const rows = await allRows<UserRow & { attempt_count: number; pass_count: number }>(
    env.DB,
    `SELECT u.*,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.user_id = u.id) AS attempt_count,
            (SELECT COUNT(*) FROM results r JOIN exam_attempts a2 ON a2.id = r.attempt_id
              WHERE a2.user_id = u.id AND r.status = 'pass') AS pass_count
     FROM users u
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.created_at DESC LIMIT 300`,
    ...params,
  );

  const departments = await allRows<{ department: string }>(
    env.DB,
    "SELECT DISTINCT department FROM users WHERE role = 'student' AND department <> '' ORDER BY department",
  );

  return {
    items: rows.map((row) => ({
      ...mapUser(row),
      attemptCount: Number(row.attempt_count ?? 0),
      passedCount: Number(row.pass_count ?? 0),
    })),
    departments: departments.map((row) => row.department),
  };
}

export async function getStudentDetail(env: Env, studentId: number) {
  const student = await firstRow<UserRow>(
    env.DB,
    "SELECT * FROM users WHERE id = ? AND role = 'student'",
    studentId,
  );
  if (!student) throw new ApiError(404, 'STUDENT_NOT_FOUND', 'Student not found.');

  const attempts = await allRows<{
    id: number;
    exam_id: number;
    exam_title: string;
    subject: string;
    start_time: string;
    end_time: string | null;
    status: AttemptStatus;
    obtained_marks: number | null;
    total_marks: number | null;
    percentage: number | null;
    result_status: 'pass' | 'fail' | null;
    evaluated_at: string | null;
    event_count: number;
    unreviewed_count: number;
  }>(
    env.DB,
    `SELECT a.id, a.exam_id, e.title AS exam_title, e.subject, a.start_time, a.end_time, a.status,
            r.obtained_marks, r.total_marks, r.percentage, r.status AS result_status, r.evaluated_at,
            (SELECT COUNT(*) FROM proctoring_logs p WHERE p.attempt_id = a.id) AS event_count,
            (SELECT COUNT(*) FROM proctoring_logs p WHERE p.attempt_id = a.id AND p.review_status = 'unreviewed') AS unreviewed_count
     FROM exam_attempts a
     JOIN exams e ON e.id = a.exam_id
     LEFT JOIN results r ON r.attempt_id = a.id
     WHERE a.user_id = ?
     ORDER BY a.start_time DESC`,
    studentId,
  );

  const completed = attempts.filter((attempt) => attempt.status !== 'in_progress');
  const scored = completed.filter((attempt) => attempt.percentage !== null);
  const average =
    scored.length > 0
      ? Math.round((scored.reduce((sum, attempt) => sum + Number(attempt.percentage), 0) / scored.length) * 100) / 100
      : 0;

  return {
    student: mapUser(student),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      examId: attempt.exam_id,
      examTitle: attempt.exam_title,
      subject: attempt.subject,
      startedAt: attempt.start_time,
      submittedAt: attempt.end_time,
      status: attempt.status,
      obtainedMarks: attempt.obtained_marks,
      totalMarks: attempt.total_marks,
      percentage: attempt.percentage,
      resultStatus: attempt.result_status,
      evaluatedAt: attempt.evaluated_at,
      proctoringEvents: Number(attempt.event_count ?? 0),
      unreviewedEvents: Number(attempt.unreviewed_count ?? 0),
    })),
    summary: {
      attempts: attempts.length,
      completed: completed.length,
      passed: completed.filter((attempt) => attempt.result_status === 'pass').length,
      averagePercentage: average,
    },
  };
}

export async function setStudentActive(env: Env, studentId: number, isActive: boolean) {
  const student = await firstRow<UserRow>(
    env.DB,
    "SELECT * FROM users WHERE id = ? AND role = 'student'",
    studentId,
  );
  if (!student) throw new ApiError(404, 'STUDENT_NOT_FOUND', 'Student not found.');

  await env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?')
    .bind(isActive ? 1 : 0, studentId)
    .run();
  if (!isActive) {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(studentId).run();
  }

  return { id: studentId, isActive };
}

export async function listExams(env: Env) {
  const rows = await allRows<ExamRow & {
    question_count: number;
    attempt_count: number;
    result_count: number;
  }>(
    env.DB,
    `SELECT e.*,
            (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id) AS attempt_count,
            (SELECT COUNT(*) FROM results r JOIN exam_attempts a2 ON a2.id = r.attempt_id
              WHERE a2.exam_id = e.id) AS result_count
     FROM exams e ORDER BY e.created_at DESC`,
  );

  const summary = { draft: 0, published: 0, active: 0, closed: 0 };
  for (const row of rows) summary[row.status] += 1;

  return {
    items: rows.map((row) => ({
      ...mapExam(row),
      questionCount: Number(row.question_count ?? 0),
      attemptCount: Number(row.attempt_count ?? 0),
      resultCount: Number(row.result_count ?? 0),
    })),
    summary,
  };
}

export async function getAdminExam(env: Env, examId: number) {
  const exam = await getExamRow(env, examId);
  const questions = await allRows<QuestionRow>(
    env.DB,
    'SELECT * FROM questions WHERE exam_id = ? ORDER BY question_order, id',
    examId,
  );
  const options = await allRows<OptionRow>(
    env.DB,
    `SELECT o.* FROM options o JOIN questions q ON q.id = o.question_id
     WHERE q.exam_id = ? ORDER BY o.option_order, o.id`,
    examId,
  );
  const attemptCount = await countAttemptsForExam(env, examId);

  const optionsByQuestion = new Map<number, OptionRow[]>();
  for (const option of options) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push(option);
    optionsByQuestion.set(option.question_id, list);
  }

  return {
    exam: {
      ...mapExam(exam),
      questionCount: questions.length,
      attemptCount,
    },
    questions: questions.map((question) =>
      mapQuestion(question, optionsByQuestion.get(question.id) ?? [], true),
    ),
    canEditQuestions: attemptCount === 0,
  };
}

interface ExamFields {
  title: string;
  description: string;
  subject: string;
  duration: number;
  passingMarks: number;
  startTime: string;
  endTime: string;
  instructions: string;
  status: ExamStatus;
}

function parseExamInput(input: Record<string, unknown>, current?: ExamRow): ExamFields {
  const f = new Fields();
  const title = input.title === undefined && current
    ? current.title
    : f.text('title', input.title, 'Examination title', 3, 150);
  const subject = input.subject === undefined && current
    ? current.subject
    : f.text('subject', input.subject, 'Subject', 2, 80);
  const description = input.description === undefined && current
    ? current.description
    : f.optionalText('description', input.description, 'Description', 2000);
  const instructions = input.instructions === undefined && current
    ? current.instructions
    : f.optionalText('instructions', input.instructions, 'Instructions', 5000);
  const duration = input.duration === undefined && current
    ? current.duration
    : f.int('duration', input.duration, 'Duration (minutes)', 1, 600);
  const passingMarks = input.passingMarks === undefined && current
    ? current.passing_marks
    : f.int('passingMarks', input.passingMarks, 'Passing marks', 0, 5000);
  const startTime = input.startTime === undefined && current
    ? current.start_time
    : f.isoDate('startTime', input.startTime, 'Start date and time');
  const endTime = input.endTime === undefined && current
    ? current.end_time
    : f.isoDate('endTime', input.endTime, 'End date and time');
  const status = input.status === undefined && current
    ? current.status
    : f.oneOf('status', input.status ?? 'draft', EXAM_STATUSES, 'Status', 'draft');

  f.done();

  if (Date.parse(endTime) <= Date.parse(startTime)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The end time must be after the start time.', {
      endTime: 'End time must be after the start time.',
    });
  }

  return {
    title,
    description,
    subject,
    duration,
    passingMarks,
    startTime,
    endTime,
    instructions,
    status,
  };
}

export async function createExam(env: Env, input: Record<string, unknown>) {
  const values = parseExamInput(input);
  if (values.status !== 'draft') {
    throw new ApiError(
      422,
      'EXAM_NOT_READY',
      'Create the examination as a draft, add questions, then publish or activate it.',
      { status: 'New examinations must start as a draft.' },
    );
  }

  const now = nowIso();
  const result = await env.DB
    .prepare(
      `INSERT INTO exams (title, description, subject, duration, total_marks, passing_marks,
                          start_time, end_time, instructions, status, results_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'draft', 0, ?, ?)`,
    )
    .bind(
      values.title,
      values.description,
      values.subject,
      values.duration,
      values.passingMarks,
      values.startTime,
      values.endTime,
      values.instructions,
      now,
      now,
    )
    .run();

  return getAdminExam(env, Number(result.meta.last_row_id));
}

export async function updateExam(env: Env, examId: number, input: Record<string, unknown>) {
  const current = await getExamRow(env, examId);
  const values = parseExamInput(input, current);

  if (values.status === 'published' || values.status === 'active') {
    const questionCount = await scalar(
      env.DB,
      'SELECT COUNT(*) AS value FROM questions WHERE exam_id = ?',
      examId,
    );
    if (questionCount === 0 || current.total_marks === 0) {
      throw new ApiError(409, 'EXAM_NOT_READY', 'Add at least one question before publishing this examination.', {
        status: 'This examination has no questions.',
      });
    }
    if (values.passingMarks > current.total_marks) {
      throw new ApiError(
        422,
        'PASSING_MARKS_INVALID',
        `Passing marks (${values.passingMarks}) cannot exceed the total marks of the questions (${current.total_marks}). Lower the passing marks or add more questions.`,
        { passingMarks: `Passing marks cannot exceed ${current.total_marks}.` },
      );
    }
  }

  await env.DB
    .prepare(
      `UPDATE exams SET title = ?, description = ?, subject = ?, duration = ?, passing_marks = ?,
              start_time = ?, end_time = ?, instructions = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      values.title,
      values.description,
      values.subject,
      values.duration,
      values.passingMarks,
      values.startTime,
      values.endTime,
      values.instructions,
      values.status,
      nowIso(),
      examId,
    )
    .run();

  return getAdminExam(env, examId);
}

export async function deleteExam(env: Env, examId: number) {
  await getExamRow(env, examId);
  const attemptCount = await countAttemptsForExam(env, examId);
  if (attemptCount > 0) {
    throw new ApiError(
      409,
      'EXAM_HAS_ATTEMPTS',
      'This examination has recorded attempts and cannot be deleted. Close it instead to preserve student records.',
    );
  }
  await env.DB.prepare('DELETE FROM exams WHERE id = ?').bind(examId).run();
  return { deleted: true };
}

export async function setResultsPublished(env: Env, examId: number, published: boolean) {
  await getExamRow(env, examId);
  await env.DB.prepare('UPDATE exams SET results_published = ?, updated_at = ? WHERE id = ?')
    .bind(published ? 1 : 0, nowIso(), examId)
    .run();
  return { examId, resultsPublished: published };
}

interface ParsedQuestion {
  text: string;
  marks: number;
  optionTexts: string[];
  correctIndex: number;
}

function parseQuestionInput(input: Record<string, unknown>): ParsedQuestion {
  const f = new Fields();
  const text = f.text('text', input.text, 'Question text', 3, 2000);
  const marks = f.int('marks', input.marks, 'Marks', 1, 100);

  let optionTexts: string[] = [];
  if (!Array.isArray(input.options) || input.options.length !== 4) {
    f.check('options', false, 'Exactly four options are required.');
  } else {
    optionTexts = input.options.map((value, index) => {
      if (typeof value !== 'string' || !value.trim()) {
        f.check('options', false, `Option ${index + 1} is required.`);
        return '';
      }
      const trimmed = value.trim();
      if (trimmed.length > 500) {
        f.check('options', false, 'Each option must be at most 500 characters.');
      }
      return trimmed;
    });
    if (new Set(optionTexts.map((text) => text.toLowerCase())).size !== optionTexts.length) {
      f.check('options', false, 'Options must be distinct.');
    }
  }

  const correctIndex = f.int('correctIndex', input.correctIndex, 'Correct option', 0, 3);
  f.done();
  return { text, marks, optionTexts, correctIndex };
}

function assertQuestionsEditable(exam: ExamRow, attemptCount: number): void {
  if (attemptCount > 0) {
    throw new ApiError(
      409,
      'EXAM_LOCKED',
      'Questions cannot be changed after students have started attempts for this examination.',
    );
  }
  if (exam.status === 'active') {
    throw new ApiError(409, 'EXAM_ACTIVE', 'Close or deactivate the examination before editing its questions.');
  }
}

export async function addQuestion(env: Env, examId: number, input: Record<string, unknown>) {
  const exam = await getExamRow(env, examId);
  const attemptCount = await countAttemptsForExam(env, examId);
  assertQuestionsEditable(exam, attemptCount);

  const parsed = parseQuestionInput(input);
  const maxOrder = await scalar(
    env.DB,
    'SELECT COALESCE(MAX(question_order), 0) AS value FROM questions WHERE exam_id = ?',
    examId,
  );
  const result = await env.DB
    .prepare('INSERT INTO questions (exam_id, question_text, marks, question_order, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(examId, parsed.text, parsed.marks, maxOrder + 1, nowIso())
    .run();
  const questionId = Number(result.meta.last_row_id);

  await env.DB.batch(
    parsed.optionTexts.map((text, index) =>
      env.DB
        .prepare('INSERT INTO options (question_id, option_text, is_correct, option_order) VALUES (?, ?, ?, ?)')
        .bind(questionId, text, index === parsed.correctIndex ? 1 : 0, index),
    ),
  );

  await recomputeTotals(env, examId);
  const question = await firstRow<QuestionRow>(env.DB, 'SELECT * FROM questions WHERE id = ?', questionId);
  const options = await allRows<OptionRow>(
    env.DB,
    'SELECT * FROM options WHERE question_id = ? ORDER BY option_order',
    questionId,
  );
  return mapQuestion(question as QuestionRow, options, true);
}

export async function updateQuestion(
  env: Env,
  questionId: number,
  input: Record<string, unknown>,
) {
  const question = await firstRow<QuestionRow>(env.DB, 'SELECT * FROM questions WHERE id = ?', questionId);
  if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Question not found.');
  const exam = await getExamRow(env, question.exam_id);
  const attemptCount = await countAttemptsForExam(env, question.exam_id);
  assertQuestionsEditable(exam, attemptCount);

  const parsed = parseQuestionInput(input);
  const projectedTotal = exam.total_marks - question.marks + parsed.marks;
  if (
    (exam.status === 'published' || exam.status === 'active') &&
    projectedTotal < exam.passing_marks
  ) {
    throw new ApiError(409, 'PASSING_MARKS_CONFLICT', 'This change would make total marks lower than the passing marks.');
  }

  await env.DB.batch([
    env.DB
      .prepare('UPDATE questions SET question_text = ?, marks = ? WHERE id = ?')
      .bind(parsed.text, parsed.marks, questionId),
    env.DB.prepare('DELETE FROM options WHERE question_id = ?').bind(questionId),
    ...parsed.optionTexts.map((text, index) =>
      env.DB
        .prepare('INSERT INTO options (question_id, option_text, is_correct, option_order) VALUES (?, ?, ?, ?)')
        .bind(questionId, text, index === parsed.correctIndex ? 1 : 0, index),
    ),
  ]);

  await recomputeTotals(env, question.exam_id);
  const options = await allRows<OptionRow>(
    env.DB,
    'SELECT * FROM options WHERE question_id = ? ORDER BY option_order',
    questionId,
  );
  const updated = await firstRow<QuestionRow>(env.DB, 'SELECT * FROM questions WHERE id = ?', questionId);
  return mapQuestion(updated as QuestionRow, options, true);
}

export async function deleteQuestion(env: Env, questionId: number) {
  const question = await firstRow<QuestionRow>(env.DB, 'SELECT * FROM questions WHERE id = ?', questionId);
  if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Question not found.');
  const exam = await getExamRow(env, question.exam_id);
  const attemptCount = await countAttemptsForExam(env, question.exam_id);
  assertQuestionsEditable(exam, attemptCount);

  const projectedTotal = exam.total_marks - question.marks;
  if (
    (exam.status === 'published' || exam.status === 'active') &&
    projectedTotal < exam.passing_marks
  ) {
    throw new ApiError(409, 'PASSING_MARKS_CONFLICT', 'Remove failed: total marks would fall below the passing marks.');
  }

  await env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(questionId).run();

  const remaining = await allRows<{ id: number }>(
    env.DB,
    'SELECT id FROM questions WHERE exam_id = ? ORDER BY question_order, id',
    question.exam_id,
  );
  if (remaining.length > 0) {
    await env.DB.batch(
      remaining.map((row, index) =>
        env.DB.prepare('UPDATE questions SET question_order = ? WHERE id = ?').bind(index + 1, row.id),
      ),
    );
  }

  const totalMarks = await recomputeTotals(env, question.exam_id);
  return { deleted: true, totalMarks };
}

export async function reorderQuestions(
  env: Env,
  examId: number,
  input: Record<string, unknown>,
) {
  const exam = await getExamRow(env, examId);
  const attemptCount = await countAttemptsForExam(env, examId);
  assertQuestionsEditable(exam, attemptCount);

  if (!Array.isArray(input.questionIds)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'questionIds must be an array.', {
      questionIds: 'Provide the question IDs in their new order.',
    });
  }
  const ids = input.questionIds.map((value) => Number(value));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'questionIds must contain positive integers.');
  }

  const existing = await allRows<{ id: number }>(
    env.DB,
    'SELECT id FROM questions WHERE exam_id = ? ORDER BY question_order, id',
    examId,
  );
  const existingIds = existing.map((row) => row.id);
  const sameSet =
    ids.length === existingIds.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => existingIds.includes(id));
  if (!sameSet) {
    throw new ApiError(422, 'INVALID_ORDER', 'Provide every question of this examination exactly once.');
  }

  await env.DB.batch(
    ids.map((id, index) =>
      env.DB.prepare('UPDATE questions SET question_order = ? WHERE id = ? AND exam_id = ?')
        .bind(index + 1, id, examId),
    ),
  );

  return { reordered: true };
}

export async function listExamAttempts(env: Env, examId: number) {
  const exam = await getExamRow(env, examId);
  await finalizeExpiredAttempts(env, { limit: 25 });

  const rows = await allRows<{
    id: number;
    user_id: number;
    full_name: string;
    student_code: string | null;
    start_time: string;
    end_time: string | null;
    status: AttemptStatus;
    obtained_marks: number | null;
    total_marks: number | null;
    percentage: number | null;
    result_status: 'pass' | 'fail' | null;
    event_count: number;
    unreviewed_count: number;
  }>(
    env.DB,
    `SELECT a.id, a.user_id, u.full_name, u.student_id AS student_code, a.start_time, a.end_time, a.status,
            r.obtained_marks, r.total_marks, r.percentage, r.status AS result_status,
            (SELECT COUNT(*) FROM proctoring_logs p WHERE p.attempt_id = a.id) AS event_count,
            (SELECT COUNT(*) FROM proctoring_logs p WHERE p.attempt_id = a.id AND p.review_status = 'unreviewed') AS unreviewed_count
     FROM exam_attempts a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN results r ON r.attempt_id = a.id
     WHERE a.exam_id = ?
     ORDER BY a.start_time DESC`,
    examId,
  );

  return {
    exam: { ...mapExam(exam), attemptCount: rows.length },
    attempts: rows.map((row) => ({
      id: row.id,
      studentId: row.student_code,
      studentName: row.full_name,
      startedAt: row.start_time,
      submittedAt: row.end_time,
      status: row.status,
      obtainedMarks: row.obtained_marks,
      totalMarks: row.total_marks,
      percentage: row.percentage,
      resultStatus: row.result_status,
      proctoringEvents: Number(row.event_count ?? 0),
      unreviewedEvents: Number(row.unreviewed_count ?? 0),
    })),
  };
}

export async function listQuestionBank(
  env: Env,
  filters: { search?: string; examId?: number },
) {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push('(q.question_text LIKE ? OR e.title LIKE ?)');
    params.push(term, term);
  }
  if (filters.examId) {
    conditions.push('e.id = ?');
    params.push(filters.examId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await allRows<QuestionRow & {
    exam_id: number;
    exam_title: string;
    exam_status: ExamStatus;
  }>(
    env.DB,
    `SELECT q.*, e.title AS exam_title, e.status AS exam_status
     FROM questions q JOIN exams e ON e.id = q.exam_id
     ${where}
     ORDER BY e.created_at DESC, q.question_order, q.id LIMIT 500`,
    ...params,
  );

  const questionIds = rows.map((row) => row.id);
  let options: OptionRow[] = [];
  if (questionIds.length > 0) {
    options = await allRows<OptionRow>(
      env.DB,
      `SELECT * FROM options WHERE question_id IN (${questionIds.map(() => '?').join(', ')})
       ORDER BY question_id, option_order, id`,
      ...questionIds,
    );
  }

  const optionsByQuestion = new Map<number, OptionRow[]>();
  for (const option of options) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push(option);
    optionsByQuestion.set(option.question_id, list);
  }

  return rows.map((row) => ({
    ...mapQuestion(row, optionsByQuestion.get(row.id) ?? [], true),
    examId: row.exam_id,
    examTitle: row.exam_title,
    examStatus: row.exam_status,
  }));
}

export async function listResults(
  env: Env,
  filters: { search?: string; examId?: number },
) {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push('(u.full_name LIKE ? OR u.student_id LIKE ? OR e.title LIKE ?)');
    params.push(term, term, term);
  }
  if (filters.examId) {
    conditions.push('e.id = ?');
    params.push(filters.examId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await allRows<{
    attempt_id: number;
    student_name: string;
    student_code: string | null;
    exam_id: number;
    exam_title: string;
    subject: string;
    obtained_marks: number;
    total_marks: number;
    percentage: number;
    status: 'pass' | 'fail';
    evaluated_at: string;
    end_time: string | null;
    results_published: number;
  }>(
    env.DB,
    `SELECT r.attempt_id, u.full_name AS student_name, u.student_id AS student_code,
            e.id AS exam_id, e.title AS exam_title, e.subject, r.obtained_marks, r.total_marks,
            r.percentage, r.status, r.evaluated_at, a.end_time, e.results_published
     FROM results r
     JOIN exam_attempts a ON a.id = r.attempt_id
     JOIN users u ON u.id = a.user_id
     JOIN exams e ON e.id = a.exam_id
     ${where}
     ORDER BY r.evaluated_at DESC LIMIT 500`,
    ...params,
  );

  return rows.map((row) => ({
    attemptId: row.attempt_id,
    studentName: row.student_name,
    studentId: row.student_code,
    examId: row.exam_id,
    examTitle: row.exam_title,
    subject: row.subject,
    obtainedMarks: row.obtained_marks,
    totalMarks: row.total_marks,
    percentage: row.percentage,
    status: row.status,
    evaluatedAt: row.evaluated_at,
    submittedAt: row.end_time,
    resultsPublished: Boolean(row.results_published),
  }));
}
