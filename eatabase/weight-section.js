import { status as weightStatus } from './ui.js';
// Cloned from Volume dashboard.html; persistence uses the shared store.
import * as store from './store.js';
import { parseKg } from './number-input.js';
import { relativeDayLabel } from './date-utils.js';
import { showToast } from './toast.js';
import { dailyValues, currentTrend, trendAsOf, hasEnoughHistory, DEFAULT_TREND_METHOD } from './weight-utils.js';
const attempt = async fn => { try { return { data: await fn(), error: null }; } catch (error) { return { data: null, error }; } };
const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./weight-section.css', import.meta.url); document.head.append(css);
document.getElementById('weight-section').innerHTML = `
      <p class="section-label">Bodyweight</p>

      <div class="weight-hero">
        <!-- Leads alone — this is the number worth looking at; the latest
             single reading lives in the log card below, the full trend
             chart on weight.html, one chevron away. -->
        <span class="stat-value lg" id="weight-average">—</span>
        <div class="label-row">
          <span class="stat-label" id="weight-average-label">Exponential moving average</span>
          <button type="button" class="info-btn" id="weight-trend-info-trigger" aria-label="How is this calculated?">?</button>
        </div>
        <span class="stat-change" id="weight-change"></span>
      </div>

      <p id="weight-empty" class="empty-state" hidden>No weight logged yet.</p>
      <div id="weight-error" class="status" role="status" aria-live="polite" hidden></div>

      <div class="list-item" id="weight-log-card" role="button" tabindex="0" hidden style="margin-top:var(--space-3);">
        <div class="list-item-body">
          <div class="list-item-name" id="weight-log-value">—</div>
          <div class="list-item-meta" id="weight-log-meta"></div>
        </div>
        <span class="list-item-chevron"><svg width="14" height="22" viewBox="0 0 14 22" fill="none" stroke="var(--text)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3 L11 11 L3 19"/></svg></span>
      </div>

      <button type="button" id="weight-quicklog-open">+ Log weight</button>

`;
document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="weight-trend-info-modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="weight-trend-info-title">Exponential moving average</h2>
        <button type="button" class="modal-close" id="weight-trend-info-close" aria-label="Close">&times;</button>
      </div>
      <p class="muted" id="weight-trend-info-body" style="font-size:var(--fs-base);line-height:1.5;"></p>
      <a href="./settings.html" class="nav-link" style="display:block;margin-top:var(--space-3);">Change in Settings</a>
    </div>
  </div>

  <!-- Quicklog: weight. Dashboard only — captures just the one number,
       always "right now", no date field. weight.html's own full form
       keeps free-text entry and a date/time for backdating a forgotten
       weigh-in; this is for the everyday "log today's reading" case. -->
  <div class="modal-backdrop" id="weight-quicklog-modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <h2>Log weight</h2>
        <button type="button" class="modal-close" id="weight-quicklog-close" aria-label="Close">&times;</button>
      </div>
      <input id="weight-quicklog-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Your weight in kg" hidden>
      <div class="stepper-row" id="weight-quicklog-stepper">
        <button type="button" class="stepper-btn" id="weight-quicklog-minus" aria-label="Decrease by 0.1 kg">&minus;</button>
        <div class="stepper-value"><span class="value" id="weight-quicklog-value">0.0<span class="unit">kg</span></span></div>
        <button type="button" class="stepper-btn" id="weight-quicklog-plus" aria-label="Increase by 0.1 kg">+</button>
      </div>
      <div id="weight-quicklog-status" class="status" role="status" aria-live="polite" hidden style="margin-top:var(--space-4);"></div>
      <button type="button" class="uppercase" id="weight-quicklog-save" style="margin-top:var(--space-5);">Save</button>
    </div>
  </div>

