// Familyplan – kleiner Sync-Server ohne externe Abhängigkeiten.
// Speichert alle Daten als JSON-Dokumente in SQLite und verteilt Änderungen
// per Server-Sent Events in Echtzeit an alle verbundenen Geräte.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(ROOT, '..', 'public');

export const COLLECTIONS = new Set(['members', 'events', 'tasks', 'completions', 'shopping', 'meals']);
const MAX_BODY = 2 * 1024 * 1024;
const MAX_DOC = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL,
      id         TEXT NOT NULL,
      data       TEXT,
      updated_at INTEGER NOT NULL,
      deleted    INTEGER NOT NULL DEFAULT 0,
      rev        INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS docs_rev ON docs(rev);
  `);
  return db;
}

export function createApp({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'familyplan.db'));

  const stmt = {
    maxRev: db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM docs'),
    get: db.prepare('SELECT updated_at FROM docs WHERE collection = ? AND id = ?'),
    upsert: db.prepare(`
      INSERT INTO docs (collection, id, data, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (collection, id) DO UPDATE SET
        data = excluded.data, updated_at = excluded.updated_at,
        deleted = excluded.deleted, rev = excluded.rev
    `),
    since: db.prepare('SELECT collection, id, data, updated_at, deleted, rev FROM docs WHERE rev > ? ORDER BY rev'),
  };

  let rev = Number(stmt.maxRev.get().rev);
  const clients = new Set();

  function broadcast() {
    for (const res of clients) res.write(`event: rev\ndata: ${rev}\n\n`);
  }

  // Wendet Änderungen nach dem Prinzip "last write wins" an.
  function applyOps(ops) {
    let changed = 0;
    db.exec('BEGIN');
    try {
      for (const op of ops) {
        const existing = stmt.get.get(op.collection, op.id);
        if (existing && Number(existing.updated_at) > op.updated_at) continue;
        rev += 1;
        stmt.upsert.run(op.collection, op.id, op.deleted ? null : JSON.stringify(op.data),
          op.updated_at, op.deleted ? 1 : 0, rev);
        changed += 1;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      rev = Number(stmt.maxRev.get().rev);
      throw err;
    }
    if (changed) broadcast();
    return changed;
  }

  function changesSince(since) {
    return stmt.since.all(since).map((r) => ({
      collection: r.collection,
      id: r.id,
      data: r.data ? JSON.parse(r.data) : null,
      updated_at: Number(r.updated_at),
      deleted: !!r.deleted,
    }));
  }

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Interner Fehler' });
      else res.end();
    }
  });

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/changes') {
      const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
      // Wurde die Datenbank zurückgesetzt, muss der Client alles neu laden.
      const reset = since > rev;
      return sendJson(res, 200, { rev, reset, changes: changesSince(reset ? 0 : since) });
    }

    if (req.method === 'POST' && url.pathname === '/api/ops') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: 'Ungültiges JSON' });
      }
      const ops = validateOps(body && body.ops);
      if (!ops) return sendJson(res, 400, { error: 'Ungültige Änderungen' });
      const applied = applyOps(ops);
      return sendJson(res, 200, { rev, applied });
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 3000\nevent: rev\ndata: ${rev}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, rev });
    }

    sendJson(res, 404, { error: 'Nicht gefunden' });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(PUBLIC_DIR, '.' + rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        // Der Service Worker kümmert sich ums Caching; der Browser soll immer nachfragen.
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  return {
    server,
    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
    },
  };
}

function validateOps(ops) {
  if (!Array.isArray(ops) || ops.length > 5000) return null;
  const out = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') return null;
    const { collection, id, updated_at, deleted, data } = op;
    if (!COLLECTIONS.has(collection)) return null;
    if (typeof id !== 'string' || !id || id.length > 200) return null;
    if (!Number.isFinite(updated_at)) return null;
    if (!deleted) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      if (JSON.stringify(data).length > MAX_DOC) return null;
    }
    out.push({ collection, id, updated_at: Math.trunc(updated_at), deleted: !!deleted, data: deleted ? null : { ...data, id } });
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// Direkt gestartet (nicht als Modul in Tests importiert)?
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, '..', 'data'));
  const app = createApp({ dataDir });
  app.server.listen(port, host, () => {
    console.log(`👨‍👩‍👧‍👦 Familyplan läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`   Daten: ${dataDir}`);
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
