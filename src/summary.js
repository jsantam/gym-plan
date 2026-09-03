// Rolls the per-set history up into per-exercise progression.
// Deliberately small for now - the raw data supports a lot more.

import { PLAN } from './plan.js';
import { loggedSessions } from './store.js';
import { prettyDate, dateKey, daysBetween, sessionVolume, setsDone } from './session.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Name lookup so the table reads well even if the plan is edited later.
const NAMES = new Map();
PLAN.forEach(d => d.ex.forEach(e => NAMES.set(e.id, e.name)));

function rollUp(sessions) {
  const by = new Map();
  for (const s of sessions) {
    for (const e of s.exercises) {
      const done = e.sets.filter(x => x.done);
      if (!done.length) continue;
      const weights = done.map(x => +x.weight).filter(n => Number.isFinite(n) && n > 0);
      const rec = by.get(e.exId) || {
        exId: e.exId, name: NAMES.get(e.exId) || e.name,
        sessions: 0, sets: 0, reps: 0, volume: 0,
        best: 0, first: null, last: null, firstW: null, lastW: null,
      };
      rec.sessions++;
      rec.sets += done.length;
      rec.reps += done.reduce((a, x) => a + (+x.reps || 0), 0);
      rec.volume += done.reduce((a, x) => a + (+x.weight || 0) * (+x.reps || 0), 0);
      if (weights.length) {
        const top = Math.max(...weights);
        rec.best = Math.max(rec.best, top);
        // sessions arrive newest first, so the last one seen is the oldest
        if (rec.lastW === null) { rec.lastW = top; rec.last = s.date; }
        rec.firstW = top; rec.first = s.date;
      }
      by.set(e.exId, rec);
    }
  }
  return [...by.values()].sort((a, b) => b.volume - a.volume);
}

function row(r) {
  const delta = r.firstW !== null && r.lastW !== null ? r.lastW - r.firstW : null;
  const change = delta === null || r.sessions < 2 ? ''
    : delta > 0 ? `<span class="tag">+${delta} lb</span>`
    : delta < 0 ? `<span class="sl">${delta} lb</span>` : '<span class="sl">flat</span>';
  return `<div class="exline">
    <b>${esc(r.name)}</b>${change}
    <div class="sl">${r.sessions} session${r.sessions === 1 ? '' : 's'} · ${r.sets} sets · ${r.reps} reps${
      r.best ? ' · best ' + r.best + ' lb' : ''}${
      r.lastW !== null ? ' · last ' + r.lastW + ' lb on ' + esc(prettyDate(r.last)) : ''}</div>
  </div>`;
}

export async function mount() {
  document.getElementById('top').innerHTML = '<h1>Summary</h1>';
  const main = document.getElementById('main');
  const sessions = await loggedSessions();

  if (!sessions.length) {
    main.innerHTML = `<div class="empty">Nothing to summarise yet.<br>Log a workout and the numbers land here.</div>`;
    return;
  }

  const today = dateKey();
  const rows = rollUp(sessions);
  const totalSets = sessions.reduce((a, s) => a + s.exercises.reduce((b, e) => b + setsDone(e), 0), 0);
  const totalVol = sessions.reduce((a, s) => a + sessionVolume(s), 0);
  const span = daysBetween(sessions[sessions.length - 1].date, today) + 1;
  const perWeek = (sessions.length / Math.max(span / 7, 1)).toFixed(1);

  main.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${sessions.length}</b><span>workouts</span></div>
      <div class="stat"><b>${totalSets}</b><span>sets logged</span></div>
      <div class="stat"><b>${perWeek}</b><span>per week</span></div>
    </div>
    <div class="card">
      <h2>Total volume</h2>
      <p>${totalVol.toLocaleString()} lb lifted across ${sessions.length} session${
        sessions.length === 1 ? '' : 's'}, over ${span} day${span === 1 ? '' : 's'}.</p>
    </div>
    <div class="card">
      <h2>By exercise</h2>
      <p>Heaviest set each time, first logged session to most recent.</p>
      ${rows.map(row).join('')}
    </div>
    <div class="card">
      <h2>More to come</h2>
      <p>The stored data is per set, so estimated one-rep max, personal records
      and stalled-lift detection can all be added here without touching your history.</p>
    </div>`;
}

export function unmount() {}
