import { requireAdmin } from '../../middleware/authorization';
import { intParam } from '../../middleware/validation';
import {
  addQuestion,
  deleteQuestion,
  listQuestionBank,
  reorderQuestions,
  updateQuestion,
} from '../../services/admin.service';
import { ok, readJsonBody } from '../../utils/http';
import { queryInt, queryText } from '../../utils/params';
import type { Route } from '../../router';

export const questionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/admin/questions',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      return ok({
        items: await listQuestionBank(ctx.env, {
          search: queryText(ctx.url, 'search'),
          examId: queryInt(ctx.url, 'examId'),
        }),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/exams/:id/questions',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      return ok(await addQuestion(ctx.env, examId, body), 201);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/exams/:id/questions/reorder',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const examId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      return ok(await reorderQuestions(ctx.env, examId, body));
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin/questions/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const questionId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      return ok(await updateQuestion(ctx.env, questionId, body));
    },
  },
  {
    method: 'DELETE',
    path: '/api/admin/questions/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const questionId = intParam(ctx.params, 'id');
      return ok(await deleteQuestion(ctx.env, questionId));
    },
  },
];
