import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

async function freePort() {
  const socket = createServer();
  await new Promise((ok) => socket.listen(0, '127.0.0.1', ok));
  const port = socket.address().port;
  await new Promise((ok) => socket.close(ok));
  return port;
}

function launch(port, dbPath) {
  const child = spawn(process.execPath, [resolve('backend/server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error(`Server timeout: ${output}`)), 10000);
    const log = (chunk) => {
      output += chunk;
      if (output.includes(`Jagd-App läuft auf http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolveReady();
      }
    };
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    child.once('exit', (code) => { clearTimeout(timeout); rejectReady(new Error(`Server exited ${code}: ${output}`)); });
  });
  return { child, ready };
}

async function shutdown(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((ok) => child.once('exit', ok));
}

test('30-day login survives process restart; logout revokes it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jagd-auth-test-'));
  const dbPath = join(directory, 'test.sqlite');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let running;
  try {
    running = launch(port, dbPath);
    await running.ready;
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO revier (id, name, passwort_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('test-revier', 'Testrevier', bcrypt.hashSync('test-secret', 4), now, now);
    db.close();

    const login = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Testrevier', passwort: 'test-secret' }),
    });
    assert.equal(login.status, 200, await login.text());
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie, /^jagd_session=/);
    const getRevier = () => fetch(`${base}/api/revier`, { headers: { Cookie: cookie } });
    assert.equal((await getRevier()).status, 200);
    const checkDb = new Database(dbPath);
    const stored = checkDb.prepare('SELECT token_hash, expires_at FROM auth_session').get();
    assert.equal(stored.token_hash.length, 64, 'database stores only a SHA-256 token hash');
    assert.notEqual(stored.token_hash, cookie.split('=')[1]);
    assert.ok(stored.expires_at > Date.now());
    checkDb.close();
    await shutdown(running.child);

    running = launch(port, dbPath);
    await running.ready;
    assert.equal((await getRevier()).status, 200, 'session should survive a server restart');
    const expiryDb = new Database(dbPath);
    expiryDb.prepare('UPDATE auth_session SET expires_at = ?').run(Date.now() - 1);
    assert.equal((await getRevier()).status, 401, 'expired session must not authorize');
    expiryDb.prepare('UPDATE auth_session SET expires_at = ?').run(Date.now() + 60000);
    expiryDb.close();
    assert.equal((await getRevier()).status, 200);
    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.equal((await getRevier()).status, 401, 'logout should revoke immediately');
    await shutdown(running.child);

    running = launch(port, dbPath);
    await running.ready;
    assert.equal((await getRevier()).status, 401, 'revocation should survive a restart');
  } finally {
    await shutdown(running?.child);
    await rm(directory, { recursive: true, force: true });
  }
});
