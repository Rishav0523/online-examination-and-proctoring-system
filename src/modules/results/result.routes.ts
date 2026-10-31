import { requireAdmin } from '../../middleware/authorization';
import { listResults } from '../../services/admin.service';
import { ok } from '../../utils/http';
import { queryInt, queryText } from '../../utils/params';
import type { Route } from '../../router';

export const resultRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/admin/results',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      return ok({
        items: await listResults(ctx.env, {
          search: queryText(ctx.url, 'search'),
          examId: queryInt(ctx.url, 'examId'),
        }),
      });
    },
  },
];
