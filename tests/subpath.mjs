#!/usr/bin/env node
/**
 * Deployment-shape tests: run the Worker locally with the production BASE_PATH
 * and verify prefix routing, canonical redirects, legacy spaced URLs, static
 * assets, the 404 page and isolation from portfolio paths.
 *
 * Usage: npm run test:subpath
 */
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const PORT = Number(process.env.SUBPATH_PORT ?? 8789);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = '/projects/online-examination-and-proctoring-system';
const LEGACY = '/projects/Online%20Examination%20and%20Proctoring%20System';
const PERSIST = join(ROOT, '.wrangler', 'subpath-test');

rmSync(PERSIST, { recursive: true, force: true });

let passed = 0;
let failed = 0;

async function step(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  • ${name} … ok`);
  } catch (error) {
    failed += 1;
    console.error(`  • ${name} … FAILED\n`);
    console.error(`    ${error.message.replace(/\n/g, '\n    ')}\n`);
  }
}

function check(condition, label, detail) {
  if (!condition) throw new Error(detail ? `${label}\n${detail}` : label);
}

function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

async function get(path) {
  return fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
}

async function waitForServer(child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${ORIGIN}${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // server still starting
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${ORIGIN}`);
}

function stop(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // fall through to kill()
    }
  }
  child.kill('SIGTERM');
}

const child = spawn(
  process.execPath,
  [WRANGLER, 'dev', '--local', '--port', String(PORT), '--persist-to', PERSIST, '--var', `BASE_PATH:${BASE}`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

try {
  await waitForServer(child);
  console.log(`\nSub-path tests against ${ORIGIN}${BASE}\n`);

  await step('base path without a trailing slash redirects permanently', async () => {
    const response = await get(BASE);
    equal(response.status, 308, 'status');
    equal(response.headers.get('location'), `${ORIGIN}${BASE}/`, 'location');
  });

  await step('home page renders inside the sub-path', async () => {
    const response = await get(`${BASE}/`);
    equal(response.status, 200, 'status');
    check((response.headers.get('content-type') ?? '').includes('text/html'), 'HTML content type');
    const html = await response.text();
    check(html.includes('<base href="./">'), 'root-relative base tag');
    check(html.includes('Online Examination'), 'home page copy');
    check((response.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'CSP header');
    check(response.headers.get('x-content-type-options') === 'nosniff', 'nosniff header');
    check(response.headers.get('x-frame-options') === 'DENY', 'frame protection');
  });

  await step('nested pages use the correct relative base', async () => {
    const response = await get(`${BASE}/auth/admin/`);
    equal(response.status, 200, 'status');
    const html = await response.text();
    check(html.includes('<base href="../../">'), 'two-level base tag');
  });

  await step('nested page without a trailing slash redirects', async () => {
    const response = await get(`${BASE}/auth/login`);
    equal(response.status, 308, 'status');
    equal(response.headers.get('location'), `${ORIGIN}${BASE}/auth/login/`, 'location');
  });

  await step('static assets are served through the Worker', async () => {
    const response = await get(`${BASE}/assets/css/royal-bengal.css`);
    equal(response.status, 200, 'status');
    check((response.headers.get('content-type') ?? '').includes('text/css'), 'CSS content type');
    check(!response.headers.get('content-type')?.includes('text/html'), 'not the 404 page');

    const font = await get(`${BASE}/assets/fonts/inter-latin.woff2`);
    equal(font.status, 200, 'font status');
    check((font.headers.get('content-type') ?? '').includes('font/woff2'), 'WOFF2 content type');
  });

  await step('unknown pages return the branded 404 with a rewritten base', async () => {
    const response = await get(`${BASE}/missing-page/`);
    equal(response.status, 404, 'status');
    const html = await response.text();
    check(html.includes(`<base href="${BASE}/">`), 'base rewritten to the deployment prefix');
    check(html.includes('Error 404'), '404 page content');
  });

  await step('legacy spaced and mixed-case URL redirects to the canonical path', async () => {
    const response = await get(`${LEGACY}/`);
    equal(response.status, 308, 'status');
    equal(response.headers.get('location'), `${ORIGIN}${BASE}/`, 'location');
  });

  await step('legacy nested URL redirects to the canonical nested path', async () => {
    const response = await get(`${LEGACY}/auth/login/`);
    equal(response.status, 308, 'status');
    equal(response.headers.get('location'), `${ORIGIN}${BASE}/auth/login/`, 'location');
  });

  await step('API routes resolve under the sub-path', async () => {
    const response = await get(`${BASE}/api/health`);
    equal(response.status, 200, 'status');
    const body = await response.json();
    equal(body.ok, true, 'ok envelope');
    equal(body.data.status, 'ok', 'health status');
  });

  await step('portfolio paths outside the prefix are not served', async () => {
    for (const path of ['/', '/index.html', '/assets/css/royal-bengal.css']) {
      const response = await get(path);
      equal(response.status, 404, `${path} status`);
    }
  });
} catch (error) {
  failed += 1;
  console.error(`\nSub-path harness error: ${error.message}\n`);
} finally {
  stop(child);
}

if (failed > 0 && process.env.SUBPATH_DEBUG === '1') {
  console.error('--- wrangler output ---');
  console.error(serverLog.slice(-4000));
}

console.log(`\n${passed} sub-path checks passed${failed ? `, ${failed} failed` : ''}.\n`);
process.exit(failed ? 1 : 0);
