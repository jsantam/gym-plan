// Today's workout. Renders the plan for one day and logs weight and reps
// for every set as you go.

import { PLAN } from './plan.js';
import { getMeta, setMeta, putSession, exerciseHistory } from './store.js';
import {
  DAY_LABEL, dateKey, prettyDate, weekOf, todaysDayIndex,
  ensureSession, prefillFor, setsDone, exComplete, dayComplete,
  sessionVolume, topReps, resolveDay, swapKey,
} from './session.js';
import { startTimer } from './timer.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Store a number when the field is one, so every consumer of the data can
// do arithmetic without coercing. Free text survives as text, which keeps
// "BW" usable on chin-ups and hanging knee raises.
const numify = v => {
  const t = String(v).trim();
  if (t === '') return '';
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
};

let cur = 0;              // index into PLAN
let ramp = true;
let isRest = false;
let session = null;
let startDate = null;
const openPanels = new Set();   // exercise ids with the how-to panel open
const openSwaps = new Set();    // exercises showing their alternatives list
let swaps = {};                 // { "day-id:exercise-id": alternative-id }
let exList = [];                // today's exercises after swaps are applied
let showSummary = false;

const today = dateKey();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => putSession(session), 250);
}

/* ---------- small SVG sparkline, drawn by hand ---------- */

function sparkline(points) {
  if (points.length < 3) return '';
  const W = 300, H = 88, P = 22;
  const vals = points.map(p => p.weight);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = i => P + (i * (W - P - 8)) / (points.length - 1);
  const y = v => H - 20 - ((v - lo) / span) * (H - 38);
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.weight).toFixed(1)).join(' ');
  const dots = points.map((p, i) =>
    `<circle class="dt" cx="${x(i).toFixed(1)}" cy="${y(p.weight).toFixed(1)}" r="3"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Weight over the last ${points.length} sessions, ${lo} to ${hi} pounds">
    <line class="ax" x1="${P}" y1="${H - 18}" x2="${W - 4}" y2="${H - 18}"/>
    <path class="ln" d="${d}"/>${dots}
    <text x="0" y="${y(hi) + 4}">${hi}</text>
    ${hi !== lo ? `<text x="0" y="${y(lo) + 4}">${lo}</text>` : ''}
    <text x="${P}" y="${H - 4}">${points[0].label}</text>
    <text x="${W - 4}" y="${H - 4}" text-anchor="end">${points[points.length - 1].label}</text>
  </svg>`;
}

async function progressBlock(exId) {
  const hist = await exerciseHistory(exId, 5);
  if (!hist.length) {
    return `<div class="prog"><h3>Your history</h3><p class="muted">No sessions logged yet.</p></div>`;
  }
  const rows = hist.map(h => {
    const w = h.topWeight ? h.topWeight + ' lb' : '—';
    return `<li><span>${esc(prettyDate(h.date))}</span><span>${esc(w)} · ${h.sets.length} sets · ${h.totalReps} reps</span></li>`;
  }).join('');
  // Oldest first for the chart, and only points that carry a weight.
  const pts = hist.slice().reverse()
    .filter(h => h.topWeight > 0)
    .map(h => ({ weight: h.topWeight, label: h.date.slice(5).replace('-', '/') }));
  return `<div class="prog"><h3>Your history</h3><ul>${rows}</ul>${sparkline(pts)}</div>`;
}

/* ---------- header ---------- */

function renderHeader() {
  const top = document.getElementById('top');
  top.innerHTML = `<div class="tabs" role="tablist" aria-label="Workout days">${
    PLAN.map((d, i) => `<button class="tab${i === cur ? ' on' : ''}" role="tab"
      aria-selected="${i === cur}" data-day="${i}">${DAY_LABEL[d.dow]}<small>${esc(d.name)}</small></button>`).join('')
  }</div>`;
}

/* ---------- exercise ---------- */

function setRow(rec, i, exIndex) {
  const s = rec.sets[i];
  return `<div class="setrow${s.done ? ' done' : ''}" data-ex="${exIndex}" data-set="${i}">
    <button class="set${s.done ? ' done' : ''}" type="button" data-tick="${exIndex}:${i}"
      aria-pressed="${s.done}" aria-label="Set ${i + 1}${s.done ? ', logged' : ''}">${i + 1}</button>
    <label class="fld"><input type="text" inputmode="decimal" data-fld="weight" data-at="${exIndex}:${i}"
      value="${esc(s.weight)}" aria-label="Set ${i + 1} weight in pounds">lb</label>
    <span class="x">&times;</span>
    <label class="fld"><input type="text" inputmode="numeric" data-fld="reps" data-at="${exIndex}:${i}"
      value="${esc(s.reps)}" aria-label="Set ${i + 1} reps">reps</label>
  </div>`;
}

