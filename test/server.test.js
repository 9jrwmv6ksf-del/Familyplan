import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/server.js';

let app;
let base;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'familyplan-'));
  app = createApp({ dataDir: dir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (ops) => fetch(base + '/api/ops', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ops }),
});
const changes = async (since) => (await fetch(`${base}/api/changes?since=${since}`)).json();

test('liefert die App aus', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Familyplan/);
  assert.equal((await fetch(base + '/../server/server.js')).status, 404);
});

test('speichert Änderungen und liefert sie inkrementell aus', async () => {
  const start = (await changes(0)).rev;
  let res = await post([{ collection: 'shopping', id: 'milk', updated_at: 100, data: { name: 'Milch' } }]);
  assert.equal(res.status, 200);
  const afterFirst = await changes(start);
  assert.equal(afterFirst.changes.length, 1);
  assert.deepEqual(afterFirst.changes[0].data, { name: 'Milch', id: 'milk' });

  // Ältere Änderung verliert (last write wins)
  await post([{ collection: 'shopping', id: 'milk', updated_at: 50, data: { name: 'Alt' } }]);
  assert.equal((await changes(start)).changes[0].data.name, 'Milch');

  // Löschen wird als Grabstein übertragen
  res = await post([{ collection: 'shopping', id: 'milk', updated_at: 200, deleted: true }]);
  const del = await changes(afterFirst.rev);
  assert.equal(del.changes.length, 1);
  assert.equal(del.changes[0].deleted, true);
});

test('lehnt ungültige Daten ab', async () => {
  assert.equal((await post([{ collection: 'hacker', id: 'x', updated_at: 1, data: {} }])).status, 400);
  assert.equal((await post([{ collection: 'tasks', id: '', updated_at: 1, data: {} }])).status, 400);
  assert.equal((await post([{ collection: 'tasks', id: 'a', updated_at: 'x', data: {} }])).status, 400);
  const res = await fetch(base + '/api/ops', { method: 'POST', body: 'kein json' });
  assert.equal(res.status, 400);
});

test('meldet Reset, wenn der Client einen zu neuen Stand kennt', async () => {
  const res = await changes(999999);
  assert.equal(res.reset, true);
});

test('benachrichtigt verbundene Geräte per Server-Sent Events', async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/stream', { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = dec.decode((await reader.read()).value);
  assert.match(text, /event: rev/);
  await post([{ collection: 'tasks', id: 't1', updated_at: Date.now(), data: { title: 'Zimmer aufräumen' } }]);
  const { rev } = await changes(0);
  while (!text.includes(`data: ${rev}`)) text += dec.decode((await reader.read()).value);
  ctrl.abort();
});
