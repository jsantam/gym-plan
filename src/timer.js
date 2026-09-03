// Rest timer. Holds a screen wake lock while running so the phone does
// not sleep mid-set, and beeps plus vibrates when time is up.

const el = () => document.getElementById('timer');
let tid = null, left = 0, wl = null, total = 0;

const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

async function wake() {
  try { if ('wakeLock' in navigator) wl = await navigator.wakeLock.request('screen'); }
  catch (e) { /* denied or unsupported; the timer still works */ }
}
function release() {
  try { if (wl) { wl.release(); wl = null; } } catch (e) {}
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const c = new Ctx();
    [0, 0.25, 0.5].forEach(t => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0.3, c.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.2);
      o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.2);
    });
    setTimeout(() => c.close && c.close(), 1200);
  } catch (e) {}
}

function paint() {
  const tm = document.getElementById('tm');
  if (tm) tm.textContent = left > 0 ? fmt(left) : 'Go';
}

export function startTimer(seconds, label) {
  wake();
  total = left = seconds;
  const t = el();
  const lab = document.getElementById('tlabel');
  if (lab) lab.textContent = label || 'rest, then next set';
  t.classList.add('on');
  paint();
  clearInterval(tid);
  tid = setInterval(() => {
    left--;
    paint();
    if (left <= 0) {
      clearInterval(tid); tid = null;
      beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      release();
    }
  }, 1000);
}

export function stopTimer() {
  clearInterval(tid); tid = null;
  el().classList.remove('on');
  release();
}

// Screens lock and tabs get backgrounded; re-acquire the lock on return
// so a timer started before a lock screen keeps the display awake after.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tid && !wl) wake();
});

document.addEventListener('click', ev => {
  if (ev.target.closest('#tstop')) stopTimer();
});

export const timerRunning = () => tid !== null;
export const timerTotal = () => total;
