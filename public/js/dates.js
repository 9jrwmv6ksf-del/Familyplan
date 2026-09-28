// Datumshilfen und Wiederholungslogik. Alle Daten sind lokale Kalendertage
// im Format "YYYY-MM-DD", damit es keine Zeitzonenprobleme gibt.

export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

export const REPEAT_LABELS = {
  none: 'Einmalig',
  daily: 'Jeden Tag',
  weekly: 'Jede Woche',
  monthly: 'Jeden Monat',
  yearly: 'Jedes Jahr',
};

export function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toKey(new Date());
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

// Montag der Woche, in der `key` liegt.
export function startOfWeek(key) {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toKey(d);
}

export function weekdayOf(key) {
  return fromKey(key).getDay();
}

export function formatLong(key) {
  const d = fromKey(key);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

export function formatShort(key) {
  const d = fromKey(key);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

export function relativeLabel(key, ref = today()) {
  if (key === ref) return 'Heute';
  if (key === addDays(ref, 1)) return 'Morgen';
  if (key === addDays(ref, -1)) return 'Gestern';
  return formatShort(key);
}

/**
 * Findet heraus, ob ein Termin/Ämtli mit Wiederholung an `key` stattfindet.
 * item: { date, repeat: 'none'|'daily'|'weekly'|'monthly'|'yearly', weekdays?: number[], until?, skip?: string[] }
 */
export function occursOn(item, key) {
  if (!item.date) return false;
  if (key < item.date) return false;
  if (item.until && key > item.until) return false;
  if (item.skip && item.skip.includes(key)) return false;
  const repeat = item.repeat || 'none';
  if (repeat === 'none') return key === item.date;
  if (repeat === 'daily') return true;
  const start = fromKey(item.date);
  const d = fromKey(key);
  if (repeat === 'weekly') {
    const days = item.weekdays && item.weekdays.length ? item.weekdays : [start.getDay()];
    return days.includes(d.getDay());
  }
  if (repeat === 'monthly') return d.getDate() === start.getDate();
  if (repeat === 'yearly') return d.getDate() === start.getDate() && d.getMonth() === start.getMonth();
  return false;
}

export function describeRepeat(item) {
  const repeat = item.repeat || 'none';
  if (repeat === 'weekly' && item.weekdays && item.weekdays.length) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const days = order.filter((d) => item.weekdays.includes(d));
    if (days.length === 7) return 'Jeden Tag';
    return 'Jeden ' + days.map((d) => WEEKDAYS_SHORT[d]).join(', ');
  }
  return REPEAT_LABELS[repeat] || REPEAT_LABELS.none;
}

// Nächstes Vorkommen ab `from` (inklusive), maximal `limit` Tage voraus.
export function nextOccurrence(item, from = today(), limit = 400) {
  for (let i = 0; i <= limit; i++) {
    const key = addDays(from, i);
    if (occursOn(item, key)) return key;
  }
  return null;
}
