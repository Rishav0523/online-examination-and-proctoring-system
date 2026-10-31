import { requireAdmin, requireStudent } from '../../middleware/authorization';
import { Fields, intParam } from '../../middleware/validation';
import {
  listProctoringEvents,
  recordProctoringEvent,
  reviewProctoringEvent,
} from '../../services/proctoring.service';
import { ApiError, ok, readJsonBody } from '../../utils/http';
import { queryEnum, queryInt, queryText } from '../../utils/params';
import type { Route } from '../../router';

export const proctoringRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/student/attempts/:id/proctor-events',
    auth: 'student',
    handler: async (ctx) => {
      const auth = requireStudent(ctx);
      const attemptId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      if (typeof body.eventType !== 'string' || !body.eventType.trim()) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'eventType is required.', {
          eventType: 'Provide a proctoring event type.',
        });
      }
      const result = await recordProctoringEvent(
        ctx.env,
        auth.user.id,
        attemptId,
        body.eventType.trim(),
        body.detail,
      );
      return ok(result, result.recorded ? 201 : 200);
    },
  },
  {
    method: 'GET',
    path: '/api/admin/proctoring',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const items = await listProctoringEvents(ctx.env, {
        examId: queryInt(ctx.url, 'examId'),
        reviewStatus: queryEnum(ctx.url, 'reviewStatus', ['unreviewed', 'reviewed', 'dismissed'] as const),
        severity: queryEnum(ctx.url, 'severity', ['low', 'medium', 'high'] as const),
        search: queryText(ctx.url, 'search'),
        limit: queryInt(ctx.url, 'limit'),
      });
      return ok({ items });
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin/proctoring/:id',
    auth: 'admin',
    handler: async (ctx) => {
      const auth = requireAdmin(ctx);
      const eventId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      const f = new Fields();
      const reviewStatus = f.oneOf(
        'reviewStatus',
        body.reviewStatus,
        ['unreviewed', 'reviewed', 'dismissed'] as const,
        'Review status',
        'unreviewed',
      );
      f.done();
      return ok(await reviewProctoringEvent(ctx.env, eventId, reviewStatus, auth.user.id));
    },
  },
];