`);
    const HERO_TREND_LABEL = { ewma: 'Exponential moving average', sma: '7-day average' };
    const HERO_TREND_EXPLANATION = {
      ewma: 'Every new weigh-in blends into the running average. The most recent readings count the most, and each one before it counts a little less, fading out gradually instead of dropping off all at once. That keeps the number smooth even if you skip a few days between weigh-ins.',
      sma: 'This is a plain average of every weigh-in from the last 7 days. Go a week without logging and there’s nothing left in that window to average, so it shows "—" until a new reading starts it again.',
    };

    const weightAverage = document.getElementById('weight-average');
    const weightAverageLabel = document.getElementById('weight-average-label');
    const weightChange = document.getElementById('weight-change');
    const weightTrendInfoModal = document.getElementById('weight-trend-info-modal');
    const weightTrendInfoTitle = document.getElementById('weight-trend-info-title');
    const weightTrendInfoBody = document.getElementById('weight-trend-info-body');
    const weightEmpty = document.getElementById('weight-empty');
    const weightError = document.getElementById('weight-error');
    const weightLogCard = document.getElementById('weight-log-card');
    const weightLogValue = document.getElementById('weight-log-value');
    const weightLogMeta = document.getElementById('weight-log-meta');

    const weightQuicklogOpen = document.getElementById('weight-quicklog-open');
    const weightQuicklogModal = document.getElementById('weight-quicklog-modal');
    const weightQuicklogValue = document.getElementById('weight-quicklog-value');
    const weightQuicklogInput = document.getElementById('weight-quicklog-input');
    const weightQuicklogStepper = document.getElementById('weight-quicklog-stepper');
    const weightQuicklogMinus = document.getElementById('weight-quicklog-minus');
    const weightQuicklogPlus = document.getElementById('weight-quicklog-plus');
    const weightQuicklogStatus = document.getElementById('weight-quicklog-status');
    const weightQuicklogSave = document.getElementById('weight-quicklog-save');
    const COMPARE_DAYS = 14;
    const DAY_MS = 86400000;
    const STALE_AFTER_DAYS = 7;
    // Set once at boot from user_settings, read by loadWeight(). Defaults to
    // DEFAULT_TREND_METHOD if the row doesn't exist yet or the fetch errors.
    let trendMethod = DEFAULT_TREND_METHOD;

    /** "Today"/"Yesterday"/weekday/etc, per date-utils, plus the clock time if known. */
    function relativeWhen(entry) {
      const when = relativeDayLabel(entry.measured_at);
      if (!entry.time_known) return when;
      const d = new Date(entry.measured_at);
      return `${when}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    /** Past STALE_AFTER_DAYS, the log card grows a clock icon and the
        quicklog button turns --live amber — the two now do the whole job a
        separate banner used to do alone. */
    function isStaleReading(latest) {
      const days = Math.floor((Date.now() - new Date(latest.measured_at).getTime()) / DAY_MS);
      return days >= STALE_AFTER_DAYS;
    }
    const CLOCK_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L16 14"/></svg>';

    // Seeds the weight quicklog stepper without a separate fetch — set
    // whenever loadWeight() succeeds, read only when the popup opens.
    let latestWeightKg = null;

    async function loadWeight() {
      const { data: loaded, error } = await attempt(async () => {
        const [method, weights] = await Promise.all([store.getWeightTrendMethod(), store.listWeights()]);
        return { method, weights };
      });
      const data = loaded?.weights;
      if (loaded) trendMethod = loaded.method;
      weightAverageLabel.textContent = HERO_TREND_LABEL[trendMethod];
      weightTrendInfoTitle.textContent = HERO_TREND_LABEL[trendMethod];
      weightTrendInfoBody.textContent = HERO_TREND_EXPLANATION[trendMethod];

      // Weight is a separate feature bolted onto the bottom of this page —
      // if its table isn't there yet, the rest of the dashboard carries on.
      if (error || !data || data.length === 0) {
        weightAverage.textContent = '—';
        weightAverage.classList.remove('live');
        weightChange.textContent = '';
        weightLogCard.hidden = true;
        weightQuicklogOpen.classList.remove('live');
        // A failed load isn't "no weight logged" — say which it is.
        weightEmpty.hidden = Boolean(error);
        if (error) weightStatus('weight-error', 'Couldn\u2019t load your weight. Check your connection and reopen the page.', 'error', loadWeight);
        else hide(weightError);
        return;
      }
      weightEmpty.hidden = true;
      hide(weightError);

      const latest = data[data.length - 1];
      latestWeightKg = Number(latest.weight_kg);

      const stale = isStaleReading(latest);
      weightLogValue.textContent = `${Number(latest.weight_kg).toFixed(1)} kg`;
      weightLogMeta.innerHTML = stale ? CLOCK_ICON : '';
      weightLogMeta.appendChild(document.createTextNode(relativeWhen(latest)));
      weightLogCard.hidden = false;
      weightQuicklogOpen.classList.toggle('live', stale);

      const now = Date.now();
      const daily = dailyValues(data);
      const trendNow = currentTrend(daily, trendMethod);
      const trendThen = trendAsOf(daily, now - COMPARE_DAYS * DAY_MS, trendMethod);
      // A trend over less than 7 days of actual history isn't honest yet —
      // weight.html has always gated on this; this page never did until now.
      const enoughHistoryForTrend = hasEnoughHistory(daily, now);
      weightAverageLabel.textContent = HERO_TREND_LABEL[trendMethod];
      weightTrendInfoTitle.textContent = HERO_TREND_LABEL[trendMethod];
      weightTrendInfoBody.textContent = HERO_TREND_EXPLANATION[trendMethod];
      // The change sits under the trend because that's what it measures —
      // comparing single readings would mostly measure yesterday's dinner.
      const showTrend = enoughHistoryForTrend && trendNow !== null;
      weightAverage.innerHTML = showTrend ? `${trendNow.toFixed(1)}<span class="unit">kg</span>` : '—';
      weightAverage.classList.toggle('live', showTrend);
      if (!enoughHistoryForTrend || trendNow === null || trendThen === null) {
        weightChange.textContent = '';
      } else {
        const diff = trendNow - trendThen;
        const sign = diff >= 0 ? '+' : '−';
        weightChange.textContent = Math.abs(diff) < 0.05
          ? `steady vs ${COMPARE_DAYS} days ago`
          : `${sign}${Math.abs(diff).toFixed(1)} kg vs ${COMPARE_DAYS} days ago`;
      }
    }

    // Log card absorbs what "All entries" used to do as a separate button —
    // tap the row itself to reach the full history.
    const goToWeightHistory = () => { window.location.href = './weight.html'; };
    weightLogCard.addEventListener('click', goToWeightHistory);
    weightLogCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToWeightHistory(); }
    });

    // ---- Quicklog: weight — stepper only, no free text, no date field.
    // Always means "right now"; weight.html's own form covers backdating.
    let weightQuicklogValueKg = 0;
    function paintWeightQuicklog() {
      weightQuicklogValue.firstChild.textContent = weightQuicklogValueKg.toFixed(1);
    }
    // First-ever weigh-in: no reading to step from, so a made-up starting
    // value would be saved as real data — type it instead. Same range check
    // as weight.html's own add form (parseWeight()).
    function parseTypedWeight(raw) {
      const value = parseKg(raw);
      if (String(raw).trim() === '' || !isFinite(value)) return null;
      const rounded = Math.round(value * 10) / 10;
      return isSaneWeight(rounded) ? rounded : null;
    }
    // The database only accepts 20 < kg < 500; checked on the rounded value
    // that actually gets saved, typed or stepped.
    function isSaneWeight(kg) {
      return kg > 20 && kg < 500;
    }
    let weightQuicklogTyped = false;
    weightQuicklogInput.addEventListener('input', () => {
      weightQuicklogSave.disabled = parseTypedWeight(weightQuicklogInput.value) === null;
    });
    weightQuicklogOpen.addEventListener('click', () => {
      weightQuicklogTyped = latestWeightKg === null;
      weightQuicklogStepper.hidden = weightQuicklogTyped;
      weightQuicklogInput.hidden = !weightQuicklogTyped;
      if (weightQuicklogTyped) {
        weightQuicklogInput.value = '';
      } else {
        weightQuicklogValueKg = latestWeightKg;
        paintWeightQuicklog();
      }
      hide(weightQuicklogStatus);
      weightQuicklogSave.disabled = weightQuicklogTyped;
      weightQuicklogSave.textContent = 'Save';
      openModal(weightQuicklogModal);
    });
    document.getElementById('weight-quicklog-close').addEventListener('click', () => closeModal(weightQuicklogModal));
    weightQuicklogMinus.addEventListener('click', () => {
      weightQuicklogValueKg = Math.round((weightQuicklogValueKg - 0.1) * 10) / 10;
      paintWeightQuicklog();
    });
    weightQuicklogPlus.addEventListener('click', () => {
      weightQuicklogValueKg = Math.round((weightQuicklogValueKg + 0.1) * 10) / 10;
      paintWeightQuicklog();
    });
    weightQuicklogSave.addEventListener('click', async () => {
      hide(weightQuicklogStatus);
      if (weightQuicklogTyped) {
        const typed = parseTypedWeight(weightQuicklogInput.value);
        if (typed === null) { show(weightQuicklogStatus, 'error', 'Enter a weight in kg, e.g. 80.5'); return; }
        weightQuicklogValueKg = typed;
      } else if (!isSaneWeight(weightQuicklogValueKg)) {
        show(weightQuicklogStatus, 'error', 'That does not look like a bodyweight in kg.');
        return;
      }
      weightQuicklogSave.disabled = true;
      weightQuicklogSave.textContent = 'Saving…';

      const { error } = await attempt(() => store.addWeight({ kg: weightQuicklogValueKg, measuredAt: new Date().toISOString() }));

      weightQuicklogSave.disabled = false;
      weightQuicklogSave.textContent = 'Save';

      if (error) {
        show(weightQuicklogStatus, 'error', `Could not save: ${error.message}`);
        return;
      }

      closeModal(weightQuicklogModal);
      flash(`Logged ${weightQuicklogValueKg.toFixed(1)} kg.`);
      await loadWeight();
    });
function show(el, kind, message) { el.className = `status ${kind}`; el.textContent = message; el.hidden = false; }
function hide(el) { el.hidden = true; }
function flash(message) { showToast(message, 'ok'); }
function openModal(el) { el.hidden = false; }
function closeModal(el) { el.hidden = true; }
for (const el of [weightTrendInfoModal, weightQuicklogModal]) el.addEventListener('click', e => { if (e.target === el) closeModal(el); });
document.getElementById('weight-trend-info-trigger').onclick = () => openModal(weightTrendInfoModal);
document.getElementById('weight-trend-info-close').onclick = () => closeModal(weightTrendInfoModal);
await loadWeight();
