// Past sessions, newest first, each expandable down to the individual sets.

import { loggedSessions, deleteSession } from './store.js';
import { prettyDate, dateKey, daysBetween, weekOf, sessionVolume, setsDone } from './session.js';
import { getMeta } from './store.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const open = new Set();
let sessions = [];

// Older records stored weights as strings; treat anything numeric as pounds
// and leave free text such as "BW" as written.
const isNum = v => v !== '' && Number.isFinite(+v);

function setLine(x) {
  const w = x.weight === '' ? '—' : x.weight + (isNum(x.weight) ? ' lb' : '');
  const r = x.reps === '' ? '?' : x.reps;
  return `${w} &times; ${r}`;
}

function exerciseLine(e) {
  const done = e.sets.filter(x => x.done);
  if (!done.length) return '';
  return `<div class="exline">
    <b>${esc(e.name)}</b>${e.addWeightNextTime ? '<span class="tag">add weight</span>' : ''}
    <div class="sl">${done.map(setLine).join(' &nbsp;·&nbsp; ')}</div>
  </div>`;
}

function sessionCard(s) {
  const sets = s.exercises.reduce((a, e) => a + setsDone(e), 0);
  const exs = s.exercises.filter(e => setsDone(e) > 0).length;
  const vol = sessionVolume(s);
  return `<article class="sess${open.has(s.id) ? ' open' : ''}" data-id="${esc(s.id)}">
    <button class="sesshd" type="button" data-toggle="${esc(s.id)}" aria-expanded="${open.has(s.id)}">
      <div><strong>${esc(s.dayName)}</strong><em>${esc(prettyDate(s.date))} · ${exs} exercise${exs === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}${
        vol ? ' · ' + vol.toLocaleString() + ' lb' : ''}</em></div>
      <span class="chev" aria-hidden="true">&rsaquo;</span>
    </button>
    <div class="sessbody">
      ${s.exercises.map(exerciseLine).join('')}
      <div class="actions"><button class="btn ghost" type="button" data-del="${esc(s.id)}">Delete this session</button></div>
    </div>
  </article>`;
}

async function paint() {
  const main = document.getElementById('main');
  const today = dateKey();
  const startDate = await getMeta('startDate', today);

  if (!sessions.length) {
    main.innerHTML = `<div class="empty">No workouts logged yet.<br>Tick some sets on Today and they will show up here.</div>`;
    return;
  }

  const thisWeek = sessions.filter(s => daysBetween(s.date, today) < 7 && daysBetween(s.date, today) >= 0).length;
  const thisMonth = sessions.filter(s => s.date.slice(0, 7) === today.slice(0, 7)).length;

  main.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${thisWeek}</b><span>this week</span></div>
      <div class="stat"><b>${thisMonth}</b><span>this month</span></div>
      <div class="stat"><b>${weekOf(startDate, today)}</b><span>plan week</span></div>
    </div>
    ${sessions.map(sessionCard).join('')}`;
}

async function onClick(ev) {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.toggle) {
    const id = t.dataset.toggle;
    open.has(id) ? open.delete(id) : open.add(id);
    const card = document.querySelector(`.sess[data-id="${CSS.escape(id)}"]`);
    card.classList.toggle('open', open.has(id));
    t.setAttribute('aria-expanded', String(open.has(id)));
  } else if (t.dataset.del) {
    const id = t.dataset.del;
    const s = sessions.find(x => x.id === id);
    if (!confirm(`Delete ${s.dayName} on ${prettyDate(s.date)}? This cannot be undone.`)) return;
    await deleteSession(id);
    sessions = await loggedSessions();
    await paint();
  }
}

export async function mount() {
  document.getElementById('top').innerHTML = '<h1>History</h1>';
  sessions = await loggedSessions();
  document.addEventListener('click', onClick);
  await paint();
}

export function unmount() {
  document.removeEventListener('click', onClick);
}
