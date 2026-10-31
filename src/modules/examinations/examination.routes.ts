import { requireAdmin } from '../../middleware/authorization';
import { intParam } from '../../middleware/validation';
import {
  createExam,
  deleteExam,
  getAdminExam,
  listExamAttempts,
  listExams,
  setResultsPublished,
  updateExam,
} from '../../services/admin.service';
import { ok, readJsonBody } from '../../utils/http';
import type { Route } from '../../router';
import { ApiError } from '../../utils/http';

export const examinationRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/admin/exams',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      return ok(await listExams(ctx.env));
    },
  },
  {
    method: 'POST',
    path: '/api/admin/exams',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const body = await readJsonBody(ctx.req);
      return ok(await createExam(ctx.env, body), 201);
    },
  },
  {
    method: 'GET',
    path: '/api/admin/exams/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      return ok(await getAdminExam(ctx.env, examId));
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin/exams/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      return ok(await updateExam(ctx.env, examId, body));
    },
  },
  {
    method: 'DELETE',
    path: '/api/admin/exams/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      return ok(await deleteExam(ctx.env, examId));
    },
  },
  {
    method: 'GET',
    path: '/api/admin/exams/:id/attempts',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      return ok(await listExamAttempts(ctx.env, examId));
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin/exams/:id/results-publish',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      if (typeof body.published !== 'boolean') {
        throw new ApiError(422, 'VALIDATION_ERROR', 'published must be true or false.', {
          published: 'Provide true to release results, or false to hide them.',
        });
      }
      return ok(await setResultsPublished(ctx.env, examId, body.published));
    },
  },
];
