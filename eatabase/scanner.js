// Keep the decoder warm, but release the camera whenever Scan is hidden.

const VARIANTS = ['normal', 'invert', 'normal', 'histogram'];

function cameraError(cause) {
  const messages = {
    NotAllowedError: "Camera access was denied. Allow it in your browser's settings for this site, then try again.",
    NotFoundError: 'No camera found.',
    NotReadableError: 'The camera is busy. Close any other app using it, then try again.',
    OverconstrainedError: "This camera couldn't use the requested settings. Try again.",
    SecurityError: 'The camera needs the https:// address.',
  };
  const error = new Error(messages[cause?.name] || 'The camera could not start. Try again.');
  error.name = cause?.name || 'Error';
  return error;
}

export function createScanner({ container, onCode = () => {}, onError = () => {} }) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  if (!doc.querySelector('style[data-scn-style]')) {
    const style = doc.createElement('style');
    style.setAttribute('data-scn-style', '');
    style.textContent = `
      .scn-container { position:relative; overflow:hidden; background:var(--surface,#111); }
      .scn-video { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:block; width:100%; height:100%; object-fit:cover; max-width:none; max-height:none; visibility:visible; }
      .scn-container .scn-cover { position:absolute; inset:0; z-index:3; display:grid; place-items:center; background:var(--surface,#111); opacity:1; transition:opacity 180ms ease-in; pointer-events:none; }
      .scn-container .scn-cover[hidden] { display:none; }
      .scn-container .scn-cover.scn-revealing { opacity:0; }
      .scn-guide { box-sizing:content-box; position:absolute; left:50%; top:50%; width:72%; aspect-ratio:1; transform:translate(-50%,-50%); border:2px solid rgba(255,255,255,.55); border-radius:10px; transition:border-color .08s; pointer-events:none; }
      .scn-guide.scn-hit { border-color:#3ddc84; box-shadow:0 0 0 9999px #3ddc842e; }
      .scn-feedback-flash { position:absolute; inset:0; pointer-events:none; opacity:0; background:#3ddc84; }
      .scn-feedback-flash.scn-hit { animation:scn-flash 350ms ease-out both; }
      .scan-hint.scn-read { color:#3ddc84; }
      @keyframes scn-flash { 0% {opacity:.22} 100% {opacity:0} }
      @media(prefers-reduced-motion:reduce) {
        .scn-guide, .scn-feedback-flash { animation:none!important; transition:none!important; }
        .scn-feedback-flash.scn-hit { opacity:.12; }
      }
      .scn-container .scn-torch { position:absolute; top:12px; right:12px; width:44px; height:44px; min-width:44px; min-height:44px; border-radius:50%; border:0; background:rgba(0,0,0,.55); color:var(--text,#fff); display:flex; align-items:center; justify-content:center; padding:0; cursor:pointer; }
      .scn-container .scn-torch[aria-pressed="true"] { background:var(--text,#fff); color:var(--bg,#000); }
      .scn-container .scn-torch:focus-visible { outline:2px solid var(--text,#fff); outline-offset:3px; }
      .scn-container .scn-torch svg { width:22px; height:22px; }
    `;
    doc.head.append(style);
  }
  container.classList.add('scn-container');
  const video = doc.createElement('video');
  video.className = 'scn-video';
  // Inline dimensions and a continuously visible video avoid WebKit's stale
  // framing after restarts. Mask warmup with a sibling, not video visibility.
  video.style.width = '100%'; video.style.height = '100%';
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  for (const attr of ['playsinline', 'muted', 'autoplay']) video.setAttribute(attr, '');
  const guide = doc.createElement('div');
  guide.className = 'scn-guide';
  const flash = doc.createElement('div');
  flash.className = 'scn-feedback-flash';
  flash.setAttribute('aria-hidden', 'true');
  const torch = doc.createElement('button');
  torch.className = 'scn-torch';
  torch.type = 'button';
  torch.setAttribute('aria-label', 'Flash');
  torch.setAttribute('aria-pressed', 'false');
  torch.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>';
  const cover = doc.createElement('div');
  cover.className = 'scn-cover'; cover.hidden = true;
  cover.setAttribute('role', 'status'); cover.setAttribute('aria-label', 'Starting camera');
  cover.innerHTML = '<svg width="32" height="32" viewBox="0 0 40 40" class="step-loader" aria-hidden="true"><path d="M6 30h12V18h12V6" pathLength="1"/></svg>';
  container.append(video, flash, guide, torch, cover);
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let worker, stream, track, starting = null;
  let wanted = false, paused = false, torchOn = false, generation = 0;
  let pending = null, frameId = 0, lastCode = null, lastCodeAt = 0;
  let frameHandle = null, loopVersion = 0, lastTick = 0, watchdog = null;
  let cancelFirstFrame = null, flashTimer = null, feedbackHint = null;
  let cancelPreview = null, cancelReveal = null;
  const running = () => wanted && track?.readyState === 'live';
  const now = () => win.performance.now();

  function resetCover(show = false) {
    cover.style.transition = 'none'; cover.classList.remove('scn-revealing');
    cover.hidden = !show; container.setAttribute('aria-busy', String(show));
  }

  // Presentation callbacks can stall behind an opaque cover on iOS. Probe a
  // decoded frame independently, then allow a short period of stable layout.
  function waitForPreview(token) {
    return new Promise((resolve, reject) => {
      let paint = null, finished = false, stableSince = 0, seen = '';
      const probe = doc.createElement('canvas'); probe.width = probe.height = 1;
      const probeCtx = probe.getContext('2d');
      const dimensions = () => {
        const box = container.getBoundingClientRect(), v = video.getBoundingClientRect();
        return [video.videoWidth, video.videoHeight, box.width, box.height, v.width, v.height].map(Math.round).join(':');
      };
      const finish = error => {
        if (finished) return;
        finished = true; win.clearTimeout(deadline); win.clearInterval(poll);
        if (paint !== null) win.cancelAnimationFrame(paint);
        if (cancelPreview === cancel) cancelPreview = null;
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(new DOMException('Camera start was cancelled.', 'AbortError'));
      const deadline = win.setTimeout(() => finish(new Error('No decoded camera preview became available.')), 3000);
      const poll = win.setInterval(() => {
        if (!wanted || token !== generation) { cancel(); return; }
        let decoded = video.readyState >= 2 && video.videoWidth && video.videoHeight && !video.paused;
        if (decoded) {
          try { if (!probeCtx) throw new Error(); probeCtx.drawImage(video, 0, 0, 1, 1); }
          catch { decoded = false; }
        }
        const key = dimensions();
        if (!decoded) { stableSince = 0; seen = ''; return; }
        if (key !== seen) { seen = key; stableSince = now(); }
        if (now() - stableSince < 180 || paint !== null) return;
        paint = win.requestAnimationFrame(() => {
          paint = win.requestAnimationFrame(() => {
            paint = null;
            if (!wanted || token !== generation) { cancel(); return; }
            if (dimensions() !== seen) { seen = ''; stableSince = 0; return; }
            finish();
          });
        });
      }, 40);
      cancelPreview = cancel;
    });
  }

  function revealPreview(token) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = error => {
        if (finished) return;
        finished = true; win.clearTimeout(timer); cover.removeEventListener('transitionend', ended);
        if (cancelReveal === cancel) cancelReveal = null;
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(new DOMException('Camera start was cancelled.', 'AbortError'));
      const ended = event => { if (event.target === cover && event.propertyName === 'opacity') finish(); };
      const timer = win.setTimeout(() => finish(), 300);
      cancelReveal = cancel;
      if (!wanted || token !== generation) { cancel(); return; }
      cover.style.removeProperty('transition');
      void cover.offsetWidth;
      cover.addEventListener('transitionend', ended);
      cover.classList.add('scn-revealing');
    });
  }

  function grab() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2 || !ctx) return null;
    const box = container.getBoundingClientRect();
    const v = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
    if (!box.width || !box.height || !v.width || !v.height || !g.width || !g.height) return null;
    // The drawn guide is the decoded region, even when the video overflows.
    const r = { x: g.left - box.left, y: g.top - box.top, w: g.width, h: g.height };
    const scale = Math.max(v.width / vw, v.height / vh);
    const left = v.left + (v.width - vw * scale) / 2;
    const top = v.top + (v.height - vh * scale) / 2;
    const sx = (box.left + r.x - left) / scale, sw = r.w / scale;
    const sy = (box.top + r.y - top) / scale, sh = r.h / scale;
    const k = Math.min(1, 1000 / Math.max(sw, sh));
    canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
    if (!canvas.width || !canvas.height) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return { img: ctx.getImageData(0, 0, canvas.width, canvas.height), scale: k };
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(new URL('./scan-worker.js', import.meta.url));
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'error') {
        onError(new Error('The barcode reader could not read this frame. Try again.'));
        return;
      }
      if (data.type !== 'result' || data.id !== pending?.id) return;
      const current = pending.generation === generation;
      pending = null;
      if (!current || !running() || paused || !data.hit) return;
      const time = now();
      // Keep extending the window while the same pack remains in view.
      if (data.hit.text === lastCode && time - lastCodeAt < 2000) {
        lastCodeAt = time;
        return;
      }
      lastCode = data.hit.text; lastCodeAt = time;
      // Pause before scheduling delivery: even a different barcode cannot fire
      // while the confirmation is visible. stop() cancels delivery on navigation.
      pause();
      guide.classList.add('scn-hit');
      flash.classList.add('scn-hit');
      feedbackHint = container.parentElement?.querySelector('.scan-hint');
      if (feedbackHint) {
        feedbackHint.textContent = 'Barcode read';
        feedbackHint.classList.add('scn-read');
        feedbackHint.setAttribute('role', 'status');
        feedbackHint.setAttribute('aria-live', 'polite');
      }
      const token = generation;
      flashTimer = win.setTimeout(() => {
        flashTimer = null;
        resetFeedback();
        if (token !== generation || !running() || doc.hidden) return;
        if (feedbackHint) feedbackHint.textContent = 'Looking up product…';
        feedbackHint = null;
        onCode(data.hit.text, data.hit.format);
      }, 350);
    });
    worker.addEventListener('error', () => {
      pause();
      pending = null;
      onError(new Error('The barcode reader could not start. Try again.'));
      worker.terminate();
      worker = null;
    });
  }

  function cancelLoop() {
    loopVersion++;
    if (frameHandle !== null) {
      if (video.requestVideoFrameCallback) video.cancelVideoFrameCallback?.(frameHandle);
      else win.cancelAnimationFrame(frameHandle);
    }
    frameHandle = null;
  }
  function loop() {
    cancelLoop();
    if (!running() || paused) return;
    const version = loopVersion;
    lastTick = now();
    const next = () => {
      frameHandle = video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(tick) : win.requestAnimationFrame(tick);
    };
    function tick() {
      if (version !== loopVersion || !running() || paused) return;
      frameHandle = null;
      lastTick = now();
      if (!pending && worker) {
        try {
          const frame = grab();
          if (frame) {
            const { img, scale } = frame;
            const variant = VARIANTS[frameId % VARIANTS.length];
            pending = { id: ++frameId, generation };
            worker.postMessage({ id: frameId, buffer: img.data.buffer, width: img.width,
              height: img.height, rotate: true, upright: false, variant, scale,
              boxPx: Math.max(img.width, img.height) }, [img.data.buffer]);
          }
        } catch {
          pending = null;
          pause();
          onError(new Error('The camera frame could not be read. Try again.'));
        }
      }
      if (version === loopVersion && running() && !paused) next();
    }
    next();
  }

  function firstFrame() {
    return new Promise((resolve, reject) => {
      let callback = null, timer = null, settled = false;
      const deadline = now() + 10000;
      const finish = error => {
        if (settled) return;
        settled = true;
        win.clearTimeout(timer);
        if (callback !== null) video.cancelVideoFrameCallback?.(callback);
        cancelFirstFrame = null;
        error ? reject(error) : resolve();
      };
      cancelFirstFrame = () => {
        const error = new Error('Camera start was cancelled.');
        error.name = 'AbortError';
        finish(error);
      };
      if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(() => finish());
      // Safari can stall frame callbacks on a parked preview; a decoded frame
      // is still enough to finish warming the camera without hanging start().
      const check = () => {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) finish();
        else if (now() >= deadline) finish(new Error('No camera frame arrived.'));
        else timer = win.setTimeout(check, 50);
      };
      timer = win.setTimeout(check, video.requestVideoFrameCallback ? 3000 : 0);
    });
  }

  function updateTorch(on) {
    torchOn = on;
    torch.setAttribute('aria-pressed', String(on));
  }
  async function setTorch(on) {
    const target = track;
    try {
      if (!target || target.readyState !== 'live' || target.getCapabilities?.().torch === false) throw new Error();
      await target.applyConstraints({ advanced: [{ torch: !!on }] });
      if (target === track && wanted) updateTorch(!!on);
    } catch (cause) {
      if (target !== track || !wanted) return;
      updateTorch(false);
      const error = new Error("Flash isn't available on this camera.");
      error.name = cause?.name || 'Error';
      onError(error);
    }
  }
  torch.addEventListener('click', () => { void setTorch(!torchOn); });

  function start() {
    if (starting) return starting;
    if (running()) return Promise.resolve();
    cancelLoop();
    win.clearInterval(watchdog);
    watchdog = null;
    wanted = true;
    resetCover(true);
    const token = ++generation;
    const cancelled = () => token !== generation || !wanted;
    const operation = (async () => {
      let acquired;
      try {
        if (win.isSecureContext === false) {
          const error = new Error(); error.name = 'SecurityError'; throw error;
        }
        if (!win.navigator.mediaDevices?.getUserMedia) {
          const error = new Error(); error.name = 'NotFoundError'; throw error;
        }
        ensureWorker();
        acquired = await win.navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: 'environment' }, width: { ideal: 1920 },
          height: { ideal: 1080 }, frameRate: { ideal: 60 },
        } });
        if (cancelled()) { acquired.getTracks().forEach(t => t.stop()); return; }
        stream?.getTracks().forEach(t => t.stop());
        stream = acquired;
        track = stream.getVideoTracks()[0];
        video.srcObject = stream;
        await video.play();
        if (cancelled()) return;
        await firstFrame();
        if (cancelled()) return;
        const caps = track.getCapabilities?.() || {};
        if (caps.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        }
        if (cancelled()) return;
        if ((track.getSettings?.().frameRate || 0) < 50 && caps.frameRate?.max >= 59) {
          await track.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 },
            frameRate: { min: 50, ideal: 60 } }).catch(() => {});
        }
        if (cancelled()) return;
        if (caps.zoom) {
          // A refused zoom must not fail the whole start: 1× is iOS's default anyway.
          await track.applyConstraints({ advanced: [{ zoom: Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1)) }] }).catch(() => {});
        }
        if (cancelled()) return;
        await waitForPreview(token);
        if (cancelled()) return;
        await revealPreview(token);
        if (cancelled()) return;
        cover.hidden = true; container.setAttribute('aria-busy', 'false');
        loop();
        win.clearInterval(watchdog);
        watchdog = win.setInterval(() => {
          if (running() && !paused && doc.visibilityState === 'visible' && now() - lastTick > 1000) loop();
        }, 1000);
      } catch (cause) {
        acquired?.getTracks().forEach(t => t.stop());
        if (cancelled()) return;
        wanted = false;
        cancelPreview?.(); cancelReveal?.(); resetCover();
        track = null; stream = null; video.srcObject = null;
        updateTorch(false);
        cancelLoop();
        win.clearInterval(watchdog);
        const error = cameraError(cause);
        onError(error);
        throw error;
      }
    })();
    starting = operation.finally(() => { if (starting === promise) starting = null; });
    const promise = starting;
    return promise;
  }
  function resetFeedback() {
    win.clearTimeout(flashTimer);
    flashTimer = null;
    guide.classList.remove('scn-hit');
    flash.classList.remove('scn-hit');
    feedbackHint?.classList.remove('scn-read');
  }
  function pause() {
    paused = true;
    cancelLoop();
  }
  function resume() {
    // syncCamera() may resume an already-visible scanner during startup.
    // Keep the confirmation locked until its delayed callback has fired.
    if (flashTimer !== null) return;
    resetFeedback();
    paused = false;
    if (running()) { ensureWorker(); loop(); }
  }
  function stop() {
    wanted = false;
    generation++;
    starting = null;
    cancelFirstFrame?.();
    cancelPreview?.(); cancelReveal?.(); resetCover();
    cancelLoop();
    win.clearInterval(watchdog);
    watchdog = null;
    // Best effort explicit flash-off as well as stopping every track. Never wait
    // for constraints before releasing hardware (pagehide cannot await cleanup).
    if (track?.readyState === 'live') {
      try { void track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); } catch {}
    }
    stream?.getTracks().forEach(t => t.stop());
    video.pause();
    stream = null; track = null; video.srcObject = null;
    pending = null; lastCode = null; lastCodeAt = 0;
    paused = false;
    updateTorch(false);
    resetFeedback();
    if (feedbackHint?.isConnected) feedbackHint.textContent = 'Point at a barcode';
    feedbackHint = null;
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible' || !wanted) return;
    if (track?.readyState === 'ended') void start().catch(() => {});
    else { if (!paused && now() - lastTick > 1000) loop(); }
  });

  return { start, pause, resume, stop, setTorch,
    get torchOn() { return torchOn; },
    get running() { return !!running(); },
  };
}
