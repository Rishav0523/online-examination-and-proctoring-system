import { requireAdmin } from '../../middleware/authorization';
import { Fields, intParam } from '../../middleware/validation';
import {
  getAdminDashboard,
  getStudentDetail,
  listStudents,
  setStudentActive,
} from '../../services/admin.service';
import { ok, readJsonBody } from '../../utils/http';
import { queryEnum, queryText } from '../../utils/params';
import type { Route } from '../../router';

export const adminRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/admin/dashboard',
    auth: 'admin',
    handler: async (ctx) => {
      const auth = requireAdmin(ctx);
      const dashboard = await getAdminDashboard(ctx.env);
      return ok({ admin: auth.user, ...dashboard });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/students',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      return ok(
        await listStudents(ctx.env, {
          search: queryText(ctx.url, 'search'),
          status: queryEnum(ctx.url, 'status', ['active', 'inactive', 'all'] as const),
          department: queryText(ctx.url, 'department'),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/admin/students/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const studentId = intParam(ctx.params, 'id');
      return ok(await getStudentDetail(ctx.env, studentId));
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin/students/:id',
    auth: 'admin',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const studentId = intParam(ctx.params, 'id');
      const body = await readJsonBody(ctx.req);
      const f = new Fields();
      const isActive = f.boolean('isActive', body.isActive, 'Account status');
      f.done();
      return ok(await setStudentActive(ctx.env, studentId, isActive));
    },
  },
];
