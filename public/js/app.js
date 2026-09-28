import { store, uid } from './store.js';
import {
  today, addDays, startOfWeek, fromKey, toKey, formatLong, formatShort, relativeLabel,
  occursOn, describeRepeat, nextOccurrence, WEEKDAYS_SHORT, WEEKDAYS_LONG, MONTHS, weekdayOf,
} from './dates.js';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const COLORS = ['#ff6b6b', '#ffa94d', '#fcc419', '#51cf66', '#20c997', '#4dabf7',
  '#748ffc', '#cc5de8', '#f06595', '#a9744f'];
const AVATARS = ['🦁', '🐯', '🐻', '🐼', '🐨', '🐸', '🦊', '🐰', '🐱', '🐶', '🦄', '🐲',
  '🐙', '🦋', '🐝', '🐢', '🦖', '🐧', '🚀', '⚽', '🌸', '🌈', '⭐', '👑'];
const TASK_EMOJIS = ['🧹', '🍽️', '🛏️', '🧺', '🗑️', '🐕', '🌱', '🧸', '🚿', '📚', '🦷', '🧽',
  '🛒', '👕', '🪴', '🐈'];
const EVENT_EMOJIS = ['📅', '⚽', '🎂', '🏥', '🦷', '🎹', '🏊', '🎒', '✈️', '🎉', '🍕', '🎨'];
const MEAL_EMOJIS = ['🍝', '🍕', '🥗', '🍲', '🍔', '🌮', '🍛', '🥞', '🐟', '🍗', '🥪', '🍜'];
const MEAL_SLOTS = [
  { id: 'lunch', label: 'Mittag', icon: '☀️' },
  { id: 'dinner', label: 'Abend', icon: '🌙' },
];
const POINT_CHOICES = [1, 2, 3, 5, 10];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// ---------------------------------------------------------------------------
// UI-Zustand (nur auf diesem Gerät)
// ---------------------------------------------------------------------------

const ui = {
  view: pref('view', 'home'),
  calMonth: today().slice(0, 7),
  calDay: today(),
  mealWeek: startOfWeek(today()),
  taskFilter: pref('taskFilter', 'all'),
};