function swapHTML(ex, j) {
  const planned = ex.swappedFrom ? null : ex;
  const alts = ex.alts || [];
  if (!alts.length) return '';
  const key = ex.swappedFrom || ex.id;
  const open = openSwaps.has(String(j));
  if (!open) {
    return `<button class="toggle swapbtn" type="button" data-swapopen="${j}">${
      ex.swappedFrom ? 'Swapped. Change or go back' : 'Too hard? Swap it'}</button>`;
  }
  const opt = (id, name, why, on) => `<button class="opt${on ? ' on' : ''}" type="button"
      data-swap="${j}:${id}" aria-pressed="${on}"><b>${esc(name)}</b>${
      why ? `<span>${esc(why)}</span>` : ''}</button>`;
  return `<button class="toggle swapbtn" type="button" data-swapopen="${j}">Hide</button>
    <div class="swaplist">
      ${opt('__planned', ex.swappedFromName || ex.name, 'As planned', !ex.swappedFrom)}
      ${alts.map(a => opt(a.id, a.name, a.why, ex.swappedFrom && ex.id === a.id)).join('')}
      <p class="swapnote">Your history is kept per exercise, so the swap builds its own
      progress and the planned lift keeps whatever you already logged.</p>
    </div>`;
}

async function exerciseHTML(ex, rec, j, total) {
  const open = openPanels.has(ex.id + ':' + j);
  const rest = j < 2 ? 90 : 60;
  const hist = await exerciseHistory(ex.id, 1);
  const last = hist[0];
  const complete = exComplete(rec);
  const target = topReps(rec.repsTarget);

  return `<section class="ex${open ? ' open' : ''}${complete ? ' done' : ''}" id="ex-${j}">
    <div class="row">
      <img class="ph" src="public/img/${ex.img}.jpg" alt="" width="96" height="96" loading="lazy" decoding="async">
      <div>
        <div class="num">${j + 1} of ${total}</div>
        <h2>${esc(ex.name)}</h2>
        ${ex.swappedFrom ? `<div class="swapped">instead of ${esc(ex.swappedFromName)}</div>` : ''}
        <div class="big">${rec.setsTarget} sets of ${esc(rec.repsTarget)}</div>
        <div class="works">${esc(ex.works)}</div>
        <button class="toggle" type="button" data-panel="${ex.id}:${j}">${open ? 'Hide' : 'How to do it'}</button>
        ${swapHTML(ex, j)}
      </div>
    </div>
    <div class="more">
      <img src="public/img/${ex.img}.jpg" alt="${esc(ex.eq)}" loading="lazy" decoding="async">
      <div class="eq">${esc(ex.eq)}</div>
      <p class="how">${esc(ex.how)}</p>
      <a class="btn ghost" href="${esc(ex.yt)}" target="_blank" rel="noopener">Watch a video</a>
      ${ex.alt ? `<p class="alt">${esc(ex.alt)}</p>` : ''}
      ${open ? await progressBlock(ex.id) : ''}
    </div>
    ${j === 0 ? '<p class="hint">Tap a number when you finish that set. Typing a weight or reps logs it too.</p>' : ''}
    <div class="sets">${rec.sets.map((_, i) => setRow(rec, i, j)).join('')}</div>
    <div class="actions">
      <button class="btn ghost" type="button" data-rest="${rest}">Rest ${rest}s</button>
    </div>
    ${last && last.date !== today
      ? `<div class="last">Last time ${esc(prettyDate(last.date))}: ${last.topWeight || '—'} lb for ${last.sets.length} sets${
          last.addWeightNextTime ? '<span class="up">add weight today</span>' : ''}</div>`
      : ''}
    <div class="nudge" data-nudge="${j}"${complete ? '' : ' hidden'}>
      <span>Hit ${target || 'the top of the range'} reps on every set?</span>
      <button type="button" data-up="${j}" class="${rec.addWeightNextTime ? 'on' : ''}">${
        rec.addWeightNextTime ? 'Adding weight next time' : 'Yes, add weight next time'}</button>
    </div>
  </section>`;
}

/* ---------- full render ---------- */

