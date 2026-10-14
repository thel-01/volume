import { status as weightStatus } from './ui.js';
// Cloned from Volume weight.html; persistence uses the shared store.

    import * as store from './store.js';
    const attempt = async fn => { try { return { data: await fn(), error: null }; } catch (error) { return { data: null, error }; } };
    import { renderLineChart } from './chart.js';
    import { parseKg } from './number-input.js';
    import { mondayOf, relativeDayLabel } from './date-utils.js';
    import { showToast } from './toast.js';
    import {
      dailyValues, trendSeries, currentTrend, trendAsOf, hasEnoughHistory,
      personalizedNoiseBand, genericNoiseBand,
      DEFAULT_TREND_METHOD, TREND_WARMUP_DAYS,
    } from './weight-utils.js';


    // Spelled out in full, same copy as dashboard.html's hero card — this
    // used to stay on weight-utils.js's shorter TREND_LABEL ("trend"), but
    // that's no longer true; only the chart legend below still stays short.
    const HERO_TREND_LABEL = { ewma: 'Exponential moving average', sma: '7-day average' };
    const HERO_TREND_EXPLANATION = {
      ewma: 'Every new weigh-in blends into the running average. The most recent readings count the most, and each one before it counts a little less, fading out gradually instead of dropping off all at once. That keeps the number smooth even if you skip a few days between weigh-ins.',
      sma: 'This is a plain average of every weigh-in from the last 7 days. Go a week without logging and there’s nothing left in that window to average, so it shows "—" until a new reading starts it again.',
    };
    // Chart-legend only — stays short on purpose (it's a swatch caption, not
    // a stat label). "Average" rather than weight-utils.js's own "trend" for
    // EWMA specifically; the SMA wording was already this.
    const LEGEND_LABEL = { ewma: 'Average', sma: '7-day average' };

    // Daily Noise modal copy — plain-language, and deliberately tells the
    // user which case they're in (their own history vs. a population
    // estimate) rather than presenting both the same way.
    const NOISE_EXPLANATION_PERSONALIZED = 'We looked at your last 45 days of readings and figured out how much your weight normally bounces around from one day to the next, just from water and food. If a new reading falls inside this range, it’s likely just noise.';
    const NOISE_EXPLANATION_GENERIC = 'This is a general estimate from published research on typical day-to-day weight changes. Keep weighing in regularly and we will give you a number based on your own data.';

    // Bodyweight swings a kilo or more day to day on food and water alone, so
    // a single reading says very little. The trend line smooths past that —
    // see weight-utils.js for the maths (EWMA by default, or the old 7-day
    // average if switched back in Settings). 14 days is far enough back for
    // the "vs N days ago" comparison to mean something without being ancient
    // history.
    const COMPARE_DAYS = 14;
    const DAY_MS = 86400000;
    // Set once at boot from user_settings, read by render(). Defaults to
    // DEFAULT_TREND_METHOD if the row doesn't exist yet or the fetch errors —
    // a nicety, not the point of the page, same as this app's other
    // best-effort boot lookups.
    let trendMethod = DEFAULT_TREND_METHOD;
    // Roughly "about a week", per the standing rule that a stale reading
    // shouldn't just sit there looking current.
    const STALE_AFTER_DAYS = 7;

    // Chart date-range picker. The default (3 months) matches the dashboard
    // preview so the two never disagree about "the recent trend" — the wider
    // windows only exist here, where there's room for a whole history view.
    const DEFAULT_WINDOW_DAYS = 91;
    const WINDOW_OPTIONS = [
      { key: '4w', label: '4W', days: 28 },
      { key: '3m', label: '3M', days: 91 },
      { key: '6m', label: '6M', days: 182 },
      { key: '12m', label: '12M', days: 365 },
    ];
    // 'max' or a WINDOW_OPTIONS key. Chosen once (on first render, from the
    // data at hand) and remembered across re-renders so editing an entry
    // doesn't snap the chart back to the default.
    let chartWindow = null;

    // ------------------------------------------------------------------
    // Element refs
    // ------------------------------------------------------------------
    const topStatus = document.getElementById('top-status');
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    const currentWeight = document.getElementById('current-weight');
    const currentLabel = document.getElementById('current-label');
    const currentWhen = document.getElementById('current-when');
    const averageWeight = document.getElementById('average-weight');
    const averageWeightLabel = document.getElementById('average-weight-label');
    const weightTrendInfoTrigger = document.getElementById('weight-trend-info-trigger');
    const weightTrendInfoModal = document.getElementById('weight-trend-info-modal');
    const weightTrendInfoClose = document.getElementById('weight-trend-info-close');
    const weightTrendInfoTitle = document.getElementById('weight-trend-info-title');
    const weightTrendInfoBody = document.getElementById('weight-trend-info-body');
    const trendChange = document.getElementById('trend-change');
    const chart = document.getElementById('chart');
    const chartCard = document.getElementById('chart-card');
    const chartEmpty = document.getElementById('chart-empty');
    chartEmpty.textContent = `Your trend line appears after ${TREND_WARMUP_DAYS} days of weigh-ins.`;
    const chartWindowRow = document.getElementById('chart-window-row');
    const windowChangeEl = document.getElementById('window-change');
    const legend = document.getElementById('legend');
    const noiseRow = document.getElementById('noise-row');
    const noiseText = document.getElementById('noise-text');
    const noiseInfoTrigger = document.getElementById('noise-info-trigger');
    const noiseInfoModal = document.getElementById('noise-info-modal');
    const noiseInfoClose = document.getElementById('noise-info-close');
    const noiseInfoBody = document.getElementById('noise-info-body');
    const staleNotice = document.getElementById('stale-notice');
    const addToggle = document.getElementById('add-toggle');
    const addForm = document.getElementById('add-form');
    const newWeight = document.getElementById('new-weight');
    const whenToggle = document.getElementById('when-toggle');
    const whenFields = document.getElementById('when-fields');
    const newDate = document.getElementById('new-date');
    const newTime = document.getElementById('new-time');
    const addCancel = document.getElementById('add-cancel');
    const addSave = document.getElementById('add-save');
    const addStatus = document.getElementById('add-status');
    const entryList = document.getElementById('entry-list');
    const emptyEntries = document.getElementById('empty-entries');

    let entries = [];          // newest first
    let editingId = null;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    const STATUS_ICONS = {
      ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13 L10 19 L20 5"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L22 20 H2 Z"/><line x1="12" y1="9" x2="12" y2="14.5"/><circle cx="12" cy="17.2" r="0.9" fill="var(--danger)" stroke="none"/></svg>',
    };
    function show(el, kind, message) {
      el.className = `status ${kind}`;
      el.innerHTML = STATUS_ICONS[kind] || '';
      el.appendChild(document.createTextNode(message));
      el.hidden = false;
    }
    function hide(el) { el.hidden = true; }
    // Floats above the page instead of pushing it down — show()/hide() above
    // stay as-is for the load-time #top-status error, a different, blocking
    // case that isn't this. Signature dropped its `el` param (always
    // topStatus in practice) to match every other page's flash().
    function flash(message, kind = 'ok', ms = 3000) {
      showToast(message, kind, { ms });
    }
    const fmtKg = (v) => Number(v).toFixed(1);

    function formatEntryWhen(entry) {
      const d = new Date(entry.measured_at);
      const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      // A reading typed in from an old note has no clock time. Showing one
      // anyway would be presenting a guess as a fact.
      if (!entry.time_known) return date;
      return `${date}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    /** "Today"/"Yesterday"/weekday/etc, per date-utils, plus the clock time if known. */
    function relativeWhen(entry) {
      const when = relativeDayLabel(entry.measured_at);
      if (!entry.time_known) return when;
      const d = new Date(entry.measured_at);
      return `${when}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    /** Same buckets the session history uses, so the two lists read alike. */
    function bucketEntries(list) {
      const now = new Date();
      const thisMonday = mondayOf(now);
      const thisWeekEnd = new Date(thisMonday);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);
      const thisYear = now.getFullYear();

      const labelFor = (e) => {
        const d = new Date(e.measured_at);
        if (d >= thisMonday && d < thisWeekEnd) return 'This week';
        if (d >= lastMonday && d < thisMonday) return 'Last week';
        if (d.getFullYear() === thisYear) return 'Earlier';
        return String(d.getFullYear());
      };

      const buckets = [];
      const byLabel = new Map();
      for (const e of list) {
        const label = labelFor(e);
        if (!byLabel.has(label)) {
          const bucket = { label, entries: [] };
          byLabel.set(label, bucket);
          buckets.push(bucket);
        }
        byLabel.get(label).entries.push(e);
      }
      return buckets;
    }

    /** Per-entry label — always the true day-diff-based relative label, regardless of which section it's grouped under. */
    function formatEntryInBucket(entry) {
      const when = relativeDayLabel(entry.measured_at);
      if (!entry.time_known) return when;
      const d = new Date(entry.measured_at);
      return `${when}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }
    function formatCompactDate(iso, showYear) {
      const d = new Date(iso);
      const base = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return showYear ? `${base} '${String(d.getFullYear()).slice(-2)}` : base;
    }

    /** Local date/time inputs -> a UTC instant. */
    function toInstant(dateStr, timeStr) {
      return new Date(`${dateStr}T${timeStr}`);
    }
    function localDateValue(d) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    function localTimeValue(d) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /**
     * Which window buttons are worth showing, given the actual history span.
     * A window only earns a button if picking it would actually hide some
     * data compared to "Max" — offering a "12M" button when you've only ever
     * logged for 6 weeks would just be a second button that does the same
     * thing as the one next to it.
     */
    function chartWindowChoices(ascending) {
      if (ascending.length === 0) return { options: [], totalSpanDays: 0 };
      const totalSpanDays = (Date.now() - new Date(ascending[0].measured_at).getTime()) / DAY_MS;
      const options = WINDOW_OPTIONS.filter((o) => totalSpanDays > o.days);
      return { options, totalSpanDays };
    }

    function filterByWindow(points, key) {
      if (key === 'max') return points;
      const opt = WINDOW_OPTIONS.find((o) => o.key === key);
      if (!opt) return points;
      const cutoff = Date.now() - opt.days * DAY_MS;
      return points.filter((p) => new Date(p.date).getTime() >= cutoff);
    }

    function renderChartWindowButtons(options, current) {
      chartWindowRow.innerHTML = '';
      // Nothing to trim yet — the chart already shows everything you have,
      // so a row of buttons that all do the same thing would just be noise.
      if (options.length === 0) {
        chartWindowRow.hidden = true;
        return;
      }
      chartWindowRow.hidden = false;
      const all = [...options, { key: 'max', label: 'Max' }];
      for (const opt of all) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `chip${opt.key === current ? ' selected' : ''}`;
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          if (chartWindow === opt.key) return;
          chartWindow = opt.key;
          render();
        });
        chartWindowRow.appendChild(btn);
      }
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    /** Nudges you to log a fresh reading once the latest one is about a week old.
        Two signals, same threshold: the banner above the button, and the
        button itself going --live amber. */
    function renderStaleNotice(latest) {
      const days = Math.floor((Date.now() - new Date(latest.measured_at).getTime()) / DAY_MS);
      const stale = days >= STALE_AFTER_DAYS;
      addToggle.classList.toggle('live', stale);
      if (!stale) {
        staleNotice.hidden = true;
        return;
      }
      staleNotice.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L16 14"/></svg>';
      staleNotice.appendChild(document.createTextNode(`No reading in ${days} days. Tap to log one.`));
      staleNotice.hidden = false;
    }

    /**
     * Drops the caption to a smaller size, but only if it actually wrapped
     * to a second line at the normal size — most phones never trigger this,
     * it's a fallback for the narrower ones with the longer (generic) copy.
     * Must run after the row is unhidden — a hidden element measures 0.
     */
    function fitNoiseLine() {
      noiseText.classList.remove('compact');
      const lineHeightPx = parseFloat(getComputedStyle(noiseText).lineHeight);
      if (noiseText.scrollHeight > lineHeightPx * 1.5) {
        noiseText.classList.add('compact');
      }
    }

    /**
     * Personalized when the density gate passes (enough recent, regular
     * readings), otherwise a population-average fallback — never nothing,
     * as long as there's a trend value to hang either one on. Called
     * BEFORE render()'s daily.length < 2 early-return: that branch skips
     * the rest of the function (including the chart), so if this ran after
     * it, the sparse-history state would leave the row silently stale.
     */
    function renderDailyNoise(daily, trendNow, enoughHistoryForTrend, now) {
      if (!enoughHistoryForTrend || trendNow === null) {
        noiseRow.hidden = true;
        return;
      }
      const personalBand = personalizedNoiseBand(daily, now);
      if (personalBand !== null) {
        noiseText.textContent = `Daily swings of ±${fmtKg(personalBand)} kg are normal for you.`;
        noiseInfoBody.textContent = NOISE_EXPLANATION_PERSONALIZED;
      } else {
        const band = genericNoiseBand(trendNow);
        noiseText.textContent = `Daily swings of ±${fmtKg(band)} kg are normal for your size.`;
        noiseInfoBody.textContent = NOISE_EXPLANATION_GENERIC;
      }
      noiseRow.hidden = false;
      fitNoiseLine();
    }

    // Scrubbing the chart swaps the latest-reading stat for that reading (its
    // label line becomes the date and time) and the trend stat for the trend
    // that day; the two "vs / ago" lines hide (visibility, not display, so the
    // card keeps its height). Letting go puts back whatever was there.
    let weightHeroSaved = null;
    function scrubWeightHero(info) {
      if (!info) {
        if (!weightHeroSaved) return;
        currentWeight.innerHTML = weightHeroSaved.current;
        currentLabel.textContent = weightHeroSaved.label;
        averageWeight.innerHTML = weightHeroSaved.average;
        averageWeight.classList.toggle('live', weightHeroSaved.live);
        currentWhen.style.visibility = '';
        trendChange.style.visibility = '';
        weightHeroSaved = null;
        return;
      }
      if (!weightHeroSaved) {
        weightHeroSaved = {
          current: currentWeight.innerHTML,
          label: currentLabel.textContent,
          average: averageWeight.innerHTML,
          live: averageWeight.classList.contains('live'),
        };
      }
      const trendPoint = info.values.trend;
      currentWeight.innerHTML = `${fmtKg(info.point.value)}<span class="unit">kg</span>`;
      currentLabel.textContent = formatEntryWhen(info.point.entry);
      averageWeight.innerHTML = trendPoint ? `${fmtKg(trendPoint.value)}<span class="unit">kg</span>` : '—';
      averageWeight.classList.toggle('live', !!trendPoint);
      currentWhen.style.visibility = 'hidden';
      trendChange.style.visibility = 'hidden';
    }

    function render() {
      scrubWeightHero(null); // a fresh render overwrites the stats below
      if (entries.length === 0) {
        currentWeight.textContent = '—';
        currentWhen.textContent = '';
        averageWeight.textContent = '—';
        averageWeight.classList.remove('live');
        trendChange.textContent = '';
        windowChangeEl.textContent = '';
        chart.innerHTML = '';
        chartWindowRow.hidden = true;
        chartCard.hidden = true;
        chartEmpty.hidden = true;
        legend.hidden = true;
        noiseRow.hidden = true;
        staleNotice.hidden = true;
        addToggle.classList.remove('live');
        entryList.hidden = true;
        emptyEntries.hidden = false;
        return;
      }
      emptyEntries.hidden = true;
      entryList.hidden = false;
      // Before any early return below — the list shows every weigh-in, even
      // while there's too little history for a chart.
      renderEntries();

      const ascending = [...entries].sort((a, b) => new Date(a.measured_at) - new Date(b.measured_at));

      currentWeight.innerHTML = `${fmtKg(entries[0].weight_kg)}<span class="unit">kg</span>`;
      currentWhen.textContent = relativeWhen(entries[0]);
      renderStaleNotice(entries[0]);

      // Compare like with like: the current trend against the trend as it
      // stood a fortnight ago. Comparing single readings would mostly
      // measure what you ate yesterday.
      // The change belongs to the trend, not the latest reading, so it sits
      // under the trend — a single reading swings a kilo on lunch alone.
      const now = Date.now();
      averageWeightLabel.textContent = HERO_TREND_LABEL[trendMethod];
      weightTrendInfoTitle.textContent = HERO_TREND_LABEL[trendMethod];
      weightTrendInfoBody.textContent = HERO_TREND_EXPLANATION[trendMethod];
      const daily = dailyValues(ascending);
      const trendNow = currentTrend(daily, trendMethod);
      const trendThen = trendAsOf(daily, now - COMPARE_DAYS * DAY_MS, trendMethod);

      // A trend over less than 7 days of actual history isn't honest yet —
      // it's a partial window (or, for EWMA, a barely-smoothed single
      // reading) passed off as a real one. Wait until there's enough tracked
      // history to back it up.
      const enoughHistoryForTrend = hasEnoughHistory(daily, now);
      renderDailyNoise(daily, trendNow, enoughHistoryForTrend, now);

      const showTrend = enoughHistoryForTrend && trendNow !== null;
      averageWeight.innerHTML = showTrend ? `${fmtKg(trendNow)}<span class="unit">kg</span>` : '—';
      // Amber only for a real trend value — an empty dash stays neutral.
      averageWeight.classList.toggle('live', showTrend);

      if (!enoughHistoryForTrend || trendNow === null || trendThen === null) {
        trendChange.textContent = '';
      } else {
        const diff = trendNow - trendThen;
        const sign = diff >= 0 ? '+' : '−';
        trendChange.textContent = Math.abs(diff) < 0.05
          ? `steady vs ${COMPARE_DAYS} days ago`
          : `${sign}${Math.abs(diff).toFixed(1)} kg vs ${COMPARE_DAYS} days ago`;
      }

      // A single day of history isn't a trend — the stat values above remain
      // valid, but the chart (and the window picker that filters it) needs a
      // second distinct day before there's a line worth drawing. Same-day
      // readings collapse to one point in `daily`, so this counts days, not
      // raw entries — logging 3 readings on day one alone still isn't a trend.
      if (daily.length < 2) {
        chartWindowRow.hidden = true;
        chartCard.hidden = true;
        windowChangeEl.textContent = '';
        legend.hidden = true;
        chartEmpty.hidden = false;
        return;
      }
      chartEmpty.hidden = true;
      chartCard.hidden = false;

      const { options: windowOptions, totalSpanDays } = chartWindowChoices(ascending);
      const validWindowKeys = new Set([...windowOptions.map((o) => o.key), 'max']);
      if (chartWindow === null || !validWindowKeys.has(chartWindow)) {
        chartWindow = totalSpanDays > DEFAULT_WINDOW_DAYS ? '3m' : 'max';
      }
      renderChartWindowButtons(windowOptions, chartWindow);

      const readings = filterByWindow(ascending.map((e) => ({
        date: e.measured_at, value: Number(e.weight_kg), entry: e,
      })), chartWindow);
      // Computed over the FULL history, then clipped to the window — filtering
      // `daily` first would re-seed the trend's bootstrap at the window's
      // edge and silently draw a wrong curve near it.
      const trend = filterByWindow(trendSeries(daily, trendMethod), chartWindow);

      // Average then vs average now, for whichever window's selected — read
      // straight off the trend line already being drawn (not a separate
      // trendAsOf() call), so the badge can never say something the chart
      // itself doesn't show.
      windowChangeEl.classList.remove('steady');
      if (trend.length < 2) {
        windowChangeEl.textContent = '';
      } else {
        const windowDiff = trend[trend.length - 1].value - trend[0].value;
        if (Math.abs(windowDiff) < 0.05) {
          windowChangeEl.textContent = 'steady';
          windowChangeEl.classList.add('steady');
        } else {
          windowChangeEl.textContent = `${windowDiff >= 0 ? '+' : '−'}${fmtKg(Math.abs(windowDiff))} kg`;
        }
      }

      renderLineChart(chart, {
        series: [
          { key: 'trend', points: trend, color: 'var(--live)', width: '2.2', scrubFollow: true },
          // Scatter, not a line: joining the raw readings drew a jagged shape
          // that isn't real and pulled the eye away from the trend, which is
          // the honest interpolation between them.
          { key: 'raw', points: readings, color: 'var(--muted)', line: false, opacity: '0.45', dots: true, scrub: true },
        ],
        // Every tick on this axis shares the same decimal precision, so
        // "80" next to a real "80.5" reads as "80.0" — never implying more
        // or less precision than its neighbors.
        formatValue: (v, decimals) => `${v.toFixed(decimals)} kg`,
        formatDate: formatCompactDate,
        // Ordinary day-to-day bodyweight noise (water, food) runs well
        // under this — without a floor, a 0.3kg wobble would stretch to
        // fill the whole chart and read as a real trend.
        minRange: 2,
        scrub: { onChange: scrubWeightHero },
      });

      const trendLabel = LEGEND_LABEL[trendMethod];
      legend.innerHTML = `
        <span><i style="background:var(--live)"></i>${trendLabel[0].toUpperCase()}${trendLabel.slice(1)}</span>
        <span><i class="dot" style="background:var(--muted)"></i>Reading</span>`;
      legend.hidden = trend.length === 0;
    }

    function renderEntries() {
      entryList.innerHTML = '';
      for (const bucket of bucketEntries(entries)) {
        const heading = document.createElement('p');
        heading.className = 'section-label';
        heading.textContent = bucket.label;
        entryList.appendChild(heading);

        const ul = document.createElement('ul');
        ul.className = 'list';
        for (const entry of bucket.entries) {
          ul.appendChild(entry.id === editingId
            ? buildEditRow(entry)
            : buildEntryRow(entry, bucket.label));
        }
        entryList.appendChild(ul);
      }
    }

    function buildEntryRow(entry, bucketLabel) {
      const li = document.createElement('li');
      li.className = 'list-item';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const open = () => { editingId = entry.id; renderEntries(); };
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });

      const body = document.createElement('div');
      body.className = 'list-item-body';
      const name = document.createElement('div');
      name.className = 'entry-weight';
      name.textContent = `${fmtKg(entry.weight_kg)} kg`;
      body.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'list-item-meta';
      meta.textContent = formatEntryInBucket(entry);
      body.appendChild(meta);
      li.appendChild(body);

      const chevron = document.createElement('span');
      chevron.className = 'list-item-chevron';
      chevron.innerHTML = '<svg width="14" height="22" viewBox="0 0 14 22" fill="none" stroke="var(--text)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3 L11 11 L3 19"/></svg>';
      li.appendChild(chevron);
      return li;
    }

    function buildEditRow(entry) {
      const li = document.createElement('li');
      li.className = 'list-item';
      li.style.cssText = 'display:block;cursor:default;';

      const when = new Date(entry.measured_at);

      const row = document.createElement('div');
      row.className = 'field-row';
      const wField = document.createElement('div');
      wField.className = 'field';
      const wLabel = document.createElement('label');
      wLabel.textContent = 'Weight (kg)';
      const wInput = document.createElement('input');
      wInput.type = 'text';
      wInput.inputMode = 'decimal';
      wInput.value = fmtKg(entry.weight_kg);
      wLabel.htmlFor = wInput.id = `w-${entry.id}`;
      wField.append(wLabel, wInput);
      row.appendChild(wField);
      li.appendChild(row);

      const whenRow = document.createElement('div');
      whenRow.className = 'field-row';
      const dField = document.createElement('div');
      dField.className = 'field';
      const dLabel = document.createElement('label');
      dLabel.textContent = 'Date';
      const dInput = document.createElement('input');
      dInput.type = 'date';
      dInput.value = localDateValue(when);
      dLabel.htmlFor = dInput.id = `d-${entry.id}`;
      dField.append(dLabel, dInput);

      const tField = document.createElement('div');
      tField.className = 'field';
      const tLabel = document.createElement('label');
      tLabel.textContent = 'Time';
      const tInput = document.createElement('input');
      tInput.type = 'time';
      // A blank time keeps the "date only" flag; typing one sets it.
      tInput.value = entry.time_known ? localTimeValue(when) : '';
      tLabel.htmlFor = tInput.id = `t-${entry.id}`;
      tField.append(tLabel, tInput);

      whenRow.append(dField, tField);
      li.appendChild(whenRow);

      const status = document.createElement('div');
      status.className = 'status';
      status.hidden = true;
      li.appendChild(status);

      const actions = document.createElement('div');
      actions.className = 'btn-row';
      actions.style.marginTop = 'var(--space-3)';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'secondary';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { editingId = null; renderEntries(); });

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Save';
      save.addEventListener('click', () => saveEdit(entry, wInput, dInput, tInput, save, status));

      actions.append(cancel, save);
      li.appendChild(actions);

      // Two-tap delete, same as sets elsewhere — no dialog, no undo needed.
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'secondary';
      del.style.cssText = 'margin-top:var(--space-3);color:var(--danger);';
      del.textContent = 'Delete';
      let armed = false;
      del.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Tap again to delete';
          setTimeout(() => { if (armed) { armed = false; del.textContent = 'Delete'; } }, 3000);
          return;
        }
        removeEntry(entry, del, status);
      });
      li.appendChild(del);

      return li;
    }

    // ------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------
    function parseWeight(raw) {
      const value = parseKg(raw);
      if (!isFinite(value)) return { error: 'Enter a weight, e.g. 80.5' };
      // Range-check the rounded value — that's what gets saved, and the
      // database rejects anything at or outside 20–500.
      const rounded = Math.round(value * 10) / 10;
      if (rounded <= 20 || rounded >= 500) return { error: 'That does not look like a bodyweight in kg.' };
      return { value: rounded };
    }

    async function saveNew() {
      const parsed = parseWeight(newWeight.value);
      if (parsed.error) { show(addStatus, 'error', parsed.error); return; }

      const dateStr = newDate.value;
      const timeStr = newTime.value;
      let measuredAt = new Date();
      let timeKnown = true;
      if (timeStr && !dateStr) { show(addStatus, 'error', 'Pick a date for that time.'); return; }
      if (dateStr) {
        // Date given without a time: stamp local midday and say so, rather
        // than pretending you weighed yourself at midnight.
        measuredAt = timeStr ? toInstant(dateStr, timeStr) : toInstant(dateStr, '12:00');
        timeKnown = Boolean(timeStr);
        if (isNaN(measuredAt.getTime())) { show(addStatus, 'error', 'That date is not valid.'); return; }
      }

      addSave.disabled = true;
      addSave.textContent = 'Saving…';
      const { data, error } = await attempt(() => store.addWeight({ kg: parsed.value, measuredAt: measuredAt.toISOString(), timeKnown }));
      addSave.disabled = false;
      addSave.textContent = 'Save';

      if (error) { show(addStatus, 'error', `Could not save: ${error.message}`); return; }

      entries.push(data);
      entries.sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at));
      closeAddForm();
      render();
      flash(`Logged ${fmtKg(data.weight_kg)} kg.`);
    }

    async function saveEdit(entry, wInput, dInput, tInput, btn, status) {
      const parsed = parseWeight(wInput.value);
      if (parsed.error) { show(status, 'error', parsed.error); return; }
      if (!dInput.value) { show(status, 'error', 'A date is needed.'); return; }

      const timeKnown = Boolean(tInput.value);
      const measuredAt = toInstant(dInput.value, tInput.value || '12:00');
      if (isNaN(measuredAt.getTime())) { show(status, 'error', 'That date is not valid.'); return; }

      btn.disabled = true;
      btn.textContent = 'Saving…';
      const { data, error } = await attempt(() => store.updateWeight(entry.id, { kg: parsed.value, measuredAt: measuredAt.toISOString(), timeKnown }));
      btn.disabled = false;
      btn.textContent = 'Save';

      if (error) { show(status, 'error', `Could not save: ${error.message}`); return; }

      entries = entries.map((e) => (e.id === entry.id ? data : e));
      entries.sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at));
      editingId = null;
      render();
      flash('Entry updated.');
    }

    async function removeEntry(entry, btn, status) {
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      const { error } = await attempt(() => store.deleteWeight(entry.id));
      if (error) {
        show(status, 'error', `Could not delete: ${error.message}`);
        btn.disabled = false;
        btn.textContent = 'Delete';
        return;
      }
      entries = entries.filter((e) => e.id !== entry.id);
      editingId = null;
      render();
      flash('Entry deleted.');
    }

    // ------------------------------------------------------------------
    // Add form plumbing
    // ------------------------------------------------------------------
    function openAddForm() {
      const now = new Date();
      newWeight.value = '';
      newDate.value = localDateValue(now);
      newTime.value = localTimeValue(now);
      whenFields.hidden = true;
      whenToggle.textContent = '+ Change date & time';
      hide(addStatus);
      addForm.hidden = false;
      addToggle.hidden = true;
      newWeight.focus();
    }
    function closeAddForm() {
      addForm.hidden = true;
      addToggle.hidden = false;
    }

    weightTrendInfoTrigger.addEventListener('click', () => { weightTrendInfoModal.hidden = false; });
    weightTrendInfoClose.addEventListener('click', () => { weightTrendInfoModal.hidden = true; });
    weightTrendInfoModal.addEventListener('click', (e) => { if (e.target === weightTrendInfoModal) weightTrendInfoModal.hidden = true; });

    noiseInfoTrigger.addEventListener('click', () => { noiseInfoModal.hidden = false; });
    noiseInfoClose.addEventListener('click', () => { noiseInfoModal.hidden = true; });
    noiseInfoModal.addEventListener('click', (e) => { if (e.target === noiseInfoModal) noiseInfoModal.hidden = true; });

    addToggle.addEventListener('click', openAddForm);
    addCancel.addEventListener('click', closeAddForm);
    addSave.addEventListener('click', saveNew);
    newWeight.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNew(); });
    whenToggle.addEventListener('click', () => {
      whenFields.hidden = !whenFields.hidden;
      whenToggle.textContent = whenFields.hidden ? '+ Change date & time' : '− Use right now';
      if (whenFields.hidden) {
        const now = new Date();
        newDate.value = localDateValue(now);
        newTime.value = localTimeValue(now);
      }
    });

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    async function loadAll() {
      const { data: loaded, error } = await attempt(async () => {
        const [data, method] = await Promise.all([store.listWeights(), store.getWeightTrendMethod()]);
        return { data, method };
      });
      const data = loaded?.data;
      if (loaded) trendMethod = loaded.method;
      loading.hidden = true;
      if (error) { weightStatus('top-status', `Could not load your weight log: ${error.message}`, 'error', loadAll); return; }
      hide(topStatus);
      entries = data.reverse();
      content.hidden = false;
      render();
      if (new URLSearchParams(window.location.search).get('add') === '1') openAddForm();
    }
    await loadAll();
