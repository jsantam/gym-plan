// Router. Four screens, hash based so it works from a file:// path and
// from a project subpath on GitHub Pages without any server rewrites.

import { migrateTypedSets } from './migrate.js';

const ROUTES = {
  today: () => import('./today.js'),
  history: () => import('./history.js'),
  summary: () => import('./summary.js'),
  settings: () => import('./settings.js'),
};

let active = null;

function routeName() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES[h] ? h : 'today';
}

async function go() {
  const name = routeName();
  if (active && active.name === name) return;

  if (active && active.mod.unmount) active.mod.unmount();

  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('on', a.dataset.route === name));
  document.getElementById('top').innerHTML = '';
  document.getElementById('main').innerHTML = '';

  const mod = await ROUTES[name]();
  active = { name, mod };
  await mod.mount();
}

window.addEventListener('hashchange', go);
migrateTypedSets().catch(e => console.warn('migrate', e)).then(go);

// Service worker: only meaningful over http(s), and skipped on localhost
// so a dev reload never serves a stale cached build.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')
    && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
  });
}