function pref(key, fallback) {
  try {
    return localStorage.getItem('familyplan.ui.' + key) || fallback;
  } catch {
    return fallback;
  }
}
function setPref(key, value) {
  ui[key] = value;
  try {
    localStorage.setItem('familyplan.ui.' + key, value);
  } catch { /* egal */ }
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function members() {
  return store.all('members').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}
function member(id) {
  return id ? store.get('members', id) : null;
}

function avatar(m, size = '') {
  if (!m) return `<span class="avatar ${size} avatar-all" title="Alle">👪</span>`;
  return `<span class="avatar ${size}" style="--c:${esc(m.color)}" title="${esc(m.name)}">${esc(m.avatar || '🙂')}</span>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Hallo';
  return 'Guten Abend';
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bits = ['⭐', '🎉', '✨', '🌟', '💫', '🎊'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = bits[i % bits.length];
    s.style.left = 10 + Math.random() * 80 + 'vw';
    s.style.animationDelay = Math.random() * 0.3 + 's';
    s.style.fontSize = 18 + Math.random() * 22 + 'px';
    document.body.append(s);
    setTimeout(() => s.remove(), 1800);
  }
}

// ---------------------------------------------------------------------------
// Fachlogik: Ämtli & Punkte
// ---------------------------------------------------------------------------

function completionId(task, occ) {
  return `${task.id}__${occ}`;
}
function completionFor(task, occ) {
  return store.get('completions', completionId(task, occ));
}

// Alle Ämtli, die an `key` erledigt werden sollen (inkl. überfällige Einmal-Ämtli, wenn key = heute).
function tasksForDay(key, filter = 'all') {
  const isToday = key === today();
  const list = [];
  for (const t of store.all('tasks')) {
    if (filter !== 'all' && t.assignee && t.assignee !== filter) continue;
    if (occursOn(t, key)) list.push({ task: t, occ: key });
    else if (isToday && (t.repeat || 'none') === 'none' && t.date && t.date < key && !completionFor(t, t.date)) {
      list.push({ task: t, occ: t.date, overdue: true });
    }
  }
  return list.sort((a, b) => Number(!!completionFor(a.task, a.occ)) - Number(!!completionFor(b.task, b.occ))
    || (a.task.title || '').localeCompare(b.task.title || ''));
}

function anytimeTasks(filter = 'all') {
  return store.all('tasks')
    .filter((t) => !t.date)
    .filter((t) => filter === 'all' || t.assignee === filter || !t.assignee)
    .map((t) => ({ task: t, occ: 'once' }));
}

function pointsFor(memberId, fromKey = null) {
  let sum = 0;
  for (const c of store.all('completions')) {
    if (c.memberId !== memberId) continue;
    if (fromKey && c.day < fromKey) continue;
    sum += Number(c.points) || 0;
  }
  return sum;
}

function leaderboard() {
  const week = startOfWeek(today());
  return members()
    .filter((m) => m.collectsPoints !== false)
    .map((m) => ({ m, week: pointsFor(m.id, week), total: pointsFor(m.id) }))
    .sort((a, b) => b.week - a.week || b.total - a.total);
}

function eventsOn(key) {
  return store.all('events')
    .filter((e) => occursOn(e, key))
    .sort((a, b) => (a.allDay ? '' : a.time || '').localeCompare(b.allDay ? '' : b.time || '')
      || (a.title || '').localeCompare(b.title || ''));
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function taskRow({ task, occ, overdue }) {
  const done = completionFor(task, occ);
  const who = done ? member(done.memberId) : null;
  const assignee = member(task.assignee);
  let sub = '';
  if (done) sub = `Erledigt${who ? ' von ' + esc(who.name) : ''} 🎉`;
  else if (overdue) sub = `<span class="warn">Überfällig seit ${esc(relativeLabel(occ))}</span>`;
  else sub = esc(assignee ? assignee.name : 'Alle');
  return `
    <li class="task ${done ? 'done' : ''}">
      <button type="button" class="task-main" data-action="edit-task" data-id="${esc(task.id)}">
        <span class="task-emoji" aria-hidden="true">${esc(task.emoji || '✅')}</span>
        <span class="task-text">
          <strong>${esc(task.title)}</strong>
          <small>${sub} · <span class="points" title="Punkte">⭐ ${Number(task.points) || 0}</span></small>
        </span>
      </button>
      ${done && who ? avatar(who, 'sm') : avatar(assignee, 'sm')}
      <button type="button" class="check ${done ? 'checked' : ''}" data-action="toggle-task"
        data-id="${esc(task.id)}" data-occ="${esc(occ)}" aria-label="${done ? 'Wieder öffnen' : 'Erledigt'}: ${esc(task.title)}">
        ${done ? '✔' : ''}
      </button>
    </li>`;
}

function eventRow(e, key) {
  const who = (e.members || []).map(member).filter(Boolean);
  const time = e.allDay || !e.time ? 'Ganztags' : e.time + (e.endTime ? '–' + e.endTime : '');
  const color = who[0]?.color || 'var(--muted)';
  return `
    <li>
      <button type="button" class="event" style="--c:${esc(color)}" data-action="edit-event" data-id="${esc(e.id)}" data-day="${esc(key)}">
        <span class="event-emoji" aria-hidden="true">${esc(e.emoji || '📅')}</span>
        <span class="event-text">
          <strong>${esc(e.title)}</strong>
          <small>${esc(time)}${e.repeat && e.repeat !== 'none' ? ' · 🔁 ' + esc(describeRepeat(e)) : ''}${e.note ? ' · ' + esc(e.note) : ''}</small>
        </span>
        <span class="avatars">${who.map((m) => avatar(m, 'sm')).join('') || avatar(null, 'sm')}</span>
      </button>
    </li>`;
}

function emptyState(icon, text, action = '') {
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">${icon}</div><p>${text}</p>${action}</div>`;
}

function leaderboardHtml(compact = false) {
  const rows = leaderboard();
  if (!rows.length) return emptyState('🏆', 'Noch niemand sammelt Punkte.');
  const max = Math.max(1, ...rows.map((r) => r.week));
  const medals = ['🥇', '🥈', '🥉'];
  return `<ol class="leaderboard">${rows.map((r, i) => `
    <li>
      <span class="medal" aria-hidden="true">${r.week > 0 ? medals[i] || '' : ''}</span>
      ${avatar(r.m)}
      <span class="lb-main">
        <strong>${esc(r.m.name)}</strong>
        <span class="bar"><span style="width:${(r.week / max) * 100}%;--c:${esc(r.m.color)}"></span></span>
      </span>
      <span class="lb-points"><strong>⭐ ${r.week}</strong>${compact ? '' : `<small>gesamt ${r.total}</small>`}</span>
    </li>`).join('')}</ol>`;
}

// ---------------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------------

const views = {
  home() {
    const key = today();
    const ms = members();
    const events = eventsOn(key);
    const tomorrow = eventsOn(addDays(key, 1));
    const tasks = [...tasksForDay(key), ...anytimeTasks().filter((x) => !completionFor(x.task, x.occ))];
    const open = tasks.filter((x) => !completionFor(x.task, x.occ)).length;
    const meals = MEAL_SLOTS.map((s) => ({ s, meal: store.get('meals', `${key}_${s.id}`) })).filter((x) => x.meal);
    const shoppingOpen = store.all('shopping').filter((i) => !i.checked).length;

    return `
      <section class="hero">
        <h1>${greeting()}! ${ms.length ? ms.map((m) => esc(m.avatar)).join('') : '👋'}</h1>
        <p>${esc(formatLong(key))}</p>
        <div class="stats">
          <button type="button" data-goto="tasks"><strong>${open}</strong><span>Ämtli offen</span></button>
          <button type="button" data-goto="calendar"><strong>${events.length}</strong><span>Termine heute</span></button>
          <button type="button" data-goto="shopping"><strong>${shoppingOpen}</strong><span>auf der Liste</span></button>
        </div>
      </section>

      ${ms.length ? '' : `
        <section class="card onboarding">
          <h2>👋 Willkommen!</h2>
          <p>Leg zuerst an, wer zur Familie gehört. Jede Person bekommt ein Tier und eine Farbe.</p>
          <button type="button" class="btn primary big" data-action="new-member">➕ Familienmitglied hinzufügen</button>
        </section>`}

      <section class="card">
        <div class="card-head"><h2>📅 Heute</h2><button type="button" class="btn small" data-action="new-event" data-day="${key}">➕ Termin</button></div>
        ${events.length ? `<ul class="list">${events.map((e) => eventRow(e, key)).join('')}</ul>` : emptyState('🌤️', 'Heute keine Termine.')}
        ${tomorrow.length ? `<h3>Morgen</h3><ul class="list">${tomorrow.map((e) => eventRow(e, addDays(key, 1))).join('')}</ul>` : ''}
      </section>

      <section class="card">
        <div class="card-head"><h2>✅ Ämtli</h2><button type="button" class="btn small" data-action="new-task">➕ Ämtli</button></div>
        ${tasks.length ? `<ul class="list">${tasks.map(taskRow).join('')}</ul>` : emptyState('🧹', 'Heute gibt es keine Ämtli. Juhu!')}
      </section>

      <section class="card">
        <div class="card-head"><h2>🍽️ Heute essen wir</h2><button type="button" class="btn small" data-goto="meals">Essensplan</button></div>
        ${meals.length ? `<ul class="meal-today">${meals.map(({ s, meal }) => `
          <li><button type="button" data-action="edit-meal" data-day="${key}" data-slot="${s.id}">
            <span class="meal-emoji">${esc(meal.emoji || '🍽️')}</span>
            <span><small>${s.icon} ${s.label}</small><strong>${esc(meal.name)}</strong></span>
          </button></li>`).join('')}</ul>` : emptyState('🤔', 'Noch nichts geplant.')}
      </section>

      <section class="card">
        <div class="card-head"><h2>🏆 Punkte diese Woche</h2></div>
        ${leaderboardHtml(true)}
      </section>`;
  },

  calendar() {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const first = toKey(new Date(y, m - 1, 1));
    const gridStart = startOfWeek(first);
    const todayKey = today();
    const events = store.all('events');
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const key = addDays(gridStart, i);
      if (i === 35 && key.slice(0, 7) !== ui.calMonth) break;
      const dayEvents = events.filter((e) => occursOn(e, key));
      const dots = dayEvents.slice(0, 4).map((e) => {
        const c = member((e.members || [])[0])?.color || 'var(--muted)';
        return `<i style="--c:${esc(c)}"></i>`;
      }).join('');
      const cls = [
        'day',
        key.slice(0, 7) !== ui.calMonth ? 'other' : '',
        key === todayKey ? 'today' : '',
        key === ui.calDay ? 'selected' : '',
      ].join(' ');
      cells += `<button type="button" class="${cls}" data-action="pick-day" data-day="${key}"
        aria-label="${esc(formatLong(key))}, ${dayEvents.length} Termine">
        <span>${fromKey(key).getDate()}</span><span class="dots">${dots}</span></button>`;
    }
    const dayEvents = eventsOn(ui.calDay);
    const dayTasks = tasksForDay(ui.calDay);
    return `
      <section class="card">
        <div class="month-nav">
          <button type="button" class="btn round" data-action="month" data-delta="-1" aria-label="Voriger Monat">‹</button>
          <h1>${MONTHS[m - 1]} ${y}</h1>
          <button type="button" class="btn round" data-action="month" data-delta="1" aria-label="Nächster Monat">›</button>
        </div>
        <div class="weekdays">${WEEK_ORDER.map((d) => `<span>${WEEKDAYS_SHORT[d]}</span>`).join('')}</div>
        <div class="month">${cells}</div>
        <div class="row center"><button type="button" class="btn small" data-action="cal-today">Heute</button></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${esc(formatLong(ui.calDay))}</h2>
          <button type="button" class="btn small primary" data-action="new-event" data-day="${ui.calDay}">➕ Termin</button></div>
        ${dayEvents.length ? `<ul class="list">${dayEvents.map((e) => eventRow(e, ui.calDay)).join('')}</ul>` : emptyState('🌤️', 'Keine Termine an diesem Tag.')}
        ${dayTasks.length ? `<h3>Ämtli</h3><ul class="list">${dayTasks.map(taskRow).join('')}</ul>` : ''}
      </section>`;
  },

  tasks() {
    const ms = members();
    const filter = ui.taskFilter !== 'all' && !member(ui.taskFilter) ? 'all' : ui.taskFilter;
    const todayTasks = tasksForDay(today(), filter);
    const anytime = anytimeTasks(filter);
    const all = store.all('tasks')
      .filter((t) => filter === 'all' || t.assignee === filter || !t.assignee)
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return `
      <section class="card">
        <div class="card-head"><h1>✅ Ämtli</h1><button type="button" class="btn primary" data-action="new-task">➕ Neues Ämtli</button></div>
        <div class="chips" role="group" aria-label="Filter nach Person">
          <button type="button" class="chip ${filter === 'all' ? 'active' : ''}" data-action="task-filter" data-id="all">👪 Alle</button>
          ${ms.map((m) => `<button type="button" class="chip ${filter === m.id ? 'active' : ''}" style="--c:${esc(m.color)}"
            data-action="task-filter" data-id="${esc(m.id)}">${esc(m.avatar)} ${esc(m.name)}</button>`).join('')}
        </div>
      </section>
      <section class="card">
        <h2>Heute</h2>
        ${todayTasks.length ? `<ul class="list">${todayTasks.map(taskRow).join('')}</ul>` : emptyState('😎', 'Heute nichts zu tun.')}
      </section>
      ${anytime.length ? `<section class="card"><h2>Irgendwann</h2><ul class="list">${anytime.map(taskRow).join('')}</ul></section>` : ''}
      <section class="card">
        <h2>Alle Ämtli</h2>
        ${all.length ? `<ul class="list">${all.map((t) => {
          const next = t.date ? nextOccurrence(t) : null;
          return `<li><button type="button" class="event" style="--c:${esc(member(t.assignee)?.color || 'var(--muted)')}" data-action="edit-task" data-id="${esc(t.id)}">
            <span class="event-emoji">${esc(t.emoji || '✅')}</span>
            <span class="event-text"><strong>${esc(t.title)}</strong>
              <small>🔁 ${esc(t.date ? describeRepeat(t) : 'Ohne Datum')}${next ? ' · nächstes Mal: ' + esc(relativeLabel(next)) : ''} · ⭐ ${Number(t.points) || 0}</small></span>
            ${avatar(member(t.assignee), 'sm')}
          </button></li>`;
        }).join('')}</ul>` : emptyState('🧹', 'Noch keine Ämtli angelegt.', '<button type="button" class="btn primary" data-action="new-task">➕ Erstes Ämtli anlegen</button>')}
      </section>`;
  },

  shopping() {
    const items = store.all('shopping').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const open = items.filter((i) => !i.checked);
    const done = items.filter((i) => i.checked);
    const row = (i) => `
      <li class="shop-item ${i.checked ? 'done' : ''}">
        <button type="button" class="check ${i.checked ? 'checked' : ''}" data-action="toggle-item" data-id="${esc(i.id)}"
          aria-label="${esc(i.name)} ${i.checked ? 'wieder auf die Liste' : 'abhaken'}">${i.checked ? '✔' : ''}</button>
        <button type="button" class="shop-name" data-action="toggle-item" data-id="${esc(i.id)}">
          <strong>${esc(i.name)}</strong>${i.source ? `<small>für ${esc(i.source)}</small>` : ''}
        </button>
        <button type="button" class="icon-btn" data-action="delete-item" data-id="${esc(i.id)}" aria-label="${esc(i.name)} löschen">🗑️</button>
      </li>`;
    return `
      <section class="card">
        <h1>🛒 Einkaufsliste</h1>
        <form class="add-row" data-form="add-item">
          <input id="shop-input" name="name" placeholder="z. B. 2 l Milch" autocomplete="off" required maxlength="120">
          <button class="btn primary" type="submit" aria-label="Hinzufügen">➕</button>
        </form>
        ${open.length ? `<ul class="list">${open.map(row).join('')}</ul>` : emptyState('🎉', 'Alles eingekauft!')}
      </section>
      ${done.length ? `
        <section class="card">
          <div class="card-head"><h2>Im Wagen 🛒</h2>
            <button type="button" class="btn small" data-action="clear-checked">🧹 Entfernen</button></div>
          <ul class="list">${done.map(row).join('')}</ul>
        </section>` : ''}`;
  },

  meals() {
    const start = ui.mealWeek;
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const todayKey = today();
    const kw = isoWeek(start);
    return `
      <section class="card">
        <div class="month-nav">
          <button type="button" class="btn round" data-action="week" data-delta="-7" aria-label="Vorige Woche">‹</button>
          <h1>🍽️ Woche ${kw}</h1>
          <button type="button" class="btn round" data-action="week" data-delta="7" aria-label="Nächste Woche">›</button>
        </div>
        <p class="muted center">${esc(formatShort(days[0]))} – ${esc(formatShort(days[6]))}</p>
        <div class="row center">
          <button type="button" class="btn primary" data-action="week-to-shopping">🛒 Zutaten der Woche auf die Einkaufsliste</button>
        </div>
      </section>
      <section class="meal-week">
        ${days.map((key) => `
          <div class="meal-day ${key === todayKey ? 'today' : ''}">
            <h3>${esc(dayName(key))}<small>${esc(formatShort(key))}</small></h3>
            <div class="meal-slots">
              ${MEAL_SLOTS.map((s) => {
                const meal = store.get('meals', `${key}_${s.id}`);
                return `<button type="button" class="meal-slot ${meal ? 'filled' : ''}" data-action="edit-meal" data-day="${key}" data-slot="${s.id}">
                  <small>${s.icon} ${s.label}</small>
                  ${meal ? `<strong>${esc(meal.emoji || '🍽️')} ${esc(meal.name)}</strong>` : '<span class="plus">➕</span>'}
                </button>`;
              }).join('')}
            </div>
          </div>`).join('')}
      </section>`;
  },

  family() {
    const ms = members();
    return `
      <section class="card">
        <div class="card-head"><h1>🏆 Punkte</h1>
          ${ms.length ? '<button type="button" class="btn small" data-action="bonus">🎁 Bonus / Belohnung</button>' : ''}</div>
        <p class="muted">Diese Woche (ab Montag) – daneben alle Punkte, die noch nicht eingelöst wurden.</p>
        ${leaderboardHtml()}
      </section>
      <section class="card">
        <div class="card-head"><h2>👨‍👩‍👧 Unsere Familie</h2><button type="button" class="btn primary small" data-action="new-member">➕ Person</button></div>
        ${ms.length ? `<ul class="list">${ms.map((m) => `
          <li><button type="button" class="event" style="--c:${esc(m.color)}" data-action="edit-member" data-id="${esc(m.id)}">
            ${avatar(m)}
            <span class="event-text"><strong>${esc(m.name)}</strong>
              <small>${m.role === 'kid' ? 'Kind' : 'Erwachsen'}${m.collectsPoints !== false ? ' · sammelt Punkte ⭐' : ''}</small></span>
            <span class="muted">✏️</span>
          </button></li>`).join('')}</ul>` : emptyState('👪', 'Noch niemand da.', '<button type="button" class="btn primary" data-action="new-member">➕ Erste Person anlegen</button>')}
      </section>
      <section class="card">
        <h2>ℹ️ Über diese App</h2>
        <p class="muted">Alle Änderungen werden automatisch mit allen Geräten geteilt. Ohne Internet wird lokal gespeichert
        und später synchronisiert. Tipp: Über das Browser-Menü „Zum Startbildschirm hinzufügen“ wird Familyplan zur App.</p>
      </section>`;
  },
};

