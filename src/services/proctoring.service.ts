import type { Env } from '../config/environment';
import { allRows, firstRow } from '../database/queries/common';
import type { AttemptRow, ProctoringLogRow, ReviewStatus, Severity } from '../types';
import { ApiError } from '../utils/http';
import { nowIso } from '../utils/time';
import { SUBMISSION_GRACE_SECONDS } from '../config/environment';

export interface EventDefinition {
  severity: Severity;
  description: string;
}

export const PROCTORING_EVENT_TYPES: Record<string, EventDefinition> = {
  NO_FACE_DETECTED: {
    severity: 'medium',
    description: 'No face was detected in the webcam preview for a sustained period.',
  },
  MULTIPLE_FACES_DETECTED: {
    severity: 'high',
    description: 'More than one face was detected in the webcam preview.',
  },
  CAMERA_DISCONNECTED: {
    severity: 'high',
    description: 'The webcam stream stopped or was disconnected during the examination.',
  },
  TAB_SWITCH: {
    severity: 'medium',
    description: 'The examination tab became hidden, which may indicate a tab or window switch.',
  },
  WINDOW_BLUR: {
    severity: 'low',
    description: 'The examination window lost focus.',
  },
  FULLSCREEN_EXIT: {
    severity: 'medium',
    description: 'The examination left fullscreen mode.',
  },
};

const COOLDOWN_MS = 10_000;
const MAX_EVENTS_PER_ATTEMPT = 500;

function sanitizeDetail(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export async function recordProctoringEvent(
  env: Env,
  userId: number,
  attemptId: number,
  eventType: string,
  detail: unknown,
): Promise<{ recorded: boolean; reason?: string; event?: ProctoringLogRow }> {
  const definition = PROCTORING_EVENT_TYPES[eventType];
  if (!definition) {
    throw new ApiError(422, 'INVALID_EVENT_TYPE', 'Unsupported proctoring event type.');
  }

  const attempt = await firstRow<AttemptRow>(
    env.DB,
    'SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?',
    attemptId,
    userId,
  );
  if (!attempt) throw new ApiError(404, 'ATTEMPT_NOT_FOUND', 'Examination attempt not found.');
  if (attempt.status !== 'in_progress') {
    throw new ApiError(409, 'ATTEMPT_CLOSED', 'This attempt has already finished.');
  }
  if (Date.now() > Date.parse(attempt.expires_at) + SUBMISSION_GRACE_SECONDS * 1000) {
    throw new ApiError(409, 'ATTEMPT_EXPIRED', 'The examination time has expired.');
  }

  const latest = await firstRow<{ timestamp: string }>(
    env.DB,
    'SELECT timestamp FROM proctoring_logs WHERE attempt_id = ? AND event_type = ? ORDER BY id DESC LIMIT 1',
    attemptId,
    eventType,
  );
  if (latest && Date.now() - Date.parse(latest.timestamp) < COOLDOWN_MS) {
    return { recorded: false, reason: 'cooldown' };
  }

  const count = await firstRow<{ n: number }>(
    env.DB,
    'SELECT COUNT(*) AS n FROM proctoring_logs WHERE attempt_id = ?',
    attemptId,
  );
  if (Number(count?.n ?? 0) >= MAX_EVENTS_PER_ATTEMPT) {
    return { recorded: false, reason: 'limit' };
  }

  const extra = sanitizeDetail(detail);
  const description = extra ? `${definition.description} Detail: ${extra}` : definition.description;
  const timestamp = nowIso();

  const result = await env.DB
    .prepare(
      `INSERT INTO proctoring_logs (attempt_id, event_type, description, severity, timestamp, review_status)
       VALUES (?, ?, ?, ?, ?, 'unreviewed')`,
    )
    .bind(attemptId, eventType, description, definition.severity, timestamp)
    .run();

  return {
    recorded: true,
    event: {
      id: Number(result.meta.last_row_id),
      attempt_id: attemptId,
      event_type: eventType,
      description,
      severity: definition.severity,
      timestamp,
      review_status: 'unreviewed',
      reviewed_by: null,
      reviewed_at: null,
    },
  };
}

interface AdminEventRow extends ProctoringLogRow {
  student_name: string;
  student_code: string | null;
  exam_id: number;
  exam_title: string;
}

export interface ProctoringFilters {
  examId?: number;
  reviewStatus?: ReviewStatus;
  severity?: Severity;
  search?: string;
  limit?: number;
}

export async function listProctoringEvents(env: Env, filters: ProctoringFilters) {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.examId) {
    conditions.push('e.id = ?');
    params.push(filters.examId);
  }
  if (filters.reviewStatus) {
    conditions.push('p.review_status = ?');
    params.push(filters.reviewStatus);
  }
  if (filters.severity) {
    conditions.push('p.severity = ?');
    params.push(filters.severity);
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push('(u.full_name LIKE ? OR u.student_id LIKE ? OR e.title LIKE ? OR p.event_type LIKE ?)');
    params.push(term, term, term, term);
  }
  params.push(Math.min(Math.max(filters.limit ?? 250, 1), 500));

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await allRows<AdminEventRow>(
    env.DB,
    `SELECT p.*, u.full_name AS student_name, u.student_id AS student_code,
            e.id AS exam_id, e.title AS exam_title
     FROM proctoring_logs p
     JOIN exam_attempts a ON a.id = p.attempt_id
     JOIN users u ON u.id = a.user_id
     JOIN exams e ON e.id = a.exam_id
     ${where}
     ORDER BY p.timestamp DESC, p.id DESC
     LIMIT ?`,
    ...params,
  );

  return rows.map((row) => ({
    id: row.id,
    attemptId: row.attempt_id,
    eventType: row.event_type,
    description: row.description,
    severity: row.severity,
    timestamp: row.timestamp,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    studentName: row.student_name,
    studentId: row.student_code,
    examId: row.exam_id,
    examTitle: row.exam_title,
  }));
}

export async function reviewProctoringEvent(
  env: Env,
  eventId: number,
  reviewStatus: ReviewStatus,
  adminId: number,
) {
  const existing = await firstRow<ProctoringLogRow>(
    env.DB,
    'SELECT * FROM proctoring_logs WHERE id = ?',
    eventId,
  );
  if (!existing) throw new ApiError(404, 'EVENT_NOT_FOUND', 'Proctoring event not found.');

  const reviewed = reviewStatus !== 'unreviewed';
  const reviewedAt = reviewed ? nowIso() : null;
  await env.DB
    .prepare('UPDATE proctoring_logs SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
    .bind(reviewStatus, reviewed ? adminId : null, reviewedAt, eventId)
    .run();

  return {
    id: eventId,
    reviewStatus,
    reviewedBy: reviewed ? adminId : null,
    reviewedAt,
  };
}
