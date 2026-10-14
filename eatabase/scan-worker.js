// Barcode decoding off the main thread, so the camera preview never stutters.
// zxing-cpp compiled to WebAssembly (vendor/), loaded the moment the page opens.
importScripts('./vendor/zxing_reader.js');

const ready = ZXingWASM.prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => path.endsWith('.wasm') ? new URL('./vendor/zxing_reader.wasm', self.location).href : prefix + path,
  },
  fireImmediately: true,
});

// Food packaging only carries these; asking for fewer formats = faster.
const BASE = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
  tryHarder: true,     // copes with slight blur/angle; still ~1 ms on the cropped box
  tryRotate: false,    // per frame: the page asks for rotation where upright bars are possible
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

// Decoding takes ~1 ms but frames arrive every ~16 ms, so the page rotates
// through extra approaches on some frames, for free:
//   normal    — the default: black/white judged area by area
//   invert    — light bars on a dark background (pixels flipped here: zxing's own
//               tryInvert has no effect on EAN/UPC in this build, tested)
//   histogram — one black/white threshold for the whole box; can win on glare / faint print
const VARIANTS = {
  normal: {},
  invert: {},
  histogram: { binarizer: 'GlobalHistogram' },
};

ready.then(() => postMessage({ type: 'ready' }));

onmessage = async ({ data }) => {
  await ready;
  const t0 = performance.now();
  const img = new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height);
  const opts = { ...BASE, tryRotate: !!data.rotate };
  let hit = null, normalAlso = null;
  try {
    let src = img;
    if (data.variant === 'invert') {
      src = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      const p = src.data;
      for (let i = 0; i < p.length; i += 4) { p[i] = 255 - p[i]; p[i + 1] = 255 - p[i + 1]; p[i + 2] = 255 - p[i + 2]; }
    }
    const [r] = await ZXingWASM.readBarcodes(src, { ...opts, ...VARIANTS[data.variant || 'normal'] });
    if (r && r.isValid) hit = { text: r.text, format: r.format, orientation: r.orientation, position: r.position };
    // An extra approach found it: would the plain one have, on this very frame?
    // Tells us (in the logs) whether the extras ever actually rescue a scan.
    if (hit && data.variant && data.variant !== 'normal') {
      const [n] = await ZXingWASM.readBarcodes(img, opts);
      normalAlso = !!(n && n.isValid && n.text === hit.text);
    }
  } catch (e) {
    postMessage({ type: 'error', message: String(e) });
  }
  postMessage({ type: 'result', id: data.id, hit, variant: data.variant || 'normal', normalAlso, upright: data.upright, scale: data.scale, boxPx: data.boxPx, ms: performance.now() - t0 });
};
