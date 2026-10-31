import type {
  AuthUser,
  ExamRow,
  OptionRow,
  ProctoringLogRow,
  QuestionRow,
  ResultRow,
  UserRow,
} from '../types';

export function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    fullName: row.full_name,
    studentId: row.student_id,
    email: row.email,
    department: row.department,
    semester: row.semester,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

export function mapExam(row: ExamRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    subject: row.subject,
    duration: row.duration,
    totalMarks: row.total_marks,
    passingMarks: row.passing_marks,
    startTime: row.start_time,
    endTime: row.end_time,
    instructions: row.instructions,
    status: row.status,
    resultsPublished: Boolean(row.results_published),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapQuestion(q: QuestionRow, options: OptionRow[], includeCorrect: boolean) {
  return {
    id: q.id,
    text: q.question_text,
    marks: q.marks,
    order: q.question_order,
    options: options
      .slice()
      .sort((a, b) => a.option_order - b.option_order || a.id - b.id)
      .map((o) => ({
        id: o.id,
        text: o.option_text,
        ...(includeCorrect ? { isCorrect: Boolean(o.is_correct) } : {}),
      })),
  };
}

export function mapResult(row: ResultRow) {
  return {
    attemptId: row.attempt_id,
    obtainedMarks: row.obtained_marks,
    totalMarks: row.total_marks,
    percentage: row.percentage,
    status: row.status,
    evaluatedAt: row.evaluated_at,
  };
}

export function mapProctoringLog(row: ProctoringLogRow) {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    eventType: row.event_type,
    description: row.description,
    severity: row.severity,
    timestamp: row.timestamp,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}
