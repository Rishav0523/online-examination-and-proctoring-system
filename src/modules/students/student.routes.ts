import { requireStudent } from '../../middleware/authorization';
import { Fields, intParam } from '../../middleware/validation';
import {
  getStudentAttempt,
  getStudentAttempts,
  getStudentDashboard,
  getStudentExam,
  getStudentExams,
  getStudentResults,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from '../../services/examination.service';
import { ApiError, ok, readJsonBody } from '../../utils/http';
import type { Route } from '../../router';

export const studentRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/student/dashboard',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const dashboard = await getStudentDashboard(ctx.env, auth.user.id);
      return ok({ user: auth.user, ...dashboard });
    },
  },
  {
    method: 'GET',
    path: '/api/student/exams',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      return ok({ items: await getStudentExams(ctx.env, auth.user.id) });
    },
  },
  {
    method: 'GET',
    path: '/api/student/exams/:id',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const examId = intParam(ctx.params, 'id');
      return ok(await getStudentExam(ctx.env, auth.user.id, examId));
    },
  },
  {
    method: 'POST',
    path: '/api/student/exams/:id/start',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const examId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      const f = new Fields();
      const consent = body.consent === true ? true : f.boolean('consent', body.consent, 'Proctoring consent');
      f.done();
      if (!consent) {
        throw new ApiError(
          422,
          'CONSENT_REQUIRED',
          'You must read the instructions and provide consent before starting.',
          { consent: 'Consent is required to start a monitored examination.' },
        );
      }
      return ok(await startAttempt(ctx.env, auth.user.id, examId));
    },
  },
  {
    method: 'GET',
    path: '/api/student/attempts',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      return ok({ items: await getStudentAttempts(ctx.env, auth.user.id) });
    },
  },
  {
    method: 'GET',
    path: '/api/student/attempts/:id',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const attemptId = intParam(ctx.params, 'id');
      return ok(await getStudentAttempt(ctx.env, auth.user.id, attemptId));
    },
  },
  {
    method: 'PUT',
    path: '/api/student/attempts/:id/answers/:questionId',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const attemptId = intParam(ctx.params, 'id');
      const questionId = intParam(ctx.params, 'questionId');
      const body = await readJsonBody(ctx.req);
      if (!Object.prototype.hasOwnProperty.call(body, 'optionId')) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'optionId is required (use null to clear an answer).');
      }
      const raw = body.optionId;
      if (raw !== null && (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0)) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'optionId must be a positive integer or null.', {
          optionId: 'Select a valid option.',
        });
      }
      return ok(await saveAnswer(ctx.env, auth.user.id, attemptId, questionId, raw));
    },
  },
  {
    method: 'POST',
    path: '/api/student/attempts/:id/submit',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const attemptId = intParam(ctx.params, 'id');
      return ok(await submitAttempt(ctx.env, auth.user.id, attemptId));
    },
  },
  {
    method: 'GET',
    path: '/api/student/results',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      return ok(await getStudentResults(ctx.env, auth.user.id));
    },
  },
];
