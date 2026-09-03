// One-off repair for sessions logged before typing a value counted as
// logging a set. Those records hold real weights and reps with done:false,
// so the work is there but invisible to History, Summary and Finish.
//
// Only sets with a reps value are recovered. Weight alone is ambiguous:
// entering a weight on set 1 auto-fills the sets below it, and those were
// never performed. Reps are never auto-filled, so a reps value can only
// have been typed by hand.

import { allSessions, putSession, getMeta, setMeta } from './store.js';

const FLAG = 'migratedTypedSets';

export async function migrateTypedSets() {
  if (await getMeta(FLAG, false)) return 0;

  let fixed = 0;
  for (const s of await allSessions()) {
    let touched = false;
    for (const e of s.exercises || []) {
      for (const set of e.sets || []) {
        if (!set.done && set.reps !== '' && set.reps != null) {
          set.done = true;
          set.at = set.at || s.startedAt || null;
          touched = true;
          fixed++;
        }
      }
    }
    if (touched) await putSession(s);
  }

  await setMeta(FLAG, true);
  if (fixed) console.info(`Recovered ${fixed} set(s) logged before the fix.`);
  return fixed;
}
