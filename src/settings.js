// Backup, restore, and the plan start date that drives the week counter.

import { exportAll, importAll, getMeta, setMeta, storageKind, loggedSessions } from './store.js';
import { dateKey } from './session.js';

function say(msg, bad) {
  const el = document.getElementById('msg');
  el.className = 'msg' + (bad ? ' bad' : '');
  el.textContent = msg;
}

async function doExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gym-plan-history-${dateKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`Exported ${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'}.`);
}

async function doImport(file, replace) {
  try {
    const data = JSON.parse(await file.text());
    const r = await importAll(data, { replace });
    say(`Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} already current.`);
    await paint();
  } catch (e) {
    say(e.message || 'Could not read that file.', true);
  }
}

async function paint() {
  const main = document.getElementById('main');
  const start = await getMeta('startDate', dateKey());
  const kind = await storageKind();
  const n = (await loggedSessions()).length;

  main.innerHTML = `
    <div class="card">
      <h2>Backup</h2>
      <p>Download every session as a JSON file. Keep it somewhere safe before
      you change phones or clear Safari's data.</p>
      <button class="btn wide" type="button" id="export">Export history</button>
      <button class="btn ghost wide" type="button" id="pick" style="margin-top:8px">Import a backup</button>
      <input type="file" id="file" accept="application/json,.json" hidden>
      <div id="msg" class="msg"></div>
    </div>

    <div class="card">
      <h2>Plan start date</h2>
      <p>Sets the week number shown on Today. Change it if you started the plan
      before you installed this app.</p>
      <input type="date" id="start" value="${start}" max="${dateKey()}">
      <button class="btn ghost wide" type="button" id="savestart">Save start date</button>
    </div>

    <div class="card">
      <h2>Storage</h2>
      <p>${n} workout${n === 1 ? '' : 's'} stored on this device via
      ${kind === 'indexeddb' ? 'IndexedDB' : 'localStorage'}. Nothing leaves your phone -
      there is no account and no server.</p>
    </div>

    <div class="card danger">
      <h2>Start over</h2>
      <p>Deletes every logged session on this device. Export first.</p>
      <button class="btn wide" type="button" id="wipe">Delete all history</button>
    </div>`;
}

async function onClick(ev) {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.id === 'export') doExport();
  else if (t.id === 'pick') document.getElementById('file').click();
  else if (t.id === 'savestart') {
    const v = document.getElementById('start').value;
    if (!v) return say('Pick a date first.', true);
    await setMeta('startDate', v);
    say('Start date saved.');
  } else if (t.id === 'wipe') {
    const sessions = await loggedSessions();
    if (!sessions.length) return say('Nothing to delete.');
    if (!confirm(`Delete all ${sessions.length} logged workouts? This cannot be undone.`)) return;
    const { deleteSession } = await import('./store.js');
    for (const s of sessions) await deleteSession(s.id);
    await paint();
    say('History deleted.');
  }
}

function onChange(ev) {
  if (ev.target.id !== 'file' || !ev.target.files.length) return;
  const file = ev.target.files[0];
  const replace = confirm(
    'OK: replace everything on this device with the backup.\n' +
    'Cancel: merge the backup into what is already here (recommended).');
  doImport(file, replace);
  ev.target.value = '';
}

export async function mount() {
  document.getElementById('top').innerHTML = '<h1>Settings</h1>';
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  await paint();
}

export function unmount() {
  document.removeEventListener('click', onClick);
  document.removeEventListener('change', onChange);
}