// "Heute"/"Morgen"/"Gestern" oder der ausgeschriebene Wochentag.
function dayName(key) {
  const rel = relativeLabel(key);
  return ['Heute', 'Morgen', 'Gestern'].includes(rel) ? rel : WEEKDAYS_LONG[weekdayOf(key)];
}

function isoWeek(key) {
  const d = fromKey(key);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

// ---------------------------------------------------------------------------
// Rendern
// ---------------------------------------------------------------------------

function render() {
  const main = $('#view');
  // Fokus und Eingaben erhalten, falls von einem anderen Gerät Änderungen kommen.
  const active = document.activeElement;
  const focusId = active && main.contains(active) && active.id ? active.id : null;
  const draft = focusId ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;

  if (!views[ui.view]) ui.view = 'home';
  main.innerHTML = views[ui.view]();
  for (const b of $$('.tabs button')) {
    const on = b.dataset.view === ui.view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      if (draft.value != null) el.value = draft.value;
      el.focus();
      try { el.setSelectionRange(draft.start, draft.end); } catch { /* nicht jedes Feld */ }
    }
  }
}

function go(view) {
  setPref('view', view);
  render();
  window.scrollTo({ top: 0 });
}

function renderStatus() {
  const el = $('#sync-status');
  const pending = store.queue.length;
  if (store.online && !pending) {
    el.textContent = '🟢 Live';
    el.className = 'sync ok';
  } else if (store.online) {
    el.textContent = '🔄 Sync…';
    el.className = 'sync busy';
  } else {
    el.textContent = pending ? `📴 Offline · ${pending}` : '📴 Offline';
    el.className = 'sync off';
  }
  el.title = store.online ? 'Mit allen Geräten verbunden' : 'Offline – Änderungen werden später übertragen';
}

