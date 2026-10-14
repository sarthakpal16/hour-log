import { store, events, account, sync } from './store.js';

const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (h) => `${round2(h)}h`;
const level = (h) => (h <= 0 ? 0 : h < 1 ? 1 : h < 2 ? 2 : h < 4 ? 3 : 4);
// randomUUID only exists in secure contexts (https/localhost).
const newId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

let entries = [];
let todayKey = keyOf(startOfToday());
let selected = todayKey;

function totalsByDay() {
  const totals = new Map();
  for (const e of entries) totals.set(e.date, (totals.get(e.date) || 0) + e.hours);
  return totals;
}

// Date keys are YYYY-MM-DD, so string comparison is date comparison.
function sumBetween(from, to) {
  return entries.reduce((sum, e) => (e.date >= from && e.date <= to ? sum + e.hours : sum), 0);
}

// A streak survives until the end of today, so start from yesterday if today is empty.
function currentStreak(totals) {
  let d = startOfToday();
  if (!totals.get(keyOf(d))) d = addDays(d, -1);
  let n = 0;
  while (totals.get(keyOf(d)) > 0) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function render() {
  const totals = totalsByDay();
  renderStats(totals);
  renderHeatmap(totals);
  renderDay(totals);
}

function renderStats(totals) {
  const now = startOfToday();
  $('stat-today').textContent = fmt(totals.get(todayKey) || 0);
  $('stat-week').textContent = fmt(sumBetween(keyOf(addDays(now, -now.getDay())), todayKey));
  $('stat-month').textContent = fmt(sumBetween(keyOf(new Date(now.getFullYear(), now.getMonth(), 1)), todayKey));
  $('stat-streak').textContent = String(currentStreak(totals));
}

function renderHeatmap(totals) {
  const now = startOfToday();
  const end = addDays(now, 6 - now.getDay()); // Saturday of this week
  const start = addDays(end, -(WEEKS * 7 - 1)); // a Sunday, 53 weeks back

  // Label a column with the month its Saturday falls in, when that month changes.
  // Skip the first column's label if the next change is too close to fit.
  const weekMonth = Array.from({ length: WEEKS }, (_, w) => addDays(start, w * 7 + 6).getMonth());
  let months = '';
  for (let w = 0; w < WEEKS; w++) {
    const show = w === 0
      ? weekMonth[1] === weekMonth[0] && weekMonth[2] === weekMonth[0]
      : weekMonth[w] !== weekMonth[w - 1];
    if (show) months += `<span style="grid-column:${w + 1}">${MONTHS[weekMonth[w]]}</span>`;
  }

  let cells = '';
  let total = 0;
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    if (d > now) {
      cells += '<span class="cell future" aria-hidden="true"></span>';
      continue;
    }
    const k = keyOf(d);
    const h = totals.get(k) || 0;
    total += h;
    const label = `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}: ${fmt(h)}`;
    cells += `<button type="button" class="cell l${level(h)}${k === selected ? ' sel' : ''}" data-date="${k}" aria-label="${label}" title="${label}"></button>`;
  }

  $('heatmap').innerHTML = `
    <div class="hm-months" style="--weeks:${WEEKS}">${months}</div>
    <div class="hm-body">
      <div class="hm-days" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
      <div class="hm-grid">${cells}</div>
    </div>`;
  $('year-total').textContent = `${fmt(total)} in the last year`;
}

function renderDay(totals) {
  const d = parseKey(selected);
  const isToday = selected === todayKey;
  const sameYear = d.getFullYear() === startOfToday().getFullYear();
  $('day-title').textContent = isToday
    ? 'Today'
    : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  $('day-sub').textContent = `${fmt(totals.get(selected) || 0)} logged`;
  $('go-today').hidden = isToday;

  const list = $('entries');
  list.replaceChildren();
  const dayEntries = entries.filter((e) => e.date === selected).sort((a, b) => a.createdAt - b.createdAt);
  if (!dayEntries.length) {
    list.append(el('li', 'empty', isToday ? 'Nothing logged yet today.' : 'Nothing logged this day.'));
    return;
  }
  for (const e of dayEntries) {
    const del = el('button', 'del', '×');
    del.type = 'button';
    del.dataset.id = e.id;
    del.setAttribute('aria-label', `Delete ${fmt(e.hours)} entry`);
    const li = el('li');
    li.append(el('span', 'entry-hours', fmt(e.hours)), el('span', 'entry-note', e.note || ''), del);
    list.append(li);
  }
}

function scrollHeatmapToEnd() {
  const s = $('heatmap-scroll');
  s.scrollLeft = s.scrollWidth;
}

