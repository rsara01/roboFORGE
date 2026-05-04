// Tiny loading overlay shared by index.html and drone.html. Created
// programmatically so it sits above everything; fades out when the page
// signals it's ready via Loading.hide(). The overlay uses the brand
// gradient + the small logo mark so it feels consistent across pages.

const STYLE_ID = 'rf-loading-style';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    #rf-loading {
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 18px;
      background: linear-gradient(135deg, var(--accent, #667eea) 0%, var(--accent-2, #764ba2) 100%);
      z-index: 99999;
      transition: opacity 0.35s ease, visibility 0.35s ease;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #rf-loading.gone { opacity: 0; visibility: hidden; pointer-events: none; }
    #rf-loading .logo-wrap {
      width: 120px; height: 120px;
      background: rgba(255,255,255,0.92);
      border-radius: 22px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.3);
      padding: 10px;
      display: flex; align-items: center; justify-content: center;
      animation: rfPulse 1.6s ease-in-out infinite;
    }
    #rf-loading .logo-wrap img { width: 100%; height: 100%; object-fit: contain; }
    #rf-loading .label { font-size: 14px; letter-spacing: 0.6px; opacity: 0.9; }
    #rf-loading .bar {
      width: 200px; height: 4px;
      background: rgba(255,255,255,0.22);
      border-radius: 2px; overflow: hidden;
    }
    #rf-loading .bar > i {
      display: block; height: 100%; width: 40%;
      background: white;
      animation: rfSlide 1.1s ease-in-out infinite;
    }
    @keyframes rfPulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.05); }
    }
    @keyframes rfSlide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
  `;
  document.head.appendChild(s);
}

function build(label) {
  injectStyles();
  const el = document.createElement('div');
  el.id = 'rf-loading';
  el.innerHTML = `
    <div class="logo-wrap"><img src="assets/logo-mark.svg" alt="RoboForge" /></div>
    <div class="label">${label || 'Loading simulator…'}</div>
    <div class="bar"><i></i></div>
  `;
  document.body.appendChild(el);
  return el;
}

export const Loading = {
  show(label) {
    if (document.getElementById('rf-loading')) return;
    if (document.body) build(label);
    else document.addEventListener('DOMContentLoaded', () => build(label), { once: true });
  },
  hide(extraDelayMs = 0) {
    const el = document.getElementById('rf-loading');
    if (!el) return;
    setTimeout(() => {
      el.classList.add('gone');
      setTimeout(() => el.remove(), 400);
    }, extraDelayMs);
  },
};

// Auto-show as soon as imported so we cover the initial render gap.
Loading.show();