// ---------------------------------------------------------------------------
// Dialoge
// ---------------------------------------------------------------------------

const modal = $('#modal');

function openModal(html, onSubmit, setup) {
  // Unsichtbarer Standard-Button: Enter in einem Eingabefeld speichert (statt zu löschen).
  const defaultBtn = html.includes('value="save"')
    ? '<button type="submit" value="save" class="sr-only" tabindex="-1" aria-hidden="true"></button>' : '';
  modal.innerHTML = `<form class="modal-form" novalidate>${defaultBtn}${html}</form>`;
  const form = $('form', modal);
  $('[data-close]', form)?.addEventListener('click', closeModal);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const submitter = e.submitter;
    const action = submitter ? submitter.value : 'save';
    if (action !== 'delete' && action !== 'skip' && !form.reportValidity()) return;
    if (onSubmit(new FormData(form), action, form) !== false) closeModal();
  });
  setup?.(form);
  modal.showModal();
  const first = $('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea', form);
  if (first && matchMedia('(pointer: fine)').matches) first.focus();
}

function closeModal() {
  if (modal.open) modal.close();
}

modal.addEventListener('click', (e) => {
  // Klick auf den Hintergrund schließt den Dialog.
  if (e.target === modal) closeModal();
});

function modalHead(title) {
  return `<div class="modal-head"><h2>${title}</h2>
    <button type="button" data-close class="icon-btn" aria-label="Schließen">✖️</button></div>`;
}

