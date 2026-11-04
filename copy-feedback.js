// Shared by Weight import and Eatabase connector setup.
export function copyButtonMarkup(label) {
  return `<button class="icon-link import-copy-button" type="button" aria-label="${label}" title="${label}"><span class="import-copy-fill" aria-hidden="true"></span><svg class="import-copy-original" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg><svg class="import-copy-check" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M5 12.5 9.5 17 19 7"/></svg></button>`;
}

export function createCopyFeedback(button, announcement, label) {
  let importCopyAnimations = [];
  let importCopyRun = 0;
  function resetImportCopyFeedback() {
    importCopyRun++;
    importCopyAnimations.forEach(animation => animation.cancel());
    importCopyAnimations = [];
    button.setAttribute('aria-label', label);
    if (announcement) announcement.textContent = '';
  }
  function playImportCopyFeedback() {
    resetImportCopyFeedback();
    const run = importCopyRun;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Approved draft: Pop / Draw / Snappy, 180ms in, 900ms hold, 260ms out.
    const enter = reduced ? 1 : 180;
    const exit = reduced ? 1 : 260;
    const duration = enter + 900 + exit;
    const at = enter / duration, until = (enter + 900) / duration;
    const easing = 'cubic-bezier(0.16,1,0.3,1)';
    const frames = (initial, shown, final = initial) => [
      { ...initial, offset: 0, easing }, { ...shown, offset: at },
      { ...shown, offset: until, easing }, { ...final, offset: 1 },
    ];
    const animate = (selector, keyframes) => {
      const animation = button.querySelector(selector)
        .animate(keyframes, { duration, fill: 'both' });
      importCopyAnimations.push(animation);
    };
    animate('.import-copy-fill', frames({ opacity: 0 }, { opacity: 1 }));
    animate('.import-copy-original', frames({ opacity: 1 }, { opacity: 0 }));
    animate('.import-copy-check', reduced
      ? frames({ opacity: 0 }, { opacity: 1 })
      : [
        { opacity: 0, transform: 'scale(0.65)', offset: 0, easing },
        { opacity: 1, transform: 'scale(1.13)', offset: at * 0.7 },
        { opacity: 1, transform: 'scale(1)', offset: at },
        { opacity: 1, transform: 'scale(1)', offset: until, easing },
        { opacity: 0, transform: 'scale(0.9)', offset: 1 },
      ]);
    if (!reduced) animate('.import-copy-check path',
      frames({ strokeDashoffset: 1 }, { strokeDashoffset: 0 }, { strokeDashoffset: 0 }));
    button.setAttribute('aria-label', 'Copied');
    if (announcement) announcement.textContent = 'Copied';
    Promise.all(importCopyAnimations.map(animation => animation.finished)).then(() => {
      if (run === importCopyRun) resetImportCopyFeedback();
    }).catch(() => {}); // Repeated copying cancels the previous animation.
  }

  return { play: playImportCopyFeedback, reset: resetImportCopyFeedback };
}

// Keep the compatibility copy target off-screen; never select the visible prompt.
export async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return true; } catch {}
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({length:selection.rangeCount}, (_,i) => selection.getRangeAt(i).cloneRange()) : [];
  const target = Object.assign(document.createElement('textarea'), {value, readOnly:true, tabIndex:-1});
  target.setAttribute('aria-hidden','true');
  target.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none';
  document.body.appendChild(target);
  let copied = false;
  try {
    target.focus({preventScroll:true});
    target.select();
    target.setSelectionRange(0,value.length);
    copied = document.execCommand('copy');
  } catch {} finally {
    target.remove();
    if (active && active.isConnected) active.focus({preventScroll:true});
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
  return copied;
}
