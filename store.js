// Entries live in localStorage so the app opens instantly and works offline.
// When Supabase is configured, every change is also queued in an outbox and
// pushed to the `entries` table once signed in; on pull, the server copy wins
// (with still-unsent local changes laid on top).
//
// Entry shape: { id, date: 'YYYY-MM-DD', hours, note, createdAt }

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const ENTRIES_KEY = 'hourlog.entries.v1';
const OUTBOX_KEY = 'hourlog.outbox.v1';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const PAGE = 1000; // PostgREST's default row cap per request
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Fires 'entries' (detail: the new list) when a pull changes data, and 'status'.
export const events = new EventTarget();

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked; the in-memory list still renders.
  }
}

const readEntries = () => {
  const list = readJson(ENTRIES_KEY, []);
  return Array.isArray(list) ? list : [];
};
const writeEntries = (list) => {
  writeJson(ENTRIES_KEY, list);
  return list;
};
const readOutbox = () => readJson(OUTBOX_KEY, []);

function enqueue(ops) {
  if (!configured || !ops.length) return;
  const stamped = ops.map((op) => ({ opId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, ...op }));
  writeJson(OUTBOX_KEY, [...readOutbox(), ...stamped]);
  sync();
}

export const store = {
  async list() {
    return readEntries();
  },
  async add(entry) {
    const list = writeEntries([...readEntries(), entry]);
    enqueue([{ type: 'upsert', entry }]);
    return list;
  },
  async remove(id) {
    const list = writeEntries(readEntries().filter((e) => e.id !== id));
    enqueue([{ type: 'delete', id }]);
    return list;
  },
  async merge(incoming) {
    const byId = new Map(readEntries().map((e) => [e.id, e]));
    for (const e of incoming) byId.set(e.id, e);
    const list = writeEntries([...byId.values()]);
    enqueue(incoming.map((entry) => ({ type: 'upsert', entry })));
    return list;
  },
};

// ---- Sync ----------------------------------------------------------------

let client = null;
let user = null;
let status = configured ? 'offline' : 'local';
let running = null;
let rerun = false;

function setStatus(next) {
  status = next;
  events.dispatchEvent(new Event('status'));
}

const toRow = (e) => ({
  user_id: user.id,
  id: e.id,
  date: e.date,
  hours: e.hours,
  note: e.note || '',
  created_at: e.createdAt,
});
const fromRow = (r) => ({
  id: r.id,
  date: r.date,
  hours: Number(r.hours),
  note: r.note,
  createdAt: Number(r.created_at),
});

async function flush() {
  for (let box = readOutbox(); box.length; box = readOutbox()) {
    const op = box[0];
    const { error } = op.type === 'upsert'
      ? await client.from('entries').upsert(toRow(op.entry), { onConflict: 'user_id,id' })
      : await client.from('entries').delete().eq('id', op.id);
    if (error) {
      // Postgres data errors (classes 22/23) will never succeed; drop the op so it
      // can't block the queue. Anything else (network, auth) is retried later.
      if (!/^2[23]/.test(error.code || '')) throw error;
      console.warn('Server rejected a change; dropping it', op, error);
    }
    writeJson(OUTBOX_KEY, readOutbox().filter((o) => o.opId !== op.opId));
  }
}

async function pull() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('entries')
      .select('id, date, hours, note, created_at')
      .order('created_at')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  let list = rows.map(fromRow);
  for (const op of readOutbox()) {
    list = list.filter((e) => e.id !== (op.type === 'upsert' ? op.entry.id : op.id));
    if (op.type === 'upsert') list.push(op.entry);
  }
  writeEntries(list);
  events.dispatchEvent(new CustomEvent('entries', { detail: list }));
}

export function sync() {
  if (!client || !user) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    setStatus('syncing');
    try {
      await flush();
      await pull();
      setStatus(readOutbox().length ? 'pending' : 'synced');
    } catch (err) {
      console.warn('Sync failed', err);
      setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      running = null;
      if (rerun) {
        rerun = false;
        sync();
      }
    }
  })();
  return running;
}

export const account = {
  configured,
  status: () => status,
  user: () => user,
  pending: () => readOutbox().length,

  async init() {
    if (!configured) return setStatus('local');
    try {
      const { createClient } = await import(SUPABASE_JS);
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    } catch (err) {
      // Offline on a launch before the library was ever cached. Local logging still works.
      console.warn('Could not load Supabase', err);
      return setStatus('offline');
    }
    const { data } = await client.auth.getSession();
    user = data.session?.user ?? null;
    client.auth.onAuthStateChange((_event, session) => {
      user = session?.user ?? null;
      if (!user) setStatus('signed-out');
    });
    window.addEventListener('online', () => sync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync();
    });
    if (user) sync();
    else setStatus('signed-out');
  },

  // Returns an error message, or null on success.
  async sendCode(email) {
    if (!client) return 'Sync is unavailable right now. Check your connection.';
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    return error ? error.message : null;
  },

  async verifyCode(email, token) {
    if (!client) return 'Sync is unavailable right now. Check your connection.';
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return error.message;
    user = data.user;
    // Upload whatever was logged on this device before signing in (upserts are idempotent).
    enqueue(readEntries().map((entry) => ({ type: 'upsert', entry })));
    sync();
    return null;
  },

  async signOut() {
    if (!client) return 'Sync is unavailable right now. Check your connection.';
    await sync();
    if (readOutbox().length) return 'Some changes haven’t synced yet. Try again when you’re online.';
    await client.auth.signOut();
    user = null;
    writeEntries([]);
    events.dispatchEvent(new CustomEvent('entries', { detail: [] }));
    setStatus('signed-out');
    return null;
  },
};