function emojiPicker(name, options, current) {
  const value = current || options[0];
  const opts = options.includes(value) ? options : [value, ...options];
  return `<div class="emoji-grid" role="radiogroup">${opts.map((e) => `
    <label><input type="radio" name="${name}" value="${esc(e)}" ${e === value ? 'checked' : ''}><span>${esc(e)}</span></label>`).join('')}</div>`;
}

function colorPicker(current) {
  const value = current || COLORS[0];
  return `<div class="color-grid" role="radiogroup">${COLORS.map((c) => `
    <label style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === value ? 'checked' : ''} aria-label="Farbe ${c}"><span></span></label>`).join('')}</div>`;
}

function memberPicker(name, selected, { multi = false, allowNone = false } = {}) {
  const ms = members();
  const type = multi ? 'checkbox' : 'radio';
  const sel = new Set(Array.isArray(selected) ? selected : [selected || '']);
  let html = '';
  if (allowNone) {
    html += `<label class="pick"><input type="${type}" name="${name}" value="" ${sel.has('') ? 'checked' : ''}>
      <span>${avatar(null, 'sm')} Alle</span></label>`;
  }
  html += ms.map((m) => `<label class="pick" style="--c:${esc(m.color)}"><input type="${type}" name="${name}" value="${esc(m.id)}" ${sel.has(m.id) ? 'checked' : ''}>
    <span>${avatar(m, 'sm')} ${esc(m.name)}</span></label>`).join('');
  return `<div class="pick-grid">${html || '<p class="muted">Lege unter „Familie“ Personen an.</p>'}</div>`;
}

function repeatFields(item) {
  const repeat = item.repeat || 'none';
  const wd = item.weekdays || [];
  return `
    <label class="field"><span>🔁 Wiederholen</span>
      <select name="repeat">
        ${['none', 'daily', 'weekly', 'monthly', 'yearly'].map((r) => `<option value="${r}" ${r === repeat ? 'selected' : ''}>${
          { none: 'Nein, einmalig', daily: 'Jeden Tag', weekly: 'Jede Woche', monthly: 'Jeden Monat', yearly: 'Jedes Jahr' }[r]}</option>`).join('')}
      </select>
    </label>
    <div class="field weekday-field" ${repeat === 'weekly' ? '' : 'hidden'}>
      <span>An welchen Tagen?</span>
      <div class="weekday-grid">${WEEK_ORDER.map((d) => `<label><input type="checkbox" name="weekdays" value="${d}" ${wd.includes(d) ? 'checked' : ''}><span>${WEEKDAYS_SHORT[d]}</span></label>`).join('')}</div>
    </div>
    <label class="field until-field" ${repeat === 'none' ? 'hidden' : ''}><span>Bis (optional)</span>
      <input type="date" name="until" value="${esc(item.until || '')}"></label>`;
}

function wireRepeat(form) {
  const sel = $('select[name=repeat]', form);
  const update = () => {
    $('.weekday-field', form).hidden = sel.value !== 'weekly';
    $('.until-field', form).hidden = sel.value === 'none';
  };
  sel.addEventListener('change', update);
}

function readRepeat(fd) {
  const repeat = fd.get('repeat') || 'none';
  return {
    repeat,
    weekdays: repeat === 'weekly' ? fd.getAll('weekdays').map(Number) : [],
    until: repeat === 'none' ? '' : fd.get('until') || '',
  };
}

// --- Personen --------------------------------------------------------------

