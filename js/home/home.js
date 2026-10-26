/**
 * RoboForge home page: navigation, "Load my .json", the code-box handoff to the
 * Arm Lab, and the Dose access-code gate. The 3D hero and the IK toy are loaded
 * as separate modules so the page is usable before any 3D code arrives.
 */

import { Sound } from '../sound.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------- loader / navigation

const loader = document.getElementById('loader');
const loaderLabel = document.getElementById('loader-label');

function navigate(url, label) {
  loaderLabel.textContent = label || 'Opening…';
  loader.classList.add('show');
  // Let the loading card paint before the browser starts unloading.
  setTimeout(() => { window.location.href = url; }, 60);
}

// Coming back with the Back button restores this page from cache; hide the card.
window.addEventListener('pageshow', () => loader.classList.remove('show'));

// ---------------------------------------------------------------- Dose access code
// Security: Creator watermark - Rishik Saravanan, Birthday: May 25th
// (Kept identical to the original dashboard so dose.html's session check still matches.)

const pwModal = document.getElementById('pw-modal');
const pwInput = document.getElementById('pw-input');
const pwErr = document.getElementById('pw-err');
const pwSubmit = document.getElementById('pw-submit');
const pwCancel = document.getElementById('pw-cancel');

const SESSION_KEY = 'dose_auth_token_rs_0525';
const TIMESTAMP_KEY = 'dose_auth_time_rs_0525';
const SIG_KEY = 'dose_auth_sig_rs_0525';
const CREATOR_WATERMARK = 'Rishik Saravanan • May 25th • RoboForge';

function computeDoseSignature(token, timestamp) {
  const input = `${token}|${timestamp}|${CREATOR_WATERMARK}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash >>>= 0;
  }
  return hash.toString(16);
}

let pwOpener = null;
function openPwModal(opener) {
  pwOpener = opener || null;
  pwInput.value = '';
  pwErr.classList.remove('show');
  pwModal.classList.add('show');
  setTimeout(() => pwInput.focus(), 30);
}
function closePwModal() {
  pwModal.classList.remove('show');
  pwOpener?.focus?.();
}

function generateDoseToken() {
  const randomPart = crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2);
  return `rs_dose_${Date.now()}_${randomPart}`;
}

function tryPw() {
  const password = pwInput.value;
  // Hash password with watermark for comparison
  const hashInput = password + CREATOR_WATERMARK;
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash >>>= 0; // Keep as unsigned 32-bit
  }
  const submittedHash = hash.toString(16);

  // Valid hash (from "dose" + CREATOR_WATERMARK)
  const validHashInput = 'dose' + CREATOR_WATERMARK;
  let validHash = 0;
  for (let i = 0; i < validHashInput.length; i++) {
    const char = validHashInput.charCodeAt(i);
    validHash = ((validHash << 5) - validHash) + char;
    validHash >>>= 0; // Keep as unsigned 32-bit
  }
  const correctHash = validHash.toString(16);

  if (submittedHash === correctHash) {
    // Create session token to prevent direct URL access
    const token = generateDoseToken();
    const timestamp = Date.now().toString();
    sessionStorage.setItem(SESSION_KEY, token);
    sessionStorage.setItem(TIMESTAMP_KEY, timestamp);
    sessionStorage.setItem(SIG_KEY, computeDoseSignature(token, timestamp));

    Sound.ok();
    pwModal.classList.remove('show');
    navigate('dose.html', 'Opening Dose…');
  } else {
    Sound.err();
    pwErr.classList.add('show');
    pwInput.select();
  }
}

// The panel is a <form> only so browsers treat the password field normally;
// Enter is handled below, so never let it actually submit/reload.
document.getElementById('pw-form').addEventListener('submit', (e) => e.preventDefault());
pwSubmit.addEventListener('click', tryPw);
pwCancel.addEventListener('click', () => { Sound.click(); closePwModal(); });
pwInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryPw();
  if (e.key === 'Escape') closePwModal();
  pwErr.classList.remove('show');
});
pwModal.addEventListener('click', (e) => { if (e.target === pwModal) closePwModal(); });
// Keep keyboard focus inside the dialog while it's open.
pwModal.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [pwInput, pwCancel, pwSubmit];
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
});

// ---------------------------------------------------------------- load my .json

const fileInput = document.getElementById('json-input');
fileInput.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    JSON.parse(text);
    sessionStorage.setItem('pendingImportJSON', text);
    sessionStorage.setItem('pendingImportName', f.name);
    Sound.ok();
    navigate('arm.html?action=import', `Opening ${f.name}…`);
  } catch (err) {
    Sound.err();
    alert('That file is not valid JSON: ' + err.message);
    fileInput.value = '';
  }
});

// ---------------------------------------------------------------- code box → Arm Lab

document.getElementById('code-run').addEventListener('click', () => {
  sessionStorage.setItem('pendingScript', document.getElementById('code-input').value);
  sessionStorage.removeItem('pendingImportJSON');
  Sound.ok();
  navigate('arm.html?action=new&run=1', 'Opening the Arm Lab…');
});

// ---------------------------------------------------------------- action wiring

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'arm') {
    e.preventDefault();
    sessionStorage.removeItem('pendingImportJSON');
    Sound.ok();
    navigate('arm.html?action=new', 'Opening the Arm Lab…');
  } else if (action === 'drone') {
    e.preventDefault();
    Sound.ok();
    navigate('drone.html', 'Opening the drone…');
  } else if (action === 'dose') {
    e.preventDefault();
    Sound.click();
    openPwModal(el);
  } else if (action === 'load') {
    e.preventDefault();
    Sound.click();
    fileInput.click();
  }
});

// ---------------------------------------------------------------- live pieces

import('./ikToy.js').then(m => m.mountIKToy({
  canvas: document.getElementById('ik-toy'),
  speed: document.getElementById('ik-speed'),
  step: document.getElementById('ik-step'),
  status: document.getElementById('ik-status'),
  reduceMotion,
})).catch(err => console.error('[home] IK toy failed:', err));

import('./hero.js').then(m => m.mountHero({
  stage: document.getElementById('hero-stage'),
  readout: document.getElementById('hero-readout'),
  reduceMotion,
})).catch(err => {
  console.error('[home] hero failed:', err);
  const l = document.querySelector('#hero-stage .loading');
  if (l) l.textContent = 'The 3D arm needs WebGL, which this browser has turned off.';
});
