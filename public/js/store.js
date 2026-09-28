// Lokaler Datenspeicher mit Offline-Warteschlange.
// Änderungen werden sofort lokal gespeichert und angezeigt, dann an den Server
// geschickt. Ohne Netz bleiben sie in der Warteschlange, bis wieder Verbindung besteht.

const LS_DOCS = 'familyplan.docs.v1';
const LS_REV = 'familyplan.rev.v1';
const LS_QUEUE = 'familyplan.queue.v1';

const COLLECTIONS = ['members', 'events', 'tasks', 'completions', 'shopping', 'meals'];

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher voll oder gesperrt – die App läuft trotzdem weiter.
  }
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

class Store extends EventTarget {
  constructor() {
    super();
    // docs[collection][id] = { data, updated_at, deleted }
    this.docs = load(LS_DOCS, {});
    for (const c of COLLECTIONS) this.docs[c] ||= {};
    this.rev = load(LS_REV, 0);
    this.queue = load(LS_QUEUE, []);
    this.online = false;
    this.syncing = false;
    this.lastTs = 0;
    this._pullAgain = false;
  }

  // Streng steigender Zeitstempel, damit schnelle Änderungen hintereinander nie gleich alt sind.
  now() {
    this.lastTs = Math.max(Date.now(), this.lastTs + 1);
    return this.lastTs;
  }

  all(collection) {
    return Object.values(this.docs[collection])
      .filter((d) => !d.deleted)
      .map((d) => d.data);
  }

  get(collection, id) {
    const d = this.docs[collection][id];
    return d && !d.deleted ? d.data : null;
  }

  put(collection, data) {
    const id = data.id || uid();
    const doc = { ...data, id };
    this._local({ collection, id, data: doc, updated_at: this.now(), deleted: false });
    return doc;
  }

  remove(collection, id) {
    if (!this.docs[collection][id]) return;
    this._local({ collection, id, data: null, updated_at: this.now(), deleted: true });
  }

  // Mehrere Änderungen auf einmal (nur ein Neuzeichnen).
  batch(fn) {
    this._batching = true;
    try {
      fn();
    } finally {
      this._batching = false;
      this._persist();
      this._emit();
      this.flush();
    }
  }

  _local(op) {
    this.docs[op.collection][op.id] = { data: op.data, updated_at: op.updated_at, deleted: op.deleted };
    this.queue.push(op);
    if (this._batching) return;
    this._persist();
    this._emit();
    this.flush();
  }

  _persist() {
    save(LS_DOCS, this.docs);
    save(LS_QUEUE, this.queue);
    save(LS_REV, this.rev);
  }

  _emit() {
    this.dispatchEvent(new Event('change'));
  }

  _status(online) {
    this.online = online;
    this.dispatchEvent(new Event('status'));
  }

  async flush() {
    if (this.syncing) {
      this._pullAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this._pullAgain = false;
        if (this.queue.length) {
          const sending = this.queue.slice(0, 500);
          const res = await fetch('/api/ops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ops: sending }),
          });
          if (res.status === 400) {
            // Vom Server abgelehnt – verwerfen statt ewig zu wiederholen.
            console.warn('Änderungen vom Server abgelehnt', await res.text());
          } else if (!res.ok) {
            throw new Error('HTTP ' + res.status);
          }
          this.queue.splice(0, sending.length);
          this._persist();
          if (this.queue.length) this._pullAgain = true;
        }
        await this._pull();
      } while (this._pullAgain);
      this._status(true);
    } catch (err) {
      this._status(false);
    } finally {
      this.syncing = false;
      this.dispatchEvent(new Event('status'));
    }
  }

  async _pull() {
    const res = await fetch('/api/changes?since=' + this.rev, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { rev, reset, changes } = await res.json();
    if (reset) {
      // Server wurde neu aufgesetzt: lokale, noch nicht gesendete Änderungen behalten.
      for (const c of COLLECTIONS) this.docs[c] = {};
      for (const op of this.queue) {
        this.docs[op.collection][op.id] = { data: op.data, updated_at: op.updated_at, deleted: op.deleted };
      }
    }
    let changed = reset;
    for (const ch of changes) {
      if (!this.docs[ch.collection]) continue;
      const local = this.docs[ch.collection][ch.id];
      if (local && local.updated_at > ch.updated_at) continue;
      this.docs[ch.collection][ch.id] = { data: ch.data, updated_at: ch.updated_at, deleted: ch.deleted };
      changed = true;
    }
    this.rev = rev;
    this._persist();
    if (changed) this._emit();
  }

  connect() {
    this.flush();
    if ('EventSource' in window) {
      const es = new EventSource('/api/stream');
      es.addEventListener('rev', (e) => {
        if (Number(e.data) !== this.rev || this.queue.length) this.flush();
        else this._status(true);
      });
      es.onerror = () => this._status(false);
    }
    window.addEventListener('online', () => this.flush());
    window.addEventListener('offline', () => this._status(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.flush();
    });
    // Sicherheitsnetz, falls ein Ereignis verloren geht.
    setInterval(() => this.flush(), 60000);
  }
}

export const store = new Store();