export async function render() {
  const day = PLAN[cur];
  exList = resolveDay(day, swaps);
  session = await ensureSession(today, cur, ramp, exList);
  const week = weekOf(startDate, today);
  const main = document.getElementById('main');

  let msg = `<b>Week ${week}</b> of the plan.`;
  if (week === 1) msg += ' Ramp-up week, keep it light.';
  else if (week === 2 && ramp) msg += ' Ramp-up is done, switch it off below.';
  else if (week % 7 === 0) msg += ' Deload week: 2 sets, moderate weight, then back to normal next week.';

  const exHTML = [];
  for (let j = 0; j < exList.length; j++) {
    exHTML.push(await exerciseHTML(exList[j], session.exercises[j], j, exList.length));
  }

  const logged = session.exercises.reduce((a, e) => a + setsDone(e), 0);

  main.innerHTML = `
    <div class="head"><h1>${esc(day.name)}</h1>
      <p>${esc(day.focus)}. ${day.ex.length} exercises, about 50 minutes.</p></div>
    ${isRest ? `<div class="rest">Today is a rest day. Showing ${esc(day.name)} in case you want to train anyway. Light cardio is fine too.</div>` : ''}
    <div class="wk">${msg}</div>
    <div class="mode">
      <label for="sw"><strong>Week 1 ramp-up</strong><span>${
        ramp ? '2 sets of 12 to 15, keep 5 reps in the tank' : 'Off. 3 sets, 1 or 2 reps in the tank'}</span></label>
      <button class="sw" id="sw" type="button" role="switch" aria-checked="${ramp}" aria-label="Week 1 ramp-up"></button>
    </div>
    <div class="warm">
      <p><strong>Warm up first</strong>5 minutes easy on the rower or treadmill, then one light set of exercise 1.</p>
      <button class="set${session.warmup ? ' done' : ''}" type="button" id="warm"
        aria-pressed="${session.warmup}" aria-label="Warm-up done">&check;</button>
    </div>
    ${exHTML.join('')}
    ${showSummary ? finishSummary() : ''}
    <div class="finish">
      <button class="btn wide" type="button" id="finish" ${logged ? '' : 'disabled'}>${
        session.finishedAt ? 'Workout finished' : 'Finish workout'}</button>
    </div>
    <div class="notes">
      <h3>Rules for today</h3>
      <p>Warm up 5 minutes on the rower or treadmill, then one light set of the first exercise.</p>
      <p>Add weight next time once you hit the top of the rep range on every set. Drop weight if you cannot reach the bottom of the range.</p>
      <p>Elbow pain that fades as you warm up is fine. Pain that gets worse during a set means stop that exercise for today.</p>
    </div>`;

  renderHeader();
  markDayDots();
}

function finishSummary() {
  const done = session.exercises.filter(e => setsDone(e) > 0);
  const sets = session.exercises.reduce((a, e) => a + setsDone(e), 0);
  const vol = sessionVolume(session);
  return `<div class="summary"><h3>${esc(session.dayName)} logged</h3>
    <p>${done.length} of ${session.exercises.length} exercises, ${sets} sets${
      vol ? `, ${vol.toLocaleString()} lb of total volume` : ''}. It is in History now.</p></div>`;
}

// A green dot on a day tab means every exercise hit its set target today.
function markDayDots() {
  document.querySelectorAll('.tab').forEach(t => {
    if (+t.dataset.day === cur && dayComplete(session)) {
      if (!t.querySelector('.dot')) t.insertAdjacentHTML('afterbegin', '<span class="dot"></span>');
    }
  });
}

/* ---------- targeted updates (no re-render, so typing is never interrupted) ---------- */

function refreshFinish() {
  const btn = document.getElementById('finish');
  if (!btn || !session) return;
  const logged = session.exercises.reduce((a, e) => a + setsDone(e), 0);
  btn.disabled = !logged;
}

function refreshExercise(j) {
  const rec = session.exercises[j];
  const sec = document.getElementById('ex-' + j);
  if (!sec) return;
  sec.classList.toggle('done', exComplete(rec));
  const nudge = sec.querySelector('[data-nudge]');
  if (nudge) nudge.hidden = !exComplete(rec);
  markDayDots();
}

async function tick(j, i) {
  const rec = session.exercises[j];
  const s = rec.sets[i];
  s.done = !s.done;

  if (s.done) {
    const fill = await prefillFor(rec, i);
    s.weight = fill.weight;
    s.reps = fill.reps;
    s.at = new Date().toISOString();
  } else {
    s.at = null;
    rec.addWeightNextTime = false;
  }

  const row = document.querySelector(`.setrow[data-ex="${j}"][data-set="${i}"]`);
  if (row) {
    row.classList.toggle('done', s.done);
    const btn = row.querySelector('.set');
    btn.classList.toggle('done', s.done);
    btn.setAttribute('aria-pressed', String(s.done));
    row.querySelector('[data-fld=weight]').value = s.weight;
    row.querySelector('[data-fld=reps]').value = s.reps;
  }
  refreshExercise(j);
  refreshFinish();
  save();
}