function memberForm(id) {
  const m = id ? member(id) : null;
  const ms = members();
  const d = m || {
    name: '', role: 'kid', collectsPoints: true,
    avatar: AVATARS[ms.length % AVATARS.length], color: COLORS[ms.length % COLORS.length],
  };
  openModal(`
    ${modalHead(m ? 'Person bearbeiten' : 'Neue Person')}
    <label class="field"><span>Name</span><input name="name" required maxlength="40" value="${esc(d.name)}" placeholder="z. B. Lena"></label>
    <div class="field"><span>Tier / Symbol</span>${emojiPicker('avatar', AVATARS, d.avatar)}</div>
    <div class="field"><span>Farbe</span>${colorPicker(d.color)}</div>
    <div class="field"><span>Rolle</span>
      <div class="segmented">
        <label><input type="radio" name="role" value="kid" ${d.role === 'kid' ? 'checked' : ''}><span>🧒 Kind</span></label>
        <label><input type="radio" name="role" value="adult" ${d.role !== 'kid' ? 'checked' : ''}><span>🧑 Erwachsen</span></label>
      </div>
    </div>
    <label class="toggle"><input type="checkbox" name="collectsPoints" ${d.collectsPoints !== false ? 'checked' : ''}><span>⭐ Sammelt Punkte für Ämtli</span></label>
    <div class="modal-actions">
      ${m ? '<button type="submit" value="delete" class="btn danger">🗑️ Löschen</button>' : ''}
      <button type="submit" value="save" class="btn primary big">💾 Speichern</button>
    </div>`,
  (fd, action) => {
    if (action === 'delete') {
      if (!confirm(`${m.name} wirklich löschen? Punkte und Termine bleiben erhalten.`)) return false;
      store.remove('members', m.id);
      toast(`${m.name} wurde entfernt`);
      return;
    }
    store.put('members', {
      ...(m || { order: ms.length, createdAt: Date.now() }),
      name: fd.get('name').trim(),
      avatar: fd.get('avatar'),
      color: fd.get('color'),
      role: fd.get('role'),
      collectsPoints: fd.get('collectsPoints') === 'on',
    });
    toast(m ? 'Gespeichert ✔' : `Willkommen, ${fd.get('name').trim()}! ${fd.get('avatar')}`);
  },
  (form) => {
    // Erwachsene sammeln standardmäßig keine Punkte.
    for (const r of $$('input[name=role]', form)) {
      r.addEventListener('change', () => {
        if (!m) $('input[name=collectsPoints]', form).checked = r.value === 'kid';
      });
    }
  });
}

// --- Termine ---------------------------------------------------------------

function eventForm(id, day) {
  const e = id ? store.get('events', id) : null;
  const d = e || { title: '', date: day || today(), time: '', endTime: '', allDay: false, members: [], repeat: 'none', emoji: '📅' };
  const recurring = e && e.repeat && e.repeat !== 'none';
  openModal(`
    ${modalHead(e ? 'Termin bearbeiten' : 'Neuer Termin')}
    <label class="field"><span>Was?</span><input name="title" required maxlength="80" value="${esc(d.title)}" placeholder="z. B. Fußballtraining"></label>
    <div class="field"><span>Symbol</span>${emojiPicker('emoji', EVENT_EMOJIS, d.emoji)}</div>
    <label class="field"><span>📆 Datum${recurring ? ' (Beginn der Serie)' : ''}</span><input type="date" name="date" required value="${esc(d.date)}"></label>
    <label class="toggle"><input type="checkbox" name="allDay" ${d.allDay ? 'checked' : ''}><span>Ganztags</span></label>
    <div class="row time-fields" ${d.allDay ? 'hidden' : ''}>
      <label class="field"><span>🕐 Von</span><input type="time" name="time" value="${esc(d.time || '')}"></label>
      <label class="field"><span>Bis</span><input type="time" name="endTime" value="${esc(d.endTime || '')}"></label>
    </div>
    <div class="field"><span>Wer?</span>${memberPicker('members', d.members || [], { multi: true })}</div>
    ${repeatFields(d)}
    <label class="field"><span>📝 Notiz</span><input name="note" maxlength="200" value="${esc(d.note || '')}" placeholder="z. B. Sportsachen mitnehmen"></label>
    <div class="modal-actions">
      ${e && recurring && day ? '<button type="submit" value="skip" class="btn danger">Nur diesen Tag löschen</button>' : ''}
      ${e ? `<button type="submit" value="delete" class="btn danger">🗑️ ${recurring ? 'Ganze Serie löschen' : 'Löschen'}</button>` : ''}
      <button type="submit" value="save" class="btn primary big">💾 Speichern</button>
    </div>`,
  (fd, action) => {
    if (action === 'delete') {
      if (!confirm(`„${e.title}“ löschen?`)) return false;
      store.remove('events', e.id);
      toast('Termin gelöscht');
      return;
    }
    if (action === 'skip') {
      store.put('events', { ...e, skip: [...(e.skip || []), day] });
      toast(`„${e.title}“ fällt am ${formatShort(day)} aus`);
      return;
    }
    const allDay = fd.get('allDay') === 'on';
    store.put('events', {
      ...(e || { createdAt: Date.now() }),
      title: fd.get('title').trim(),
      emoji: fd.get('emoji'),
      date: fd.get('date'),
      allDay,
      time: allDay ? '' : fd.get('time') || '',
      endTime: allDay ? '' : fd.get('endTime') || '',
      members: fd.getAll('members'),
      note: (fd.get('note') || '').trim(),
      ...readRepeat(fd),
    });
    ui.calDay = fd.get('date');
    ui.calMonth = ui.calDay.slice(0, 7);
    toast('Termin gespeichert ✔');
  },
  (form) => {
    wireRepeat(form);
    $('input[name=allDay]', form).addEventListener('change', (ev) => {
      $('.time-fields', form).hidden = ev.target.checked;
    });
  });
}

// --- Ämtli -----------------------------------------------------------------

function taskForm(id) {
  const t = id ? store.get('tasks', id) : null;
  const d = t || {
    title: '', emoji: '🧹', points: 2, date: today(), repeat: 'none',
    assignee: ui.taskFilter !== 'all' && member(ui.taskFilter) ? ui.taskFilter : '',
  };
  openModal(`
    ${modalHead(t ? 'Ämtli bearbeiten' : 'Neues Ämtli')}
    <label class="field"><span>Was ist zu tun?</span><input name="title" required maxlength="80" value="${esc(d.title)}" placeholder="z. B. Tisch decken"></label>
    <div class="field"><span>Symbol</span>${emojiPicker('emoji', TASK_EMOJIS, d.emoji)}</div>
    <div class="field"><span>Wer ist dran?</span>${memberPicker('assignee', d.assignee || '', { allowNone: true })}</div>
    <div class="field"><span>⭐ Punkte</span>
      <div class="segmented">${POINT_CHOICES.map((p) => `<label><input type="radio" name="points" value="${p}" ${Number(d.points) === p ? 'checked' : ''}><span>${p}</span></label>`).join('')}</div>
    </div>
    <label class="field"><span>📆 Wann? (leer = irgendwann)</span><input type="date" name="date" value="${esc(d.date || '')}"></label>
    ${repeatFields(d)}
    <div class="modal-actions">
      ${t ? '<button type="submit" value="delete" class="btn danger">🗑️ Löschen</button>' : ''}
      <button type="submit" value="save" class="btn primary big">💾 Speichern</button>
    </div>`,
  (fd, action) => {
    if (action === 'delete') {
      if (!confirm(`Ämtli „${t.title}“ löschen? Bereits verdiente Punkte bleiben.`)) return false;
      store.remove('tasks', t.id);
      toast('Ämtli gelöscht');
      return;
    }
    const rep = readRepeat(fd);
    let date = fd.get('date') || '';
    if (!date && rep.repeat !== 'none') date = today();
    store.put('tasks', {
      ...(t || { createdAt: Date.now() }),
      title: fd.get('title').trim(),
      emoji: fd.get('emoji'),
      assignee: fd.get('assignee') || '',
      points: Number(fd.get('points')) || 1,
      date,
      ...rep,
    });
    toast('Ämtli gespeichert ✔');
  },
  wireRepeat);
}