async function addHours(hours) {
  if (!(hours > 0)) return toast('Enter a number of hours');
  const dayTotal = totalsByDay().get(selected) || 0;
  if (dayTotal + hours > 24) return toast('That would be more than 24h in one day');
  const entry = { id: newId(), date: selected, hours: round2(hours), note: $('note').value.trim(), createdAt: Date.now() };
  entries = await store.add(entry);
  $('hours').value = '';
  $('note').value = '';
  render();
  toast(`Added ${fmt(entry.hours)}`);
}

async function removeEntry(id) {
  const removed = entries.find((e) => e.id === id);
  if (!removed) return;
  entries = await store.remove(id);
  render();
  toast(`Removed ${fmt(removed.hours)}`, {
    label: 'Undo',
    run: async () => {
      entries = await store.add(removed);
      render();
    },
  });
}

let toastTimer;
function toast(message, action) {
  const t = $('toast');
  t.replaceChildren(el('span', '', message));
  if (action) {
    const b = el('button', 'toast-action', action.label);
    b.type = 'button';
    b.addEventListener('click', () => { hideToast(); action.run(); }, { once: true });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2000);
}
function hideToast() {
  $('toast').hidden = true;
}

function exportJson() {
  const data = { app: 'hour-log', version: 1, exportedAt: new Date().toISOString(), entries };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `hour-log-${todayKey}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isValidEntry = (e) =>
  e && typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
  typeof e.hours === 'number' && e.hours > 0 && e.hours <= 24;

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = (Array.isArray(data) ? data : data.entries || [])
      .filter(isValidEntry)
      .map((e) => ({ id: e.id, date: e.date, hours: e.hours, note: String(e.note || ''), createdAt: Number(e.createdAt) || 0 }));
    entries = await store.merge(list);
    render();
    toast(`Imported ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`);
  } catch {
    toast("Couldn't read that file");
  }
}

$('heatmap').addEventListener('click', (ev) => {
  const cell = ev.target.closest('[data-date]');
  if (!cell) return;
  selected = cell.dataset.date;
  render();
});
$('go-today').addEventListener('click', () => {
  selected = todayKey;
  render();
  scrollHeatmapToEnd();
});
document.querySelector('.quick').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-add]');
  if (b) addHours(Number(b.dataset.add));
});
$('add-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  addHours(Number($('hours').value));
});
$('entries').addEventListener('click', (ev) => {
  const b = ev.target.closest('.del');
  if (b) removeEntry(b.dataset.id);
});
$('export').addEventListener('click', exportJson);
$('import').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (file) importJson(file);
});

// ---- Sync account ----

const STATUS_TEXT = {
  local: 'Not set up',
  'signed-out': 'Off',
  syncing: 'Syncing…',
  synced: 'Synced',
  pending: 'Changes waiting',
  offline: 'Offline',
  error: 'Sync error',
};

function renderAccount() {
  const status = account.status();
  const user = account.user();
  $('sync-status').textContent = STATUS_TEXT[status];
  $('sync-status').dataset.state = status;
  $('not-configured').hidden = account.configured;
  $('signed-out').hidden = !account.configured || !!user;
  $('signed-in').hidden = !user;
  if (user) {
    $('who').textContent = user.email;
    const pending = account.pending();
    $('sync-detail').textContent = pending
      ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to upload.`
      : 'Everything on this device is backed up.';
  }
}

// Disable a form's button while its request runs, so a slow network can't double-submit.
async function withBusy(button, task) {
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.disabled = false;
  }
}

let pendingEmail = '';
$('email-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('email').value.trim();
  const error = await withBusy(ev.submitter, () => account.sendCode(email));
  if (error) return toast(error);
  pendingEmail = email;
  $('code-form').hidden = false;
  $('code').focus();
  toast('Check your email for a code');
});
$('code-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const error = await withBusy(ev.submitter, () => account.verifyCode(pendingEmail, $('code').value.trim()));
  if (error) return toast(error);
  $('code').value = '';
  $('code-form').hidden = true;
  renderAccount();
  toast('Signed in');
});
$('sync-now').addEventListener('click', (ev) => withBusy(ev.currentTarget, sync));
$('sign-out').addEventListener('click', async (ev) => {
  const error = await withBusy(ev.currentTarget, () => account.signOut());
  toast(error || 'Signed out');
});

events.addEventListener('entries', (ev) => {
  entries = ev.detail;
  render();
});
events.addEventListener('status', renderAccount);

// The app can sit open in the background past midnight; roll "today" forward on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const k = keyOf(startOfToday());
  if (k === todayKey) return;
  if (selected === todayKey) selected = k;
  todayKey = k;
  render();
  scrollHeatmapToEnd();
});

entries = await store.list();
render();
scrollHeatmapToEnd();
renderAccount();
account.init();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