/* ---------- events ---------- */

function onClick(ev) {
  const t = ev.target.closest('button');
  if (!t) return;

  if (t.dataset.day != null) {
    cur = +t.dataset.day;
    showSummary = false;
    setMeta('lastDay', cur);
    render().then(() => window.scrollTo(0, 0));
  } else if (t.id === 'sw') {
    ramp = !ramp;
    setMeta('ramp', ramp);
    render();
  } else if (t.dataset.panel) {
    const k = t.dataset.panel;
    openPanels.has(k) ? openPanels.delete(k) : openPanels.add(k);
    render();
  } else if (t.dataset.swapopen != null) {
    const k = String(t.dataset.swapopen);
    openSwaps.has(k) ? openSwaps.delete(k) : openSwaps.add(k);
    render();
  } else if (t.dataset.swap) {
    const [j, id] = [t.dataset.swap.split(':')[0], t.dataset.swap.slice(t.dataset.swap.indexOf(':') + 1)];
    const ex = exList[+j];
    const key = swapKey(PLAN[cur].id, ex.swappedFrom || ex.id);
    if (id === '__planned') delete swaps[key];
    else swaps[key] = id;
    openSwaps.delete(String(j));
    setMeta('swaps', swaps).then(render);
  } else if (t.dataset.tick) {
    const [j, i] = t.dataset.tick.split(':').map(Number);
    tick(j, i);
  } else if (t.id === 'warm') {
    session.warmup = !session.warmup;
    t.classList.toggle('done', session.warmup);
    t.setAttribute('aria-pressed', String(session.warmup));
    save();
  } else if (t.dataset.rest) {
    startTimer(+t.dataset.rest);
  } else if (t.dataset.up != null) {
    const rec = session.exercises[+t.dataset.up];
    rec.addWeightNextTime = !rec.addWeightNextTime;
    t.classList.toggle('on', rec.addWeightNextTime);
    t.textContent = rec.addWeightNextTime ? 'Adding weight next time' : 'Yes, add weight next time';
    save();
  } else if (t.id === 'finish') {
    session.finishedAt = new Date().toISOString();
    showSummary = true;
    putSession(session).then(render);
  }
}

// Typing a weight into set 1 carries down to later sets that are still
// blank, so a straight-across-sets workout takes one entry, not three.
function onInput(ev) {
  const el = ev.target;
  if (!el.dataset || !el.dataset.fld) return;
  const [j, i] = el.dataset.at.split(':').map(Number);
  const rec = session.exercises[j];
  const field = el.dataset.fld;
  rec.sets[i][field] = numify(el.value);

  // Entering a number *is* logging the set. Tapping the circle is the fast
  // path, not the only one - typing the weight and never tapping used to
  // leave the set uncounted and the Finish button dead.
  if (el.value.trim() !== '' && !rec.sets[i].done) {
    rec.sets[i].done = true;
    rec.sets[i].at = new Date().toISOString();
    const row = el.closest('.setrow');
    if (row) {
      row.classList.add('done');
      const btn = row.querySelector('.set');
      btn.classList.add('done');
      btn.setAttribute('aria-pressed', 'true');
    }
    refreshExercise(j);
    refreshFinish();
  }

  if (field === 'weight' && el.value.trim() !== '') {
    for (let k = i + 1; k < rec.sets.length; k++) {
      if (!rec.sets[k].done && rec.sets[k].weight === '') {
        // Filled in as a convenience only - these sets are not logged until
        // you actually tap or type in them.
        rec.sets[k].weight = numify(el.value);
        const inp = document.querySelector(`[data-fld=weight][data-at="${j}:${k}"]`);
        if (inp && document.activeElement !== inp) inp.value = el.value.trim();
      }
    }
  }
  save();
}

export async function mount() {
  ramp = await getMeta('ramp', true);
  swaps = await getMeta('swaps', {}) || {};
  startDate = await getMeta('startDate', null);
  if (!startDate) startDate = await setMeta('startDate', today);

  const t = todaysDayIndex();
  isRest = t < 0;
  cur = isRest ? await getMeta('lastDay', 0) : t;

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  await render();
}

export function unmount() {
  document.removeEventListener('click', onClick);
  document.removeEventListener('input', onInput);
  if (session) putSession(session);
}
