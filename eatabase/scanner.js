// Keep the decoder warm, but release the camera whenever Scan is hidden.

const VARIANTS = ['normal', 'invert', 'normal', 'histogram'];

function cameraError(cause) {
  const messages = {
    NotAllowedError: "Camera access was denied. Allow it in Safari's settings for this site, then try again.",
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
      .scn-video { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:block; width:100%; height:100%; object-fit:cover; max-width:none; max-height:none; visibility:hidden; }
      .scn-video.scn-fit { visibility:visible; }
      .scn-guide { box-sizing:content-box; position:absolute; left:50%; top:50%; width:72%; aspect-ratio:1; transform:translate(-50%,-50%); border:2px solid rgba(255,255,255,.55); border-radius:10px; transition:border-color .08s; pointer-events:none; }
      .scn-guide.scn-hit { border-color:#3ddc84; box-shadow:0 0 0 9999px rgba(61,220,132,.18); }
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
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  for (const attr of ['playsinline', 'muted', 'autoplay']) video.setAttribute(attr, '');
  const guide = doc.createElement('div');
  guide.className = 'scn-guide';
  const torch = doc.createElement('button');
  torch.className = 'scn-torch';
  torch.type = 'button';
  torch.setAttribute('aria-label', 'Flash');
  torch.setAttribute('aria-pressed', 'false');
  torch.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>';
  container.append(video, guide, torch);
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let worker, stream, track, starting = null;
  let wanted = false, paused = false, torchOn = false, generation = 0;
  let pending = null, frameId = 0, lastCode = null, lastCodeAt = 0;
  let frameHandle = null, loopVersion = 0, lastTick = 0, watchdog = null;
  let cancelFirstFrame = null, flashTimer = null;
  let fitW = 0, fitH = 0, fitBoxW = -1, fitBoxH = -1;
  const running = () => wanted && track?.readyState === 'live';
  const now = () => win.performance.now();

  // The feed stays hidden until it's sized to cover the box for the stream's
  // CURRENT dimensions: iOS can paint a frame at a new size (e.g. portrait
  // after landscape) before the resize event, which showed as black bars.
  let revealFrame = null;
  function hideVideo() {
    video.classList.remove('scn-fit');
    if (revealFrame !== null) win.cancelAnimationFrame(revealFrame);
    revealFrame = null;
  }
  function revealWhenStable() {
    if (revealFrame !== null) win.cancelAnimationFrame(revealFrame);
    let seenW = 0, seenH = 0, steady = 0;
    const check = () => {
      revealFrame = null;
      if (!video.srcObject) return;
      fitVideo();
      if (revealFrame !== null) return;   // fitVideo saw new dimensions and restarted this check
      const vw = video.videoWidth, vh = video.videoHeight;
      steady = vw && vh && vw === seenW && vh === seenH && vw === fitW && vh === fitH ? steady + 1 : 0;
      seenW = vw; seenH = vh;
      if (steady >= 2) video.classList.add('scn-fit');
      else revealFrame = win.requestAnimationFrame(check);
    };
    revealFrame = win.requestAnimationFrame(check);
  }
  function fitVideo() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const box = container.getBoundingClientRect();
    if (!vw || !vh || !box.width || !box.height) return;
    if (fitW && (vw !== fitW || vh !== fitH)) { hideVideo(); revealWhenStable(); }
    if (vw === fitW && vh === fitH && box.width === fitBoxW && box.height === fitBoxH) return;
    fitW = vw; fitH = vh; fitBoxW = box.width; fitBoxH = box.height;
    // CSS object-fit crops every painted frame, including iOS orientation changes
    // that arrive before the video's resize event. No stale pixel dimensions.
  }
  video.addEventListener('resize', fitVideo);
  video.addEventListener('loadedmetadata', fitVideo);
  win.addEventListener('resize', fitVideo);
  const observer = win.ResizeObserver ? new win.ResizeObserver(fitVideo) : null;
  observer?.observe(container);

  function grab() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2 || !ctx) return null;
    fitVideo();
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
      guide.classList.add('scn-hit');
      win.clearTimeout(flashTimer);
      flashTimer = win.setTimeout(() => guide.classList.remove('scn-hit'), 350);
      onCode(data.hit.text, data.hit.format);
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
        hideVideo(); fitW = fitH = 0;
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
        fitVideo();
        revealWhenStable();
        loop();
        win.clearInterval(watchdog);
        watchdog = win.setInterval(() => {
          if (running() && !paused && doc.visibilityState === 'visible' && now() - lastTick > 1000) loop();
        }, 1000);
      } catch (cause) {
        acquired?.getTracks().forEach(t => t.stop());
        if (cancelled()) return;
        wanted = false;
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
  function pause() {
    paused = true;
    cancelLoop();
  }
  function resume() {
    paused = false;
    fitVideo();
    if (running()) { ensureWorker(); loop(); }
  }
  function stop() {
    wanted = false;
    generation++;
    starting = null;
    cancelFirstFrame?.();
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
    hideVideo(); fitW = fitH = 0;
    paused = false;
    updateTorch(false);
    win.clearTimeout(flashTimer);
    guide.classList.remove('scn-hit');
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible' || !wanted) return;
    if (track?.readyState === 'ended') void start().catch(() => {});
    else { fitVideo(); if (!paused && now() - lastTick > 1000) loop(); }
  });

  return { start, pause, resume, stop, setTorch,
    get torchOn() { return torchOn; },
    get running() { return !!running(); },
  };
}
