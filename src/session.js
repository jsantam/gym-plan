// Turns the static plan plus stored history into the live session object
// that the Today screen edits.

import { PLAN } from './plan.js';
import { getSession, putSession, sessionId, exerciseHistory, getMeta } from './store.js';

export const DOW = { MO: 1, TU: 2, WE: 3, FR: 5, SA: 6 };
export const DAY_LABEL = { MO: 'Mon', TU: 'Tue', WE: 'Wed', FR: 'Fri', SA: 'Sat' };

// Local calendar date, not UTC. toISOString() would roll the date over
// for anyone training in the evening west of Greenwich.
export function dateKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function daysBetween(a, b) {
  const p = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 864e5);
}

export function weekOf(startDate, today = dateKey()) {
  if (!startDate) return 1;
  return Math.floor(daysBetween(startDate, today) / 7) + 1;
}

// Index of the plan day matching today's weekday, or -1 on a rest day.
export function todaysDayIndex(d = new Date()) {
  return PLAN.findIndex(day => DOW[day.dow] === d.getDay());
}

// An exercise can be swapped for an easier alternative. The swap is a
// stored preference per day, and the session is logged against the
// alternative's own id so history stays honest about what was actually done.
export const swapKey = (dayId, exId) => dayId + ':' + exId;

export function effectiveEx(dayId, ex, swaps) {
  const altId = swaps && swaps[swapKey(dayId, ex.id)];
  if (!altId) return ex;
  const alt = (ex.alts || []).find(a => a.id === altId);
  if (!alt) return ex;
  return { ...alt, alts: ex.alts, swappedFrom: ex.id, swappedFromName: ex.name };
}

export const resolveDay = (day, swaps) => day.ex.map(ex => effectiveEx(day.id, ex, swaps));

export const setsTarget = (ex, ramp) => (ramp ? 2 : ex.sets);
export const repsTarget = (ex, ramp) => (ramp ? '12-15' : ex.reps);

// Top of a rep range: "8-12" -> 12, "10-12 each" -> 12, "15" -> 15.
export function topReps(reps) {
  const m = String(reps).match(/(\d+)\s*(?:-\s*(\d+))?/);
  if (!m) return null;
  return Number(m[2] || m[1]);
}

const blankSet = n => ({ n, weight: '', reps: '', done: false, at: null });

function blankExercise(ex, ramp) {
  return {
    exId: ex.id,
    name: ex.name,
    setsTarget: setsTarget(ex, ramp),
    repsTarget: repsTarget(ex, ramp),
    sets: Array.from({ length: setsTarget(ex, ramp) }, (_, i) => blankSet(i + 1)),
    addWeightNextTime: false,
    note: '',
  };
}

// Load today's record for a day, creating it if this is the first visit.
// Existing records are reconciled against the current ramp setting: set
// rows are added when the target grows, and never removed if they hold
// logged work.
export async function ensureSession(date, dayIndex, ramp, exList) {
  const day = PLAN[dayIndex];
  const list = exList || day.ex;
  const id = sessionId(date, day.id);
  let s = await getSession(id);

  if (!s) {
    s = {
      id, date, dayIndex, dayId: day.id, dayName: day.name,
      week: weekOf(await getMeta('startDate', date), date),
      ramp: !!ramp,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      warmup: false,
      exercises: list.map(ex => blankExercise(ex, ramp)),
    };
    await putSession(s);
    return s;
  }

  s.ramp = !!ramp;
  list.forEach((ex, i) => {
    let rec = s.exercises[i];
    // Swapped for a different exercise since this record was made: start the
    // slot fresh rather than filing the new lift under the old one's id.
    if (!rec || rec.exId !== ex.id) rec = s.exercises[i] = blankExercise(ex, ramp);
    rec.setsTarget = setsTarget(ex, ramp);
    rec.repsTarget = repsTarget(ex, ramp);
    const keep = Math.max(rec.setsTarget, rec.sets.filter(x => x.done).length);
    while (rec.sets.length < keep) rec.sets.push(blankSet(rec.sets.length + 1));
    while (rec.sets.length > keep && !rec.sets[rec.sets.length - 1].done) rec.sets.pop();
  });
  return s;
}

// What to put in a set the moment it is ticked, in order of preference:
// what is already typed on this set, the set above it today, the same set
// number last time, last time's heaviest, and finally the top of the rep
// range. The aim is that a normal session needs no typing at all.
export async function prefillFor(sessionEx, setIndex) {
  const cur = sessionEx.sets[setIndex];
  const out = { weight: cur.weight, reps: cur.reps };

  const above = sessionEx.sets.slice(0, setIndex).filter(x => x.weight !== '' || x.reps !== '').pop();
  if (out.weight === '' && above) out.weight = above.weight;
  if (out.reps === '' && above) out.reps = above.reps;

  if (out.weight === '' || out.reps === '') {
    const hist = await exerciseHistory(sessionEx.exId, 1);
    const last = hist[0];
    if (last) {
      const same = last.sets[setIndex] || last.sets[last.sets.length - 1];
      if (out.weight === '' && same) out.weight = same.weight;
      if (out.reps === '' && same) out.reps = same.reps;
    }
  }

  if (out.reps === '') {
    const t = topReps(sessionEx.repsTarget);
    if (t) out.reps = t;
  }
  return out;
}

export const setsDone = ex => ex.sets.filter(x => x.done).length;
export const exComplete = ex => setsDone(ex) >= ex.setsTarget;
export const dayComplete = s => !!s && s.exercises.every(exComplete);
export const sessionVolume = s =>
  s.exercises.reduce((a, e) =>
    a + e.sets.reduce((b, x) => b + (x.done ? (+x.weight || 0) * (+x.reps || 0) : 0), 0), 0);
