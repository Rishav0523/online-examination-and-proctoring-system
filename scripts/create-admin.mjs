#!/usr/bin/env node
/**
 * Creates (or resets) an administrator account without hardcoding credentials.
 *
 * Local:  node scripts/create-admin.mjs --name "Exam Administrator" --email admin@example.edu
 * Remote: node scripts/create-admin.mjs --remote --name "..." --email "..."
 *
 * The password can be typed interactively (hidden), supplied through the
 * ADMIN_PASSWORD environment variable, or passed with --password (not recommended
 * because it may remain in shell history).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 100_000;
const DB_NAME = 'oeps-db';
const WRANGLER_BIN = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const isRemote = args.includes('--remote');
const target = isRemote ? '--remote' : '--local';

function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function validatePassword(password) {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

function wrangler(args, { capture = false } = {}) {
  return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function queryUser(email) {
  const sql = `SELECT id, role FROM users WHERE email = ${sqlString(email)};`;
  const output = wrangler(['d1', 'execute', DB_NAME, target, '--json', '--command', sql], {
    capture: true,
  });
  const start = output.indexOf('[');
  if (start < 0) throw new Error('Could not read Wrangler output.');
  const parsed = JSON.parse(output.slice(start));
  const rows = Array.isArray(parsed) ? parsed[0]?.results ?? [] : parsed.results ?? [];
  return rows[0] ?? null;
}

function runSql(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'oeps-admin-'));
  const file = join(dir, 'create-admin.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    wrangler(['d1', 'execute', DB_NAME, target, `--file=${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    let value = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  console.log(`Creating administrator in the ${isRemote ? 'REMOTE' : 'LOCAL'} D1 database.\n`);

  let name = argValue('--name') ?? process.env.ADMIN_NAME;
  let email = argValue('--email') ?? process.env.ADMIN_EMAIL;
  let password = argValue('--password') ?? process.env.ADMIN_PASSWORD;

  if (!name) name = (await prompt('Administrator full name: ')).trim();
  if (!email) email = (await prompt('Administrator email: ')).trim();

  if (!name || name.length < 2) fail('Name must be at least 2 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Enter a valid email address.');

  if (!password) {
    if (!process.stdin.isTTY) {
      fail('No password supplied. Set ADMIN_PASSWORD or pass --password when not running interactively.');
    }
    password = await promptHidden('Password (hidden): ');
    const confirmation = await promptHidden('Confirm password: ');
    if (password !== confirmation) fail('Passwords do not match.');
  }

  const problem = validatePassword(password);
  if (problem) fail(problem);

  const existing = queryUser(email);
  if (existing && existing.role !== 'admin') {
    fail(`The email ${email} already belongs to a student account. Use a different administrator email.`);
  }

  const hash = hashPassword(password);
  const now = new Date().toISOString();

  let sql;
  if (existing) {
    sql = `UPDATE users SET full_name = ${sqlString(name)}, password_hash = ${sqlString(hash)}, is_active = 1 WHERE id = ${Number(existing.id)};`;
    console.log('An administrator with this email exists; resetting the password and name.');
  } else {
    sql = `INSERT INTO users (full_name, student_id, email, department, semester, password_hash, role, is_active, created_at)
VALUES (${sqlString(name)}, NULL, ${sqlString(email)}, 'Administration', '', ${sqlString(hash)}, 'admin', 1, ${sqlString(now)});`;
    console.log('Creating a new administrator account.');
  }

  runSql(sql);
  console.log(`\nAdministrator ready: ${email}`);
  console.log('Sign in at /auth/admin/ (or /projects/online-examination-and-proctoring-system/auth/admin/ in production).');
}

main().catch((error) => fail(error.message));
