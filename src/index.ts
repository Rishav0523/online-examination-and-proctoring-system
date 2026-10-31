import { basePath, isProduction, type Env } from './config/environment';
import { dispatchApi } from './router';
import { errorResponse, securityHeaders } from './utils/http';

function applySecurityHeaders(headers: Headers, isHtml: boolean): void {
  securityHeaders(isHtml).forEach((value, key) => headers.set(key, value));
}

function finalizeStatic(
  response: Response,
  env: Env,
  statusOverride?: number,
): Response {
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.toLowerCase().includes('text/html');
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, isHtml);

  const base = basePath(env);
  const location = headers.get('Location');
  if (base && location && location.startsWith('/') && location !== base && !location.startsWith(`${base}/`)) {
    headers.set('Location', `${base}${location}`);
  }

  if (isHtml) headers.set('Cache-Control', 'no-cache');
  else if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=300');
  if (statusOverride) headers.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: statusOverride ?? response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveStatic(request: Request, env: Env, path: string): Promise<Response> {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = path;
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  if (response.status !== 404) return finalizeStatic(response, env);

  const notFoundUrl = new URL('/404.html', request.url);
  const notFound = await env.ASSETS.fetch(new Request(notFoundUrl.toString(), { method: 'GET' }));
  if (notFound.status === 200) {
    // 404.html ships with a root-relative base so it works locally; under the
    // deployed sub-path the base must carry the project prefix.
    const base = basePath(env);
    const html = (await notFound.text()).replace('<base href="./">', `<base href="${base}/">`);
    const headers = new Headers(notFound.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.delete('Content-Length');
    return finalizeStatic(new Response(html, { status: 200, headers }), env, 404);
  }

  const headers = securityHeaders(true);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response('Page not found', { status: 404, headers });
}

const LEGACY_PREFIX = '/projects/online examination and proctoring system';

function legacyCanonicalPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const lower = decoded.toLowerCase();
  if (lower === LEGACY_PREFIX) return '/';
  if (lower.startsWith(`${LEGACY_PREFIX}/`)) return decoded.slice(LEGACY_PREFIX.length).toLowerCase();
  return null;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const base = basePath(env);
      let path = url.pathname;

      if (base) {
        // The project was formerly shared with spaces and mixed case. Only that
        // exact prefix is redirected; no other portfolio path is touched.
        const legacy = legacyCanonicalPath(path);
        if (legacy !== null) {
          return Response.redirect(`${url.origin}${base}${legacy}${url.search}`, 308);
        }
        if (path === base) {
          return Response.redirect(`${url.origin}${base}/${url.search}`, 308);
        }
        if (!path.startsWith(`${base}/`)) {
          // The Worker route should only receive this prefix. Do not touch other
          // paths belonging to the portfolio site.
          return new Response('Not found', { status: 404 });
        }
        path = path.slice(base.length) || '/';
      }

      if (path === '/api' || path.startsWith('/api/')) {
        const response = await dispatchApi(request, env, url, path);
        const headers = new Headers(response.headers);
        applySecurityHeaders(headers, false);
        if (isProduction(env)) {
          headers.set('Strict-Transport-Security', 'max-age=31536000');
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      // Page directories are canonical with a trailing slash so relative
      // <base href> resolution stays correct under the deployment sub-path.
      if (path !== '/' && !path.endsWith('/') && !path.includes('.')) {
        return Response.redirect(`${url.origin}${base}${path}/${url.search}`, 308);
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const headers = securityHeaders(false);
        headers.set('Allow', 'GET, HEAD');
        return new Response('Method not allowed', { status: 405, headers });
      }

      return await serveStatic(request, env, path);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
