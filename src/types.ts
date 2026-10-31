export type Role = 'student' | 'admin';

export interface UserRow {
  id: number;
  full_name: string;
  student_id: string | null;
  email: string;
  department: string;
  semester: string;
  password_hash: string;
  role: Role;
  is_active: number;
  created_at: string;
}

export interface AuthUser {
  id: number;
  fullName: string;
  studentId: string | null;
  email: string;
  department: string;
  semester: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
  expiresAt: string;
}

export type ExamStatus = 'draft' | 'published' | 'active' | 'closed';
export type AttemptStatus = 'in_progress' | 'submitted' | 'expired';
export type ReviewStatus = 'unreviewed' | 'reviewed' | 'dismissed';
export type Severity = 'low' | 'medium' | 'high';

export interface ExamRow {
  id: number;
  title: string;
  description: string;
  subject: string;
  duration: number;
  total_marks: number;
  passing_marks: number;
  start_time: string;
  end_time: string;
  instructions: string;
  status: ExamStatus;
  results_published: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionRow {
  id: number;
  exam_id: number;
  question_text: string;
  marks: number;
  question_order: number;
  created_at: string;
}

export interface OptionRow {
  id: number;
  question_id: number;
  option_text: string;
  is_correct: number;
  option_order: number;
}

export interface AttemptRow {
  id: number;
  user_id: number;
  exam_id: number;
  start_time: string;
  expires_at: string;
  end_time: string | null;
  status: AttemptStatus;
  consent_given: number;
  last_activity_at: string | null;
}

export interface ResultRow {
  id: number;
  attempt_id: number;
  obtained_marks: number;
  total_marks: number;
  percentage: number;
  status: 'pass' | 'fail';
  evaluated_at: string;
}

export interface ProctoringLogRow {
  id: number;
  attempt_id: number;
  event_type: string;
  description: string;
  severity: Severity;
  timestamp: string;
  review_status: ReviewStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
}

export interface UserExamRow extends ExamRow {
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

export type ExamUiState = 'available' | 'upcoming' | 'ongoing' | 'completed' | 'ended' | 'locked';

export interface PublicResult {
  attemptId: number;
  examId: number;
  examTitle: string;
  subject: string;
  obtainedMarks: number;
  totalMarks: number;
  percentage: number;
  status: 'pass' | 'fail';
  evaluatedAt: string;
}

export interface StudentResultSummary {
  attemptId: number;
  examId: number;
  examTitle: string;
  subject: string;
  obtainedMarks: number;
  totalMarks: number;
  percentage: number;
  status: 'pass' | 'fail';
  evaluatedAt: string;
}