function toggleTask(taskId, occ) {
  const task = store.get('tasks', taskId);
  if (!task) return;
  const done = completionFor(task, occ);
  if (done) {
    if (!confirm(`„${task.title}“ wieder als offen markieren?`)) return;
    store.remove('completions', done.id);
    return;
  }
  const ms = members();
  const finish = (memberId) => {
    const pts = Number(task.points) || 0;
    const m = member(memberId);
    const earns = m && m.collectsPoints !== false;
    store.put('completions', {
      id: completionId(task, occ),
      kind: 'task',
      taskId: task.id,
      occ,
      day: today(),
      memberId: memberId || '',
      points: earns ? pts : 0,
      title: task.title,
      emoji: task.emoji,
      doneAt: Date.now(),
    });
    celebrate();
    toast(earns && pts ? `Super, ${m.name}! +${pts} ⭐` : 'Erledigt! 🎉');
  };
  if (ms.length <= 1) return finish(ms[0]?.id || '');

  openModal(`
    ${modalHead('Wer hat’s gemacht? 🎉')}
    <p class="muted">${esc(task.emoji || '')} ${esc(task.title)} · ⭐ ${Number(task.points) || 0}</p>
    <div class="who-grid">${ms.map((m) => `
      <button type="submit" value="${esc(m.id)}" class="who ${m.id === task.assignee ? 'suggested' : ''}" style="--c:${esc(m.color)}">
        ${avatar(m, 'lg')}<strong>${esc(m.name)}</strong></button>`).join('')}
    </div>`,
  (_fd, memberId) => finish(memberId));
}

// --- Bonus / Belohnung -------------------------------------------------------

function bonusForm() {
  const kids = members().filter((m) => m.collectsPoints !== false);
  openModal(`
    ${modalHead('🎁 Bonus oder Belohnung')}
    <div class="field"><span>Für wen?</span>${memberPicker('memberId', kids[0]?.id || '')}</div>
    <div class="field"><span>Was passiert?</span>
      <div class="segmented">
        <label><input type="radio" name="kind" value="bonus" checked><span>➕ Bonuspunkte</span></label>
        <label><input type="radio" name="kind" value="redeem"><span>🎁 Punkte einlösen</span></label>
      </div>
    </div>
    <label class="field"><span>Wie viele Punkte?</span><input type="number" name="points" min="1" max="1000" value="5" required inputmode="numeric"></label>
    <label class="field"><span>Wofür?</span><input name="reason" maxlength="80" placeholder="z. B. Eis essen gehen 🍦"></label>
    <div class="modal-actions"><button type="submit" value="save" class="btn primary big">💾 Speichern</button></div>`,
  (fd) => {
    const m = member(fd.get('memberId'));
    if (!m) {
      toast('Bitte eine Person auswählen');
      return false;
    }
    const pts = Math.abs(Number(fd.get('points')) || 0);
    const redeem = fd.get('kind') === 'redeem';
    if (redeem && pts > pointsFor(m.id)) {
      if (!confirm(`${m.name} hat nur ${pointsFor(m.id)} Punkte. Trotzdem einlösen?`)) return false;
    }
    store.put('completions', {
      id: uid(),
      kind: redeem ? 'redeem' : 'bonus',
      day: today(),
      memberId: m.id,
      points: redeem ? -pts : pts,
      title: (fd.get('reason') || '').trim() || (redeem ? 'Belohnung' : 'Bonus'),
      doneAt: Date.now(),
    });
    if (!redeem) celebrate();
    toast(redeem ? `${m.name} hat ${pts} ⭐ eingelöst 🎁` : `+${pts} ⭐ für ${m.name}!`);
  });
}

// --- Essensplan --------------------------------------------------------------

function knownMeals() {
  const byName = new Map();
  for (const meal of store.all('meals')) {
    const k = meal.name.toLowerCase();
    const prev = byName.get(k);
    if (!prev || (meal.ingredients || []).length >= (prev.ingredients || []).length) byName.set(k, meal);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mealForm(day, slot) {
  const id = `${day}_${slot}`;
  const meal = store.get('meals', id);
  const slotInfo = MEAL_SLOTS.find((s) => s.id === slot);
  const d = meal || { name: '', emoji: '🍝', ingredients: [], note: '' };
  const known = knownMeals();
  openModal(`
    ${modalHead(`${slotInfo.icon} ${esc(slotInfo.label)} · ${esc(formatShort(day))}`)}
    <label class="field"><span>Was gibt es?</span>
      <input name="name" required maxlength="80" value="${esc(d.name)}" list="known-meals" placeholder="z. B. Spaghetti Bolognese"></label>
    <datalist id="known-meals">${known.map((k) => `<option value="${esc(k.name)}">`).join('')}</datalist>
    <div class="field"><span>Symbol</span>${emojiPicker('emoji', MEAL_EMOJIS, d.emoji)}</div>
    <label class="field"><span>🥕 Zutaten (eine pro Zeile)</span>
      <textarea name="ingredients" rows="5" placeholder="Spaghetti&#10;Hackfleisch&#10;Tomaten">${esc((d.ingredients || []).join('\n'))}</textarea></label>
    <label class="field"><span>📝 Notiz</span><input name="note" maxlength="200" value="${esc(d.note || '')}"></label>
    <div class="modal-actions">
      ${meal ? '<button type="submit" value="delete" class="btn danger">🗑️ Löschen</button>' : ''}
      <button type="submit" value="shop" class="btn">🛒 Zutaten einkaufen</button>
      <button type="submit" value="save" class="btn primary big">💾 Speichern</button>
    </div>`,
  (fd, action) => {
    if (action === 'delete') {
      store.remove('meals', id);
      toast('Mahlzeit entfernt');
      return;
    }
    const data = {
      id,
      date: day,
      slot,
      name: fd.get('name').trim(),
      emoji: fd.get('emoji'),
      ingredients: String(fd.get('ingredients') || '').split('\n').map((s) => s.trim()).filter(Boolean),
      note: (fd.get('note') || '').trim(),
    };
    store.batch(() => {
      store.put('meals', data);
      if (action === 'shop') {
        const n = addToShopping(data.ingredients, data.name);
        toast(n ? `${n} Zutat${n === 1 ? '' : 'en'} auf die Einkaufsliste 🛒` : 'Alles schon auf der Liste 👍');
      } else {
        toast('Essen geplant ✔');
      }
    });
  },
  (form) => {
    // Bekanntes Gericht gewählt → Zutaten und Symbol übernehmen.
    const name = $('input[name=name]', form);
    const ta = $('textarea[name=ingredients]', form);
    name.addEventListener('change', () => {
      const k = known.find((x) => x.name.toLowerCase() === name.value.trim().toLowerCase());
      if (!k) return;
      if (!ta.value.trim()) ta.value = (k.ingredients || []).join('\n');
      const radio = $$('input[name=emoji]', form).find((r) => r.value === k.emoji);
      if (radio) radio.checked = true;
    });
  });
}

// Fügt Zutaten hinzu, die nicht schon offen auf der Liste stehen. Gibt die Anzahl zurück.
function addToShopping(names, source = '') {
  const open = new Set(store.all('shopping').filter((i) => !i.checked).map((i) => i.name.toLowerCase()));
  let added = 0;
  let t = Date.now();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || open.has(name.toLowerCase())) continue;
    open.add(name.toLowerCase());
    store.put('shopping', { name, checked: false, source, createdAt: t++ });
    added += 1;
  }
  return added;
}

function weekToShopping() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(ui.mealWeek, i));
  let added = 0;
  let found = 0;
  store.batch(() => {
    for (const day of days) {
      for (const s of MEAL_SLOTS) {
        const meal = store.get('meals', `${day}_${s.id}`);
        if (!meal) continue;
        found += (meal.ingredients || []).length;
        added += addToShopping(meal.ingredients || [], meal.name);
      }
    }
  });
  if (!found) toast('Diese Woche sind noch keine Zutaten eingetragen');
  else toast(added ? `${added} Zutat${added === 1 ? '' : 'en'} auf die Einkaufsliste 🛒` : 'Alles schon auf der Liste 👍');
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

const actions = {
  'new-member': () => memberForm(),
  'edit-member': (el) => memberForm(el.dataset.id),
  'new-event': (el) => eventForm(null, el.dataset.day),
  'edit-event': (el) => eventForm(el.dataset.id, el.dataset.day),
  'new-task': () => taskForm(),
  'edit-task': (el) => taskForm(el.dataset.id),
  'toggle-task': (el) => toggleTask(el.dataset.id, el.dataset.occ),
  'task-filter': (el) => { setPref('taskFilter', el.dataset.id); render(); },
  'pick-day': (el) => {
    ui.calDay = el.dataset.day;
    ui.calMonth = el.dataset.day.slice(0, 7);
    render();
  },
  month: (el) => {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.delta), 1);
    ui.calMonth = toKey(d).slice(0, 7);
    render();
  },
  'cal-today': () => { ui.calDay = today(); ui.calMonth = ui.calDay.slice(0, 7); render(); },
  week: (el) => { ui.mealWeek = addDays(ui.mealWeek, Number(el.dataset.delta)); render(); },
  'edit-meal': (el) => mealForm(el.dataset.day, el.dataset.slot),
  'week-to-shopping': weekToShopping,
  'toggle-item': (el) => {
    const item = store.get('shopping', el.dataset.id);
    if (item) store.put('shopping', { ...item, checked: !item.checked });
  },
  'delete-item': (el) => store.remove('shopping', el.dataset.id),
  'clear-checked': () => {
    const done = store.all('shopping').filter((i) => i.checked);
    store.batch(() => done.forEach((i) => store.remove('shopping', i.id)));
    toast(`${done.length} Einträge entfernt`);
  },
  bonus: bonusForm,
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-view]');
  if (tab) return go(tab.dataset.view);
  const goto = e.target.closest('[data-goto]');
  if (goto) return go(goto.dataset.goto);
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    e.preventDefault();
    actions[el.dataset.action](el);
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="add-item"]');
  if (!form) return;
  e.preventDefault();
  const input = $('input[name=name]', form);
  const name = input.value.trim();
  if (!name) return;
  input.value = '';
  if (!addToShopping([name])) toast('Steht schon auf der Liste 👍');
  input.focus();
});

$('#sync-status').addEventListener('click', () => {
  store.flush();
  toast(store.online ? 'Mit allen Geräten verbunden 🟢' : 'Offline – Änderungen werden später übertragen 📴');
});

store.addEventListener('change', render);
store.addEventListener('status', renderStatus);

// Um Mitternacht (oder nach dem Aufwachen des Geräts) "Heute" aktualisieren.
let lastDay = today();
setInterval(() => {
  if (today() !== lastDay) {
    lastDay = today();
    render();
  }
}, 60000);

render();
renderStatus();
store.connect();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
  });
}
