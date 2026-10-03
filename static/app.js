/* ================================================================ utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};
const fmt = (n, d = 2) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const big = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (a >= v) return (n / v).toFixed(2) + s;
  return fmt(n, 0);
};
const pct = (n, d = 2) => (n == null || isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const ratio = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const cls = (n) => (n == null ? "" : n >= 0 ? "up" : "down");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return t("{n}m ago", { n: m });
  if (m < 1440) return t("{n}h ago", { n: Math.round(m / 60) });
  return t("{n}d ago", { n: Math.round(m / 1440) });
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function toast(msg, isErr = true) {
  const el = document.createElement("div");
  el.className = `toast ${isErr ? "err" : ""}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 4500);
}

// Ticker avatar: the company logo when one exists, else a deterministic colored monogram.
// Remember outcomes so frequently re-rendered lists (watchlist, movers) don't flicker.
const logoOk = new Set(), logoMissing = new Set(), logoLight = new Set();
// White-on-transparent logos vanish on the white tile; sample the pixels to pick a dark tile instead.
function isLightLogo(img) {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let n = 0, lum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      n++;
      lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    // Mostly transparent with near-white ink → light logo. Opaque white squares are fine as-is.
    return n > 0 && n < 24 * 24 * 0.9 && lum / n > 0.88;
  } catch { return false; }
}
function logoLoaded(img, sym) {
  logoOk.add(sym);
  if (isLightLogo(img)) logoLight.add(sym);
  img.parentNode.classList.add("logo-ok");
  img.parentNode.classList.toggle("logo-light", logoLight.has(sym));
}
function logoFailed(img, sym) { logoMissing.add(sym); img.remove(); }
function avatar(sym, size) {
  let h = 0;
  for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 360;
  const label = sym.replace(/^\^/, "").slice(0, sym.length > 4 ? 3 : 4);
  const s = esc(sym);
  const img = /^[A-Za-z0-9.\-]{1,10}$/.test(sym) && !logoMissing.has(sym)
    ? `<img src="/api/logo/${encodeURIComponent(sym)}" alt="" ${logoOk.has(sym) ? "" : `loading="lazy" onload="logoLoaded(this, '${s}')"`} onerror="logoFailed(this, '${s}')">`
    : "";
  return `<span class="avatar${logoOk.has(sym) ? " logo-ok" : ""}${logoLight.has(sym) ? " logo-light" : ""}" style="--h:${h};${size ? `width:${size}px;height:${size}px` : ""}"><span class="mono-lbl">${esc(label)}</span>${img}</span>`;
}

// Inline SVG sparkline; dashed line marks the reference (previous close).
function spark(values, { w = 120, h = 36, ref = null, fill = true } = {}) {
  if (!values || values.length < 2) return `<svg class="spark" width="100%" height="${h}"></svg>`;
  const lo = Math.min(...values, ref ?? Infinity), hi = Math.max(...values, ref ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - 2 - ((v - lo) / span) * (h - 4);
  const up = values[values.length - 1] >= (ref ?? values[0]);
  const color = up ? "var(--up)" : "var(--down)";
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const id = "g" + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">
    ${fill ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".25"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${w},${h}L0,${h}Z" fill="url(#${id})"/>` : ""}
    ${ref != null ? `<line x1="0" x2="${w}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--muted)" stroke-dasharray="2 3" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".6"/>` : ""}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

/* ================================================================ state */
const INDEX_META = { SPY: "S&P 500", QQQ: "Nasdaq 100", DIA: "Dow Jones", IWM: "Russell 2000", "^VIX": "Volatility" };
const POPULAR = [["AAPL", "Apple Inc."], ["NVDA", "NVIDIA Corporation"], ["MSFT", "Microsoft Corporation"], ["TSLA", "Tesla, Inc."], ["AMZN", "Amazon.com, Inc."], ["META", "Meta Platforms, Inc."], ["GOOGL", "Alphabet Inc."]];

const state = {
  symbol: null, range: "1D", style: store.get("mp.style", "hollow"), tf: store.get("mp.tf", { "1D": 5, "5D": 15 }), bars: [], rawBars: [], intraday: true, prevClose: null, lastPrice: null, quote: null,
  source: null, movers: null, moverKind: "gainers", newsSym: "SPY,QQQ,DIA,IWM",
  watchlist: store.get("mp.watchlist", ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN"]),
  recent: store.get("mp.recent", []),
  wlQuotes: {}, sparks: {}, models: [], aiEnabled: false,
  positions: [], posEval: null, posReview: null, chainMeta: null,
  showLevels: store.get("mp.levels", true), showExt: store.get("mp.ext", true), ext: null, signals: null, trade: null, risk: store.get("mp.risk", "moderate"),
};

/* ================================================================ market status */
function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: p.weekday, mins: +p.hour * 60 + +p.minute };
}
function marketStatus() {
  const { day, mins } = nyNow();
  if (day === "Sat" || day === "Sun") return { key: "closed", label: t("Market closed") };
  if (mins >= 570 && mins < 960) return { key: "open", label: t("Market open · closes in {h}h {m}m", { h: Math.floor((960 - mins) / 60), m: (960 - mins) % 60 }) };
  if (mins >= 240 && mins < 570) return { key: "ext", label: t("Pre-market") };
  if (mins >= 960 && mins < 1200) return { key: "ext", label: t("After hours") };
  return { key: "closed", label: t("Market closed") };
}
function renderStatus() {
  const s = marketStatus();
  const el = $("#market-status");
  el.className = `status-pill ${s.key}`;
  $("span", el).textContent = s.label;
  el.title = s.label;
}

/* ================================================================ theme */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("mp.theme", t); } catch {}
  schedulePrefsSync();
  chart.applyOptions(chartTheme());
  if (state.bars.length) renderChart(false);
}
$("#lang-btn").textContent = LANG === "en" ? "中" : "EN"; // shows the language you switch to
$("#lang-btn").title = $("#lang-btn").ariaLabel = LANG === "en" ? "切換為繁體中文" : "Switch to English";
$("#lang-btn").addEventListener("click", () => setLang(LANG === "en" ? "zh-Hant" : "en"));
$("#theme-btn").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

/* ================================================================ chart */
function chartTheme() {
  return {
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: "Inter", fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--grid") } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.2 } },
    timeScale: { borderVisible: false },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Magnet,
      vertLine: { color: css("--border-2"), labelBackgroundColor: css("--panel-2") },
      horzLine: { color: css("--border-2"), labelBackgroundColor: css("--panel-2") },
    },
  };
}
// Built-in wheel handling is off (see chartWheel below); drag to pan, touch-pinch to zoom.
const chart = LightweightCharts.createChart($("#chart"), {
  autoSize: true, ...chartTheme(), localization: { locale: LOCALE },
  handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
});
let priceSeries = null;
const volSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

function rangeBase() {
  return state.range === "1D" && state.prevClose ? state.prevClose : state.bars[0]?.open;
}

function renderChart(fit = true) {
  const bars = state.bars;
  if (!bars.length) return;
  const base = rangeBase();
  const up = bars[bars.length - 1].close >= base;
  const upC = css("--up"), downC = css("--down"), color = up ? upC : downC;
  if (priceSeries) { chart.removeSeries(priceSeries); levelLines = []; }
  priceSeries = state.style !== "area"
    ? chart.addCandlestickSeries({ upColor: upC, downColor: downC, borderVisible: state.style === "hollow", borderUpColor: upC, borderDownColor: downC, wickUpColor: upC, wickDownColor: downC })
    : chart.addAreaSeries({ lineColor: color, topColor: color + "40", bottomColor: color + "00", lineWidth: 2, crosshairMarkerRadius: 4 });
  if (state.range === "1D" && state.prevClose) {
    // Keep the previous-close reference line inside the visible price range.
    const pc = state.prevClose;
    priceSeries.applyOptions({
      autoscaleInfoProvider: (orig) => {
        const r = orig();
        return r && { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, pc), maxValue: Math.max(r.priceRange.maxValue, pc) } };
      },
    });
  }
  const extC = css("--muted");
  priceSeries.setData(bars.map((b, i) => seriesPoint(b, bars[i - 1])));
  if (state.range === "1D" && state.prevClose) {
    priceSeries.createPriceLine({ price: state.prevClose, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: t("Prev close") });
  }
  drawLevels();
  volSeries.setData(bars.map((b) => ({ time: b.time, value: b.volume || 0, color: b.ext ? extC + "44" : (b.close >= b.open ? upC : downC) + "55" })));
  chart.timeScale().applyOptions({ timeVisible: state.intraday, secondsVisible: false });
  if (fit) requestAnimationFrame(() => fitChart());
  renderRangeReturn();
  setLegend(null);
}

// One price-series point per bar. Hollow candles (TradingView style): colour follows
// close vs the previous close; the body is hollow when close > open.
function seriesPoint(b, prev) {
  const extC = css("--muted");
  if (state.style === "area") {
    return b.ext ? { time: b.time, value: b.close, lineColor: extC, topColor: extC + "22", bottomColor: extC + "00" } : { time: b.time, value: b.close };
  }
  const bar = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
  if (state.style === "candle") return b.ext ? { ...bar, color: extC, wickColor: extC, borderColor: extC } : bar;
  const c = b.ext ? extC : b.close >= (prev ? prev.close : b.open) ? css("--up") : css("--down");
  // Fill hollow bodies with the panel colour so the wick doesn't show through them.
  return { ...bar, color: b.close > b.open ? css("--panel") : c, borderColor: c, wickColor: c };
}

// Show the whole range when candles stay readable; otherwise zoom to the latest
// bars at a readable width (drag to pan back, drag the price/time axis to zoom).
const MIN_BAR_PX = 7;
function fitChart(tries = 0) {
  const ts = chart.timeScale(), n = state.bars.length, w = ts.width();
  if (!w) return void (tries < 20 && setTimeout(() => fitChart(tries + 1), 50)); // not laid out yet
  if (n * MIN_BAR_PX <= w) return ts.fitContent();
  const shown = Math.floor(w / MIN_BAR_PX);
  ts.setVisibleLogicalRange({ from: n - shown, to: n + 2 });
}

// Intraday ranges can be viewed at coarser bar intervals than the API returns
// (1D ships 1m bars, 5D ships 5m); aggregate client-side.
const TF_OPTIONS = { "1D": [1, 2, 5, 15], "5D": [5, 15, 30] };
const tfMinutes = () => (TF_OPTIONS[state.range] ? state.tf[state.range] || TF_OPTIONS[state.range][0] : 0);
const bucketOf = (t, min) => Math.floor(t / (min * 60)) * min * 60;
function aggregate(raw) {
  const min = tfMinutes();
  if (!min || min === TF_OPTIONS[state.range][0]) return raw.map((b) => ({ ...b }));
  const out = [];
  for (const b of raw) {
    const t = bucketOf(b.time, min), last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume = (last.volume || 0) + (b.volume || 0);
    } else out.push({ ...b, time: t });
  }
  return out;
}
// Intraday feeds carry stray bad prints (e.g. a 1m after-hours wick 6% below price) that
// stretch the price scale and flatten everything else. Cap each wick at 10x the median bar range.
function clipWicks(bars) {
  if (!state.intraday || bars.length < 20) return bars;
  const ranges = bars.map((b) => b.high - b.low).sort((a, b) => a - b);
  const cap = 10 * (ranges[ranges.length >> 1] || 0);
  if (!cap) return bars;
  return bars.map((b) => {
    const hi = Math.max(b.open, b.close) + cap, lo = Math.min(b.open, b.close) - cap;
    return b.high > hi || b.low < lo ? { ...b, high: Math.min(b.high, hi), low: Math.max(b.low, lo) } : b;
  });
}
function rebuildBars() {
  state.bars = aggregate(clipWicks(state.rawBars));
  barIndex.clear();
  state.bars.forEach((b) => barIndex.set(b.time, b));
}
function renderTfTabs() {
  const opts = TF_OPTIONS[state.range], el = $("#tf-tabs");
  el.hidden = !opts;
  if (!opts) return;
  el.innerHTML = opts.map((m) => `<button data-tf="${m}" class="${m === tfMinutes() ? "active" : ""}">${m}m</button>`).join("");
}
$("#tf-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.tf = { ...state.tf, [state.range]: +b.dataset.tf };
  store.set("mp.tf", state.tf);
  renderTfTabs();
  rebuildBars();
  renderChart();
});

// Expand: the chart fills the browser window (not OS full screen) — handy while day trading. Esc closes.
function setChartExpanded(on) {
  if (on === $(".chart-card").classList.contains("expanded")) return;
  $(".chart-card").classList.toggle("expanded", on);
  document.body.classList.toggle("chart-expanded", on);
  $("#fs-btn").classList.toggle("on", on);
  $("#fs-btn").title = t(on ? "Exit expanded chart (Esc)" : "Expand chart to the full page");
  if (state.bars.length) requestAnimationFrame(() => fitChart());
}
$("#fs-btn").addEventListener("click", () => setChartExpanded(!$(".chart-card").classList.contains("expanded")));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $(".chart-card").classList.contains("expanded") && !document.querySelector(".modal:not([hidden]), .palette:not([hidden])")) setChartExpanded(false);
});

// Touchpad / mouse wheel on the chart:
//   horizontal swipe (or Shift+wheel) pans through time, pinch (Ctrl/⌘+wheel) zooms at the cursor.
//   Plain vertical wheel zooms only in the expanded chart; inline it keeps scrolling the page.
function chartWheel(e) {
  const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(), n = state.bars.length;
  if (!r || !n) return;
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * k, dy = e.deltaY * k;
  const expanded = $(".chart-card").classList.contains("expanded");
  const zoom = e.ctrlKey || e.metaKey || (expanded && Math.abs(dy) > Math.abs(dx));
  if (!zoom && Math.abs(dx) <= Math.abs(dy)) return; // vertical scroll: let the page have it
  e.preventDefault();
  const span = r.to - r.from, w = ts.width() || 1;
  let from, to;
  if (zoom) {
    const box = $("#chart").getBoundingClientRect();
    const at = ts.coordinateToLogical(e.clientX - box.left) ?? r.to;
    const f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0025)); // pinch deltas are small
    const newSpan = Math.min(Math.max(span * f, 12), n + 40);
    from = at - (at - r.from) * (newSpan / span);
    to = from + newSpan;
  } else {
    const shift = (dx / w) * span;
    from = r.from + shift;
    to = r.to + shift;
  }
  // Keep some bars on screen at either end.
  const lo = -(to - from) + 5, hi = n + (to - from) - 5;
  if (from < lo) [from, to] = [lo, lo + (to - from)];
  if (to > hi) [from, to] = [hi - (to - from), hi];
  ts.setVisibleLogicalRange({ from, to });
}
$("#chart").addEventListener("wheel", chartWheel, { passive: false });

// Support/resistance + trade-plan price lines, toggled by the "Levels" button.
let levelLines = [];
function drawLevels() {
  if (!priceSeries) return;
  levelLines.forEach((l) => priceSeries.removePriceLine(l));
  levelLines = [];
  if (!state.showLevels) return;
  const add = (price, color, title, style = 1) => price != null && levelLines.push(priceSeries.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true }));
  const tech = state.signals?.technicals;
  const plan = state.trade?.stock_trade;
  // Your own position: average cost of shares, plus the AI review's stop / target.
  const held = (state.posEval?.rows || []).filter((r) => r.kind === "stock");
  if (held.length) {
    const sh = held.reduce((a, r) => a + r.qty, 0);
    add(held.reduce((a, r) => a + r.qty * r.cost, 0) / sh, "#14b8a6", t("Avg cost"), 0);
  }
  const rv = state.posReview && state.posReview.hash === posHash(state.positions || []) ? state.posReview : null;
  if (rv) {
    add(rv.stop_loss, css("--down"), t("My stop"), 2);
    add(rv.take_profit, css("--up"), t("My target"), 2);
  }
  if (plan && ["long", "short"].includes(plan.direction)) {
    add(plan.entry_low, css("--accent"), t("Entry"), 0);
    if (plan.entry_high !== plan.entry_low) add(plan.entry_high, css("--accent"), "", 0);
    add(plan.stop, css("--down"), t("Stop"), 0);
    (plan.targets || []).forEach((x, i) => add(x, css("--up"), `T${i + 1}`, 0));
  } else if (tech) {
    (tech.resistance || []).slice(0, 2).forEach((x) => add(x, css("--down"), "R"));
    (tech.support || []).slice(0, 2).forEach((x) => add(x, css("--up"), "S"));
  }
}
function setShowLevels(on) {
  state.showLevels = on;
  store.set("mp.levels", on);
  schedulePrefsSync();
  $("#levels-btn").classList.toggle("on", on);
  drawLevels();
}
$("#levels-btn").addEventListener("click", () => setShowLevels(!state.showLevels));

function renderRangeReturn() {
  const bars = state.bars;
  if (!bars.length) return ($("#range-ret").innerHTML = "");
  const base = rangeBase();
  const last = state.range === "1D" && state.lastPrice != null ? state.lastPrice : bars[bars.length - 1].close;
  const chg = last - base, p = (last / base - 1) * 100;
  const label = { "1D": "today", "5D": "past 5 days", "1M": "past month", "6M": "past 6 months", "1Y": "past year", "5Y": "past 5 years" }[state.range];
  $("#range-ret").innerHTML = `<span class="${cls(chg)}">${chg >= 0 ? "+" : ""}${fmt(chg)} (${pct(p)})</span><span class="muted">${label}</span>`;
}

function fmtTime(t) {
  if (typeof t === "string") return new Date(t + "T00:00:00Z").toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return new Date(t * 1000).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
function setLegend(bar) {
  const b = bar || state.bars[state.bars.length - 1];
  if (!b) return ($("#legend").innerHTML = "");
  const c = cls(b.close - b.open);
  $("#legend").innerHTML = `<span>${fmtTime(b.time)}</span><span><b>O</b>${fmt(b.open)}</span><span><b>H</b>${fmt(b.high)}</span><span><b>L</b>${fmt(b.low)}</span><span class="${c}"><b>C</b>${fmt(b.close)}</span><span><b>${t("Vol")}</b>${big(b.volume)}</span>`;
}
const barIndex = new Map();
const timeKey = (t) => (typeof t === "object" ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : t);
chart.subscribeCrosshairMove((p) => setLegend(p.time && p.point ? barIndex.get(timeKey(p.time)) : null));

async function loadHistory(fit = true, quiet = false) {
  const { symbol, range } = state;
  if (!quiet) $("#chart-loading").classList.add("on");
  try {
    const h = await api(`/api/history/${symbol}?range=${range}&ext=${state.showExt}`);
    if (symbol !== state.symbol || range !== state.range) return;
    state.rawBars = h.bars;
    state.intraday = h.intraday;
    rebuildBars();
    renderChart(fit);
  } catch (e) {
    if (symbol !== state.symbol || quiet) return; // a failed background refresh keeps the current chart
    state.bars = state.rawBars = [];
    priceSeries?.setData([]);
    volSeries.setData([]);
    $("#range-ret").innerHTML = `<span class="err">No chart data</span>`;
  } finally {
    $("#chart-loading").classList.remove("on");
  }
}

function applyTick(t) {
  const session = marketStatus().key;
  const extTick = session === "ext" && state.showExt && t.ext?.price != null;
  if (!priceSeries || !state.bars.length || (session !== "open" && !extTick)) return;
  const price = extTick ? t.ext.price : t.price;
  if (price == null) return;
  const bars = state.bars, last = bars[bars.length - 1];
  if (!state.intraday && extTick) return; // daily bars only reflect the regular session
  const intra = state.range === "1D" || (extTick && state.range === "5D");
  // Keep the raw bars current too, so switching the bar interval doesn't drop live ticks.
  if (intra) mergeTick(state.rawBars, bucketOf(t.bar_time, TF_OPTIONS[state.range][0]), price, extTick);
  else mergeTick(state.rawBars, state.rawBars[state.rawBars.length - 1].time, price, extTick);
  const b = mergeTick(bars, intra ? bucketOf(t.bar_time, tfMinutes()) : last.time, price, extTick);
  if (!b) return;
  barIndex.set(b.time, b);
  priceSeries.update(seriesPoint(b, bars[bars.length - 2]));
  renderRangeReturn();
}

// Fold a live price into the bar at time `t` (opening a new bar later the same day); returns it.
function mergeTick(bars, t, price, ext) {
  const last = bars[bars.length - 1];
  if (!last) return null;
  if (t > last.time && Math.floor(t / 86400) === Math.floor(last.time / 86400)) {
    const nb = { time: t, open: price, high: price, low: price, close: price, volume: 0, ...(ext ? { ext: true } : {}) };
    bars.push(nb);
    return nb;
  }
  if (t !== last.time) return null;
  last.close = price;
  last.high = Math.max(last.high, price);
  last.low = Math.min(last.low, price);
  return last;
}

/* ================================================================ stock view */
function setAvatar(sym) {
  const tpl = document.createElement("template");
  tpl.innerHTML = avatar(sym);
  const el = tpl.content.firstElementChild;
  el.id = "q-avatar";
  $("#q-avatar").replaceWith(el);
  $("#tq-avatar").innerHTML = avatar(sym, 26);
  $("#tq-sym").textContent = sym;
}

function renderQuote(q) {
  state.quote = q;
  renderExt(q.ext?.session);
  state.prevClose = q.prev_close;
  $("#q-symbol").textContent = q.symbol;
  $("#q-exch").textContent = [q.exchange, q.currency].filter(Boolean).join(" · ");
  $("#q-name").textContent = q.name || "";
  setAvatar(q.symbol);
  setPrice(q.last_price, q.change, q.change_percent);
  renderRanges();
  setBaseStats(q);
  if (state.events) renderEvents(state.events); // dividend yield needs the price
}
function setBaseStats(q) {
  state.baseStats = [
    ["Open", fmt(q.open)], ["Prev close", fmt(q.prev_close)], ["Volume", big(q.volume)], ["Avg volume", big(q.volume_average)],
    ["Bid", q.bid ? `${fmt(q.bid)} × ${q.bid_size ?? 0}` : "—"], ["Ask", q.ask ? `${fmt(q.ask)} × ${q.ask_size ?? 0}` : "—"],
    ["50-day MA", fmt(q.ma_50d)], ["200-day MA", fmt(q.ma_200d)],
  ];
  renderStats();
}

function renderRanges() {
  const q = state.quote;
  if (!q) return;
  const px = state.lastPrice ?? q.last_price;
  const bar = (label, lo, hi) => {
    const pos = lo != null && hi != null && hi > lo ? Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100)) : 50;
    return `<div class="rng"><div class="rng-lbl"><span>${label}</span></div><div class="bar"><i style="left:${pos}%"></i></div>
      <div class="ends mono"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></div></div>`;
  };
  $("#ranges").innerHTML = bar("Day range", Math.min(q.low ?? px, px), Math.max(q.high ?? px, px)) + bar("52-week range", q.year_low, q.year_high);
}

function renderStats() {
  if (!state.baseStats) return;
  const o = state.overview;
  const extra = o ? [
    ["Market cap", big(o.market_cap)], ["P/E (TTM)", fmt(o.pe_ratio)], ["Forward P/E", fmt(o.forward_pe)], ["PEG", fmt(o.peg_ratio)],
    ["Price / book", fmt(o.price_to_book)], ["EV / EBITDA", fmt(o.enterprise_to_ebitda)], ["Revenue growth", ratio(o.revenue_growth)], ["Earnings growth", ratio(o.earnings_growth)],
    ["Gross margin", ratio(o.gross_margin)], ["Operating margin", ratio(o.operating_margin)], ["Net margin", ratio(o.profit_margin)], ["ROE", ratio(o.return_on_equity)],
    ["Debt / equity", fmt(o.debt_to_equity)], ["Beta", fmt(o.beta)], ["Dividend yield", o.dividend_yield != null ? `${fmt(o.dividend_yield)}%` : "—"], ["1Y return", ratio(o.price_return_1y)],
  ].filter(([, v]) => v !== "—") : [];
  $("#stats").innerHTML = [...state.baseStats, ...extra].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
}

async function loadOverview(symbol) {
  $("#about-card").hidden = true;
  $("#q-tags").innerHTML = "";
  try {
    const o = await api(`/api/overview/${symbol}`);
    if (symbol !== state.symbol) return;
    state.overview = o;
    renderStats();
    $("#q-tags").innerHTML = [o.sector, o.industry_category].filter(Boolean).map((t) => `<span class="chip static">${esc(t)}</span>`).join("");
    if (o.long_description) {
      $("#about-card").hidden = false;
      const hq = [o.hq_address_city, o.hq_state, o.hq_country].filter(Boolean).join(", ");
      $("#about-facts").innerHTML = [["Sector", o.sector], ["Industry", o.industry_category], ["Employees", o.employees ? Number(o.employees).toLocaleString() : null], ["Headquarters", hq]]
        .map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${esc(v || "—")}</div></div>`).join("");
      $("#about-text").textContent = o.long_description;
      $("#about-text").classList.remove("open");
      $("#about-more").textContent = "Show more";
      const url = o.company_url || "";
      $("#about-url").textContent = url.replace(/^https?:\/\/(www\.)?/, "");
      $("#about-url").href = url;
    }
  } catch {}
}
$("#about-more").addEventListener("click", () => {
  const open = $("#about-text").classList.toggle("open");
  $("#about-more").textContent = open ? "Show less" : "Show more";
});

const MOON = `<svg viewBox="0 0 24 24" class="i"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>`;
const SUNRISE = `<svg viewBox="0 0 24 24" class="i"><path d="M12 2v6M5 10l1.4 1.4M19 10l-1.4 1.4M2 18h20M7 18a5 5 0 0 1 10 0M9 5l3-3 3 3" /></svg>`;
const extShort = (e) => (e?.kind === "pre" ? "PM" : "AH");

// Pre-market / after-hours line under the regular price.
function renderExt(e) {
  state.ext = e || null;
  const el = $("#q-ext");
  if (!e || e.price == null) { el.hidden = true; return; }
  const t = e.time ? new Date(e.time * 1000).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";
  el.hidden = false;
  el.innerHTML = `${e.kind === "pre" ? SUNRISE : MOON}<span class="lbl">${esc(window.t(e.label))}</span><span class="px">${fmt(e.price)}</span>
    <span class="ch ${cls(e.change)}">${e.change >= 0 ? "+" : ""}${fmt(e.change)} (${pct(e.change_percent)})</span>${t ? `<span class="muted tiny">${t} ET</span>` : ""}`;
  if (state.posEval && e && state.posEval.rows.some((r) => r.kind === "stock")) renderPositions();
}

function setShowExt(on) {
  state.showExt = on;
  store.set("mp.ext", on);
  schedulePrefsSync();
  $("#ext-btn").classList.toggle("on", on);
  if (state.symbol && ["1D", "5D"].includes(state.range)) loadHistory();
}
$("#ext-btn").addEventListener("click", () => setShowExt(!state.showExt));

function setPrice(price, change, changePct) {
  const el = $("#q-price");
  if (state.lastPrice != null && price != null && price !== state.lastPrice) {
    el.classList.remove("flash-up", "flash-down");
    void el.offsetWidth;
    el.classList.add(price > state.lastPrice ? "flash-up" : "flash-down");
    setTimeout(() => el.classList.remove("flash-up", "flash-down"), 700);
  }
  state.lastPrice = price;
  el.textContent = fmt(price);
  const c = $("#q-change");
  c.textContent = change == null ? "" : `${change >= 0 ? "+" : ""}${fmt(change)} (${pct(changePct)})`;
  c.className = `delta ${cls(change)}`;
  $("#tq-px").textContent = fmt(price);
  $("#tq-ch").textContent = changePct == null ? "" : pct(changePct);
  $("#tq-ch").className = `tq-ch chg-chip ${cls(changePct)}`;
  if (state.range === "1D" && state.bars.length) renderRangeReturn();
  const s = marketStatus();
  $("#q-updated").textContent = s.key === "open"
    ? t("Updated {time}", { time: new Date().toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", second: "2-digit" }) })
    : s.key === "closed" ? "At last close" : s.label;
}

function startStream(symbol) {
  state.source?.close();
  const tag = $("#live-tag");
  tag.className = "live-tag";
  $("span", tag).textContent = "Connecting";
  const src = new EventSource(`/api/stream/${symbol}?interval=5`);
  state.source = src;
  src.onmessage = (e) => {
    const t = JSON.parse(e.data);
    if (t.symbol !== state.symbol) return;
    setPrice(t.price, t.change, t.change_percent);
    renderExt(t.ext);
    applyTick(t);
    if (state.quote) {
      // Keep the day's open / high / low, volume and bid/ask current too, not just the price.
      for (const k of ["open", "high", "low", "volume", "bid", "ask", "bid_size", "ask_size"]) if (t[k] != null) state.quote[k] = t[k];
      if (t.price != null) Object.assign(state.quote, { last_price: t.price, change: t.change, change_percent: t.change_percent });
      setBaseStats(state.quote);
    }
    renderRanges();
    tag.className = "live-tag on";
    $("span", tag).textContent = marketStatus().key === "open" ? "Live" : "Streaming";
    requestAnimationFrame(() => tag.classList.add("tick"));
    setTimeout(() => tag.classList.remove("tick"), 900);
  };
  // The server recycles each stream every ~60s and EventSource reconnects on its own;
  // only show "Reconnecting" if no quote arrives for a while.
  src.addEventListener("message", () => (state.lastTick = Date.now()));
  state.lastTick = Date.now();
  src.onerror = () => {
    // EventSource retries network drops itself, but gives up for good on an HTTP error
    // (e.g. a 502 while the server restarts) — then start a fresh stream.
    if (src.readyState === EventSource.CLOSED) setTimeout(() => state.source === src && startStream(symbol), 3000);
    setTimeout(() => {
      if (state.source === src && Date.now() - state.lastTick > 8000) { tag.className = "live-tag"; $("span", tag).textContent = "Reconnecting"; }
    }, 8000);
  };
}
// Watchdog: a stream that has silently stalled (sleep/wake, proxy hiccup) gets restarted.
setInterval(() => {
  if (state.symbol && state.source && Date.now() - state.lastTick > 30000) startStream(state.symbol);
}, 10000);

/* ================================================================ news */
const srcInitials = (s) => (s || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
function newsHTML(items, { feature = false, showSym = false } = {}) {
  if (!items.length) return `<div class="muted" style="padding:16px 0">No recent news.</div>`;
  const meta = (n) => `<div class="meta">${showSym && n.symbol ? `<span class="tag">${esc(n.symbol)}</span>` : ""}<span>${esc(n.source || "")}</span><span class="dot"></span><span>${ago(n.date)}</span></div>`;
  let out = "", rest = items;
  if (feature) {
    const f = items[0];
    rest = items.slice(1);
    out += `<a class="news-feature" href="${esc(f.url)}" target="_blank" rel="noopener">${meta(f)}<div class="t">${esc(f.title)}</div>${f.summary ? `<div class="s">${esc(f.summary)}</div>` : ""}</a>`;
  }
  return out + rest.map((n) => `
    <a class="news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
      <span class="src-badge">${esc(srcInitials(n.source))}</span>
      <div><div class="t">${esc(n.title)}</div>${n.summary ? `<div class="s">${esc(n.summary)}</div>` : ""}${meta(n)}</div>
    </a>`).join("");
}
const skeleton = (n = 5) => Array.from({ length: n }, () => `<div style="padding:12px 0"><div class="sk-line" style="width:85%"></div><div class="sk-line" style="width:60%"></div></div>`).join("");

// Retry transient data-source failures a few times with backoff before showing an error.
async function withRetry(fn, { tries = 3, onRetry } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries - 1) throw e;
      onRetry?.(i + 1);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function loadMarketNews() {
  const sym = state.newsSym;
  const box = $("#market-news");
  const hadNews = !!box.querySelector(".news-item, .news-feature");
  if (!box.children.length) box.innerHTML = skeleton(6);
  try {
    const items = await withRetry(
      () => api(`/api/news/${encodeURIComponent(sym)}?limit=${sym.includes(",") ? 30 : 20}`),
      { onRetry: () => { if (!hadNews && sym === state.newsSym) box.innerHTML = skeleton(6); } },
    );
    if (sym === state.newsSym) box.innerHTML = newsHTML(items, { feature: true, showSym: sym.includes(",") });
  } catch (e) {
    if (sym !== state.newsSym || hadNews) return; // keep the stories already on screen
    box.innerHTML = `<div class="err">Couldn't load news right now — the data source is busy.</div>
      <button class="btn" style="margin-top:10px" onclick="loadMarketNews()">Try again</button>`;
  }
}
$("#news-filter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $$("#news-filter button").forEach((x) => x.classList.toggle("active", x === b));
  state.newsSym = b.dataset.sym;
  $("#market-news").innerHTML = skeleton(6);
  loadMarketNews();
});

async function loadStockNews(symbol, quiet = false) {
  $("#stock-news-title").textContent = t("{sym} News", { sym: symbol });
  if (!quiet) $("#stock-news").innerHTML = skeleton(6);
  try {
    const items = await withRetry(() => api(`/api/news/${symbol}?limit=20`), { tries: 2 });
    if (symbol === state.symbol) $("#stock-news").innerHTML = newsHTML(items);
  } catch {
    if (symbol === state.symbol && !quiet) $("#stock-news").innerHTML = `<div class="muted" style="padding:12px 0">${t("No news found for {sym}.", { sym: esc(symbol) })}</div>`;
  }
}

/* ================================================================ AI market brief (home) */
// Generated on demand (it runs on the user's own OpenRouter key) and kept for the rest of the New York day.
const BRIEF_KEY = "mp.brief";
const savedBrief = () => { const b = store.get(BRIEF_KEY, null); return b && b.date === nyToday() && b.lang === LANG ? b : null; };

function renderBrief(liveText = null, liveMeta = null) {
  const el = $("#brief-body"), streaming = liveText != null;
  const b = streaming ? { text: liveText, ...liveMeta } : savedBrief();
  if (!b) {
    if (!$("#brief-btn").disabled) $("#brief-btn span").textContent = t("Generate brief");
    el.innerHTML = state.aiEnabled
      ? `<div class="ai-note muted">${t("Click {btn} for a summary of today's market — indexes, movers, economic data, earnings and headlines, plus your watchlist.", { btn: `<b>${t("Generate brief")}</b>` })}</div>`
      : aiGateHTML("market brief");
    return;
  }
  const asOf = b.at ? `${new Date(b.at).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : "";
  el.innerHTML = `<div class="ai-meta">${asOf ? `<span class="chip static">${t("As of {time}", { time: asOf })}</span>` : ""}<span class="muted tiny">${esc(usageBits(b))}</span></div>
    ${streaming && !b.text ? `<div class="ai-thinking"><div class="spinner"></div>${t("Reading today's market…")}</div>` : ""}
    <div class="ai-output ${streaming ? "streaming" : ""}">${md(b.text)}</div>`;
  if (!streaming) $("#brief-btn span").textContent = t("Refresh");
}

async function generateBrief() {
  if (!state.aiEnabled) return promptAiSetup();
  const btn = $("#brief-btn"), meta = { model: currentModel() };
  btn.disabled = true;
  $("#brief-btn span").textContent = t("Generating…");
  renderBrief("", meta);
  try {
    const res = await streamText("/api/market-brief", { model: meta.model, watchlist: state.watchlist }, (tx) => renderBrief(tx, meta));
    store.set(BRIEF_KEY, { date: nyToday(), lang: LANG, text: res.text, ...meta, ...res.usage, at: new Date().toISOString() });
  } catch (e) {
    toast(t("Market brief failed: {msg}", { msg: e.message }));
  } finally {
    btn.disabled = false;
    renderBrief();
  }
}
$("#brief-btn").addEventListener("click", generateBrief);

/* ================================================================ AI chat assistant (floating) */
// Free-form Q&A ("what's your view on the electricity sector?"). The server detects the sectors / tickers asked about
// and feeds the model fresh quotes, sector returns, headlines and the macro calendar. Kept in this browser only.
const CHAT_KEY = "mp.chat";
const chat = { msgs: store.get(CHAT_KEY, []), busy: false, live: null };
const CHAT_SUGGESTIONS = [
  "What's your suggestion on the electricity / utilities sector?",
  "Which sectors are leading and lagging this month?",
  "Compare NVDA and AMD right now",
  "What macro events matter for stocks this week?",
];
// $NEE → link to the stock page.
const chatMd = (text) => md(text).replace(/(^|[\s(>])\$([A-Z]{1,5}(?:[.-][A-Z])?)\b/g,
  (m, pre, sym) => `${pre}<a class="tk" href="#/${sym}">$${sym}</a>`);

function renderChat() {
  const log = $("#chat-log");
  if (!log || $("#chat-panel").hidden) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const msgs = chat.live ? [...chat.msgs, chat.live] : chat.msgs;
  if (!msgs.length) {
    log.innerHTML = state.aiEnabled
      ? `<div class="chat-welcome"><h3>${t("Hi, I'm Maru AI")}</h3>
          <div class="muted">${t("Ask me about any sector, stock or the market. I pull live quotes, sector performance, headlines and the economic calendar before answering.")}</div>
          <div class="chat-sugs">${CHAT_SUGGESTIONS.map((q) => `<button type="button">${esc(t(q))}</button>`).join("")}</div></div>`
      : aiGateHTML("chat");
    $$(".chat-sugs button", log).forEach((b) => b.addEventListener("click", () => sendChat(b.textContent)));
    return;
  }
  log.innerHTML = msgs.map((m) => {
    if (m.role === "user") return `<div class="chat-msg user">${esc(m.content)}</div>`;
    if (m.error) return `<div class="chat-msg err">${esc(m.error)}</div>`;
    const live = m === chat.live;
    const ctx = [...(m.ctx?.sectors || []), ...(m.ctx?.tickers || [])];
    return `<div class="chat-msg bot">
      ${ctx.length ? `<div class="chat-ctx">${ctx.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
      ${live && !m.content ? `<div class="ai-thinking"><div class="spinner"></div>${t("Checking live market data…")}</div>` : ""}
      <div class="ai-output ${live ? "streaming" : ""}">${chatMd(m.content)}</div>
      ${!live && m.at ? `<div class="chat-meta muted">${esc(usageBits(m))}</div>` : ""}
    </div>`;
  }).join("");
  if (stick || chat.live) log.scrollTop = log.scrollHeight;
}

async function sendChat(text) {
  text = (text ?? $("#chat-input").value).trim();
  if (!text || chat.busy) return;
  if (!state.aiEnabled) return promptAiSetup();
  const history = chat.msgs.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, content: m.content }));
  chat.msgs.push({ role: "user", content: text });
  chat.busy = true;
  chat.live = { role: "assistant", content: "", model: currentModel() };
  $("#chat-input").value = "";
  autosizeChat();
  $("#chat-send").disabled = true;
  renderChat();
  try {
    const res = await streamText("/api/chat", { message: text, history, symbol: state.symbol, watchlist: state.watchlist,
      model: chat.live.model, deep: store.get("mp.deep", false) }, (tx) => { chat.live.content = tx; renderChat(); });
    chat.msgs.push({ ...chat.live, content: res.text, ctx: res.context, ...res.usage, at: new Date().toISOString() });
  } catch (e) {
    chat.msgs.push({ role: "assistant", content: "", error: t("Chat failed: {msg}", { msg: e.message }) });
  } finally {
    chat.busy = false;
    chat.live = null;
    $("#chat-send").disabled = false;
    store.set(CHAT_KEY, chat.msgs.slice(-40));
    renderChat();
    $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  }
}

function autosizeChat() {
  const el = $("#chat-input");
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
}
// Maximized = the panel moves into the main content area (beside the watchlist) in place of the current page;
// otherwise it floats bottom-right. The choice is remembered for the next time the chat opens.
const chatDocked = () => $("#chat-panel").classList.contains("max");
function dockChat(max) {
  const panel = $("#chat-panel"), log = $("#chat-log"), top = log.scrollTop;
  if (max !== chatDocked()) (max ? $("#chat-view") : document.body).append(panel);
  panel.classList.toggle("max", max);
  $("#chat-view").hidden = !max;
  document.body.classList.toggle("chat-docked", max);
  $("#chat-max").title = $("#chat-max").ariaLabel = t(max ? "Restore" : "Maximize");
  log.scrollTop = top; // moving the node resets its scroll position
  if (max) window.scrollTo(0, 0);
}
function setChatOpen(open) {
  $("#chat-panel").hidden = !open;
  document.body.classList.toggle("chat-open", open);
  dockChat(open && store.get("mp.chatMax", false));
  if (!open) return;
  renderChat();
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  $("#chat-input").focus();
}
function setChatMax(max) {
  store.set("mp.chatMax", max);
  dockChat(max);
  $("#chat-input").focus();
}
$("#chat-fab").addEventListener("click", () => setChatOpen(true));
$("#chat-close").addEventListener("click", () => setChatOpen(false));
$("#chat-max").addEventListener("click", () => setChatMax(!chatDocked()));
// Navigating (a $TICKER link in the chat, the watchlist, search) while maximized shows that page, with the chat floating.
window.addEventListener("hashchange", () => { if (chatDocked()) dockChat(false); });
$("#chat-new").addEventListener("click", () => {
  if (chat.busy) return;
  chat.msgs = [];
  store.set(CHAT_KEY, []);
  renderChat();
  $("#chat-input").focus();
});
$("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat(); });
$("#chat-input").addEventListener("input", autosizeChat);
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } // Shift+Enter for a new line
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("#chat-panel").hidden || document.querySelector(".modal:not([hidden]), .palette:not([hidden])")) return;
  chatDocked() ? setChatMax(false) : setChatOpen(false);
});

/* ================================================================ market calendar */
// Calendar times are naive New York times ("2026-10-01T08:30:00"); convert to a real instant.
function etDate(iso) {
  const [d, t = "00:00"] = iso.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, dd, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asNy = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (asNy - guess));
}
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
function dayLabel(dateStr) {
  const today = nyToday();
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 864e5));
  const pretty = new Date(dateStr + "T12:00:00").toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
  return dateStr === today ? `${t("Today")} · ${pretty}` : dateStr === tomorrow ? `${t("Tomorrow")} · ${pretty}` : pretty;
}
const fmtEtTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
function countdown(ms) {
  if (ms <= 0) return t("now");
  const m = Math.floor(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? t("{d}d {h}h", { d, h }) : h ? t("{h}h {m}m", { h, m: m % 60 }) : t("{m}m", { m });
}

state.cal = null;
state.calTab = store.get("mp.calTab", "economy");
state.calFilter = store.get("mp.calFilter", "all");

async function loadCalendar() {
  if (!state.cal) $("#cal-body").innerHTML = skeleton(4);
  try {
    const cal = await withRetry(() => api(`/api/calendar?days=7&symbols=${encodeURIComponent(state.watchlist.join(","))}`));
    state.cal = cal;
    renderCalendar();
    renderUpNext();
  } catch {
    if (!state.cal) $("#cal-body").innerHTML = `<div class="cal-empty">Calendar unavailable right now. <button class="link-btn" onclick="loadCalendar()">Retry</button></div>`;
  }
}

function econRows(key = "economic") {
  const evs = state.cal?.[key] || [];
  return state.calFilter === "critical" ? evs.filter((e) => e.tier === "critical") : evs;
}

function renderCalendarNext() {
  const now = Date.now();
  const next = (state.cal?.economic || []).find((e) => e.tier === "critical" && etDate(e.datetime) > now - 5 * 6e4);
  if (!next) return ($("#cal-next").innerHTML = "");
  // Several critical releases often share a slot (e.g. GDP + Core PCE at 8:30 AM).
  const same = state.cal.economic.filter((e) => e.tier === "critical" && e.datetime === next.datetime);
  const v = next.values?.[0] || {};
  const bits = same.length > 1 ? "" : [v.consensus && t("Consensus {v}", { v: v.consensus }), v.previous && t("Prev {v}", { v: v.previous })].filter(Boolean).join(" · ");
  $("#cal-next").innerHTML = `<div class="cal-next"><span class="pulse"></span>
    <div class="what"><b>${t("Next critical: {ev}", { ev: same.map((e) => esc(e.event)).join(" + ") })}</b><span>${dayLabel(next.date)} · ${fmtEtTime(next.time)} ET${bits ? ` · ${esc(bits)}` : ""}</span></div>
    <div class="count">${countdown(etDate(next.datetime) - now)}<small>to release</small></div></div>`;
}

function renderCalendar() {
  const cal = state.cal;
  if (!cal) return;
  const econ = econRows(), recent = econRows("recent"), earn = cal.earnings || [];
  const tabs = { recent: ["Recent", recent], economy: ["Economy", econ], earnings: ["Earnings", earn] };
  $$("#cal-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === state.calTab);
    const [label, rows] = tabs[b.dataset.tab];
    b.innerHTML = `${label}<span class="n">${rows.length}</span>`;
  });
  $$("#cal-filter button").forEach((b) => b.classList.toggle("active", b.dataset.f === state.calFilter));
  $("#cal-filter").hidden = state.calTab === "earnings";
  $("#cal-sub").textContent = t(state.calTab === "recent" ? "Released US data · last 7 days · times ET" : "US releases & earnings · next 7 days · times ET");
  renderCalendarNext();

  const byDay = (rows) => rows.reduce((m, r) => ((m[r.date] ||= []).push(r), m), {});
  const today = nyToday();
  let html = "";
  if (state.calTab === "recent") {
    const arrow = { above: ["▲", "Above consensus"], below: ["▼", "Below consensus"], inline: ["=", "In line"] };
    for (const [date, rows] of Object.entries(byDay(recent))) {
      html += `<div class="cal-day ${date === today ? "today" : ""}"><span>${dayLabel(date)}</span><span>${t(rows.length > 1 ? "{n} events" : "{n} event", { n: rows.length })}</span></div>`;
      html += rows.map((e) => {
        const vals = e.values || [];
        const join = (k) => vals.map((v) => v[k]).filter(Boolean).join(" · ");
        const sp = arrow[vals[0]?.surprise];
        return `<div class="cal-row" data-desc="${esc(e.description || "")}">
          <span class="tm">${fmtEtTime(e.time)}</span>
          <span class="ev"><span class="tier ${e.tier}">${e.tier === "critical" ? "CRITICAL" : "MAJOR"}</span><b title="${esc(e.event)}">${esc(e.event)}</b></span>
          <span class="cal-vals"><span class="v act ${sp ? `sp-${vals[0].surprise}` : ""}" ${sp ? `title="${t(sp[1])}"` : ""}><small>Actual</small>${esc(join("actual") || "—")}${sp ? ` ${sp[0]}` : ""}</span><span class="v"><small>Cons.</small>${esc(join("consensus") || "—")}</span><span class="v"><small>Prev.</small>${esc(join("previous") || "—")}</span></span>
        </div>`;
      }).join("");
    }
    if (!recent.length) html = `<div class="cal-empty">${t(state.calFilter === "critical" ? "No critical US releases in the last 7 days." : "No major US releases in the last 7 days.")}</div>`;
  } else if (state.calTab === "economy") {
    const days = byDay(econ);
    for (const [date, rows] of Object.entries(days)) {
      html += `<div class="cal-day ${date === today ? "today" : ""}"><span>${dayLabel(date)}</span><span>${t(rows.length > 1 ? "{n} events" : "{n} event", { n: rows.length })}</span></div>`;
      html += rows.map((e) => {
        const past = etDate(e.datetime) < Date.now();
        const vals = e.values || [];
        const join = (k) => vals.map((v) => v[k]).filter(Boolean).join(" · ");
        const act = join("actual"), cons = join("consensus"), prev = join("previous");
        return `<div class="cal-row ${past ? "past" : ""}" data-desc="${esc(e.description || "")}">
          <span class="tm">${fmtEtTime(e.time)}</span>
          <span class="ev"><span class="tier ${e.tier}">${e.tier === "critical" ? "CRITICAL" : "MAJOR"}</span><b title="${esc(e.event)}">${esc(e.event)}</b></span>
          <span class="cal-vals">${act ? `<span class="v act"><small>Actual</small>${esc(act)}</span>` : ""}<span class="v"><small>Cons.</small>${esc(cons || "—")}</span><span class="v"><small>Prev.</small>${esc(prev || "—")}</span></span>
        </div>`;
      }).join("");
    }
    if (!econ.length) html = `<div class="cal-empty">${t(state.calFilter === "critical" ? "No critical US releases in the next 7 days." : "No major US releases in the next 7 days.")}</div>`;
  } else {
    const timeLbl = (t) => (t === "pre-market" ? "☀ Before open" : t === "after-hours" ? "☾ After close" : "Time TBA");
    for (const [date, rows] of Object.entries(byDay(earn))) {
      html += `<div class="cal-day ${date === today ? "today" : ""}"><span>${dayLabel(date)}</span><span>${t(rows.length > 1 ? "{n} reports" : "{n} report", { n: rows.length })}</span></div>`;
      html += rows.map((e) => `<div class="cal-row earn-row" data-sym="${esc(e.symbol)}">
          ${avatar(e.symbol, 30)}
          <span style="min-width:0"><b class="mono">${esc(e.symbol)}</b> ${e.watch ? `<span class="star" title="On your watchlist">★</span>` : ""}<div class="nm">${esc(e.name || "")}</div></span>
          <span class="cal-vals"><span class="earn-time">${timeLbl(e.time)}</span><span class="v"><small>EPS est.</small>${e.eps_consensus != null ? fmt(e.eps_consensus) : "—"}</span><span class="v"><small>Mkt cap</small>${big(e.market_cap)}</span></span>
        </div>`).join("");
    }
    if (!earn.length) html = `<div class="cal-empty">No major earnings (≥ $50B) or watchlist reports in the next 7 days.</div>`;
  }
  $("#cal-body").innerHTML = html;
}

$("#cal-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.calTab = b.dataset.tab;
  store.set("mp.calTab", state.calTab);
  schedulePrefsSync();
  renderCalendar();
});
$("#cal-filter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.calFilter = b.dataset.f;
  store.set("mp.calFilter", state.calFilter);
  schedulePrefsSync();
  renderCalendar();
});
$("#cal-body").addEventListener("click", (e) => {
  const sym = e.target.closest(".earn-row")?.dataset.sym;
  if (sym) return go(sym);
  const row = e.target.closest(".cal-row");
  if (!row || !row.dataset.desc) return;
  const open = row.nextElementSibling?.classList.contains("cal-desc");
  if (open) row.nextElementSibling.remove();
  else row.insertAdjacentHTML("afterend", `<div class="cal-desc">${esc(row.dataset.desc)}</div>`);
});

// Sidebar "Up next": the next two releases / watchlist earnings, visible on every page.
function upcomingItems() {
  const now = Date.now();
  const econ = (state.cal?.economic || []).map((e) => ({
    kind: e.tier, at: etDate(e.datetime), title: e.event,
    sub: `${dayLabel(e.date).split(" · ")[0]} · ${fmtEtTime(e.time)} ET`,
  }));
  // Earnings have no exact time: pre-market ≈ 8:00 AM, after-hours ≈ 4:05 PM ET.
  const earn = (state.cal?.earnings || []).filter((e) => e.watch).map((e) => ({
    kind: "earnings", sym: e.symbol,
    at: etDate(`${e.date}T${e.time === "pre-market" ? "08:00" : e.time === "after-hours" ? "16:05" : "12:00"}`),
    title: t("{sym} earnings", { sym: e.symbol }),
    sub: `${dayLabel(e.date).split(" · ")[0]} · ${t(e.time === "pre-market" ? "before open" : e.time === "after-hours" ? "after close" : "time TBA")}`,
  }));
  const upcoming = [...econ, ...earn].filter((x) => x.at > now - 5 * 6e4).sort((a, b) => a.at - b.at);
  // Show the soonest item, plus the next critical release (or watchlist earnings) if the soonest isn't one.
  const first = upcoming[0];
  if (!first) return [];
  const second = first.kind === "major" ? upcoming.find((x) => x.kind !== "major") || upcoming[1] : upcoming[1];
  return second ? [first, second] : [first];
}

function renderUpNext() {
  const el = $("#upnext");
  const items = upcomingItems();
  if (!items.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="un-head"><span>Up next</span><span>Calendar →</span></div>` + items.map((x) => `
    <div class="un-item ${x.kind}" ${x.sym ? `data-sym="${esc(x.sym)}"` : ""} title="${esc(x.title)}">
      <i></i><div style="min-width:0"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></div>
      <span class="cd">${countdown(x.at - Date.now())}</span>
    </div>`).join("");
}
$("#upnext").addEventListener("click", (e) => {
  document.body.classList.remove("nav-open");
  const sym = e.target.closest("[data-sym]")?.dataset.sym;
  if (sym) return go(sym);
  go("");
  setTimeout(() => $("#cal-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
});

// Stock page: flag an upcoming earnings report.
async function loadNextEarnings(symbol) {
  const el = $("#q-earn");
  el.hidden = true;
  try {
    const e = await api(`/api/next-earnings/${symbol}`);
    if (symbol !== state.symbol || !e.date) return;
    const days = Math.round((new Date(e.date + "T12:00:00") - new Date(nyToday() + "T12:00:00")) / 864e5);
    const when = days === 0 ? t("today") : days === 1 ? t("tomorrow") : t("in {n} days", { n: days });
    const tm = e.time === "pre-market" ? t("before the open") : e.time === "after-hours" ? t("after the close") : "";
    const date = new Date(e.date + "T12:00:00").toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
    el.innerHTML = `📅 ${t("Earnings {when} · {date}", { when, date })}${tm ? ` ${tm}` : ""}${e.eps_consensus != null ? ` · ${t("EPS est. {v}", { v: fmt(e.eps_consensus) })}` : ""}`;
    el.hidden = false;
  } catch {}
}

/* ================================================================ home: indices + movers */
async function loadIndices() {
  try {
    const syms = Object.keys(INDEX_META).join(",");
    const [quotes, sparks] = await Promise.all([api("/api/indices"), api(`/api/sparklines?symbols=${encodeURIComponent(syms)}`).catch(() => ({}))]);
    Object.assign(state.sparks, sparks);
    $("#indices").innerHTML = quotes.map((q) => {
      const prev = q.price != null && q.change_percent != null ? q.price / (1 + q.change_percent / 100) : null;
      return `<div class="index-card" data-sym="${esc(q.symbol)}">
        <div class="ic-top"><span class="ic-name">${INDEX_META[q.symbol] || esc(q.name)}</span><span class="ic-sym mono">${esc(q.symbol)}</span></div>
        <div class="ic-top"><span class="ic-px">${fmt(q.price)}</span><span class="chg-chip ${cls(q.change_percent)}">${pct(q.change_percent)}</span></div>
        ${q.ext ? `<div class="ic-ext">${esc(t(q.ext.label))} ${fmt(q.ext.price)} <span class="${cls(q.ext.change_percent)}">${pct(q.ext.change_percent)}</span></div>` : ""}
        ${spark(state.sparks[q.symbol], { h: 44, ref: prev })}
      </div>`;
    }).join("");
  } catch {}
}
$("#indices").addEventListener("click", (e) => {
  const s = e.target.closest(".index-card")?.dataset.sym;
  if (s) go(s);
});

function renderMovers() {
  const rows = state.movers?.[state.moverKind] || [];
  $("#movers").innerHTML = rows.map((m) => `
    <div class="mv-row" data-sym="${esc(m.symbol)}">${avatar(m.symbol)}
      <div style="min-width:0"><div class="sym">${esc(m.symbol)}</div><div class="nm">${esc(m.name)}</div></div>
      <span class="px mono">${fmt(m.price)}</span><span class="chg-chip ${cls(m.percent_change)}">${pct(m.percent_change)}</span>
    </div>`).join("") || `<div class="muted">No data.</div>`;
}
async function loadMovers() {
  if (!state.movers) $("#movers").innerHTML = skeleton(6);
  try { state.movers = await api("/api/movers"); renderMovers(); } catch (e) {
    $("#movers").innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}
$("#mover-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.moverKind = b.dataset.kind;
  $$("#mover-tabs button").forEach((x) => x.classList.toggle("active", x === b));
  renderMovers();
});
$("#movers").addEventListener("click", (e) => {
  const s = e.target.closest(".mv-row")?.dataset.sym;
  if (s) go(s);
});

/* ================================================================ watchlist + recent */
const inWatchlist = (s) => state.watchlist.includes(s);
function toggleWatch(sym) {
  const adding = !inWatchlist(sym);
  state.watchlist = adding ? [sym, ...state.watchlist] : state.watchlist.filter((s) => s !== sym);
  if (state.user) {
    const q = adding
      ? sb.from("watchlist_items").upsert({ user_id: state.user.id, symbol: sym, sort_order: -Math.floor(Date.now() / 1000) })
      : sb.from("watchlist_items").delete().eq("symbol", sym);
    q.then(({ error }) => error && toast(`Couldn't sync watchlist: ${error.message}`));
  } else {
    store.set("mp.watchlist", state.watchlist);
  }
  renderStar();
  renderWatchlist();
  if (adding) refreshWatchlist(true);
  loadCalendar(); // watchlist earnings feed the calendar and "Up next"
  toast(t(adding ? "{sym} added to watchlist" : "{sym} removed from watchlist", { sym }), false);
}
function renderStar() {
  const on = state.symbol && inWatchlist(state.symbol);
  const b = $("#star-btn");
  b.classList.toggle("on", !!on);
  $(".star", b).textContent = on ? "★" : "☆";
  $(".lbl", b).textContent = on ? "Watching" : "Watch";
}
$("#star-btn").addEventListener("click", () => state.symbol && toggleWatch(state.symbol));

function renderWatchlist() {
  if (wlDragging) return; // don't re-render (e.g. the 10s price refresh) mid-drag
  $("#wl-count").textContent = state.watchlist.length || "";
  if (!state.watchlist.length) {
    $("#watchlist").innerHTML = `<li class="wl-empty">Your watchlist is empty. Open a stock and tap <b>☆ Watch</b> to track it here.</li>`;
    return;
  }
  $("#watchlist").innerHTML = state.watchlist.map((s) => {
    const q = state.wlQuotes[s] || {};
    const prev = q.price != null && q.change != null ? q.price - q.change : null;
    return `<li class="wl-item ${s === state.symbol ? "active" : ""}" data-sym="${esc(s)}" title="${esc(s)}${q.name ? ` · ${esc(q.name)}` : ""} · ${fmt(q.price)} (${pct(q.change_percent)})">
      ${avatar(s, 28)}
      <div style="min-width:0"><div class="sym">${esc(s)}</div><div class="nm">${esc(q.name || "")}</div></div>
      ${spark(state.sparks[s], { w: 56, h: 24, ref: prev, fill: false })}
      <div class="px"><div class="mono">${fmt(q.price)}</div><span class="chg-chip ${cls(q.change_percent)}" style="min-width:0;padding:0 4px">${pct(q.change_percent)}</span>
        ${q.ext ? `<div class="ext-mini" title="${esc(q.ext.label)} ${fmt(q.ext.price)}">${extShort(q.ext)} <b class="${cls(q.ext.change_percent)}">${pct(q.ext.change_percent)}</b></div>` : ""}</div>
      <button class="rm" title="Remove" data-rm="${esc(s)}">×</button>
    </li>`;
  }).join("");
}
async function refreshWatchlist(withSparks = false) {
  if (!state.watchlist.length) return;
  const syms = encodeURIComponent(state.watchlist.join(","));
  try {
    const [qs, sp] = await Promise.all([api(`/api/quotes?symbols=${syms}`), withSparks ? api(`/api/sparklines?symbols=${syms}`).catch(() => ({})) : null]);
    qs.forEach((q) => (state.wlQuotes[q.symbol] = q));
    if (sp) Object.assign(state.sparks, sp);
    renderWatchlist();
  } catch {}
}
// Drag to reorder (mouse + touch). Order is saved to the account when signed in, else locally.
let wlDragging = false, wlDragEndedAt = 0;
if (window.Sortable) {
  Sortable.create($("#watchlist"), {
    draggable: ".wl-item",
    filter: ".rm",
    preventOnFilter: false,
    animation: 160,
    delay: 180,
    delayOnTouchOnly: true, // long-press on phones so the list still scrolls
    ghostClass: "dragging-ghost",
    chosenClass: "dragging-chosen",
    dragClass: "dragging-drag",
    onStart: () => { wlDragging = true; $("#watchlist").classList.add("sorting"); },
    onEnd: (evt) => {
      wlDragging = false;
      wlDragEndedAt = Date.now();
      $("#watchlist").classList.remove("sorting");
      if (evt.oldIndex === evt.newIndex) return;
      saveWatchlistOrder($$("#watchlist .wl-item").map((li) => li.dataset.sym));
    },
  });
}
async function saveWatchlistOrder(order) {
  state.watchlist = order;
  renderWatchlist();
  if (!state.user) return store.set("mp.watchlist", order);
  const { error } = await sb.from("watchlist_items")
    .upsert(order.map((symbol, i) => ({ user_id: state.user.id, symbol, sort_order: i })));
  if (error) toast(`Couldn't save watchlist order: ${error.message}`);
}

$("#watchlist").addEventListener("click", (e) => {
  if (Date.now() - wlDragEndedAt < 300) return; // a drop isn't a click
  const rm = e.target.closest("[data-rm]")?.dataset.rm;
  if (rm) { e.stopPropagation(); return toggleWatch(rm); }
  const s = e.target.closest(".wl-item")?.dataset.sym;
  if (s) { go(s); document.body.classList.remove("nav-open"); }
});

function pushRecent(sym) {
  state.recent = [sym, ...state.recent.filter((s) => s !== sym)].slice(0, 8);
  store.set("mp.recent", state.recent);
  renderRecent();
}
function renderRecent() {
  $("#recent").innerHTML = state.recent.map((s) => `<span class="chip" data-sym="${esc(s)}">${esc(s)}</span>`).join("") || `<span class="muted tiny">Nothing yet</span>`;
}
$("#recent").addEventListener("click", (e) => {
  const s = e.target.closest(".chip")?.dataset.sym;
  if (s) { go(s); document.body.classList.remove("nav-open"); }
});

// Once the quote card scrolls under the top bar, show a compact quote in the bar instead.
const topQuoteIO = new IntersectionObserver(([e]) => {
  const on = !e.isIntersecting && !$("#stock-view").hidden && e.boundingClientRect.top < 60;
  document.body.classList.toggle("quote-docked", on);
  $("#top-quote").setAttribute("aria-hidden", String(!on));
  $("#top-quote").tabIndex = on ? 0 : -1;
}, { rootMargin: "-60px 0px 0px 0px" });
topQuoteIO.observe($(".quote-card"));
$("#top-quote").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

function setSideCollapsed(on) {
  document.body.classList.toggle("side-collapsed", on);
  store.set("mp.sideCollapsed", on);
  const lbl = t(on ? "Expand watchlist" : "Collapse watchlist");
  $("#side-toggle").title = lbl;
  $("#side-toggle").setAttribute("aria-label", lbl);
  setTimeout(() => dispatchEvent(new Event("resize")), 220); // let the chart / options table refit after the transition
}
setSideCollapsed(document.body.classList.contains("side-collapsed"));
$("#side-toggle").addEventListener("click", () => setSideCollapsed(!document.body.classList.contains("side-collapsed")));
$("#menu-btn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("#scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));

/* ================================================================ search palette */
const palette = $("#palette"), input = $("#search-input"), list = $("#search-results");
let searchTimer, searchSel = 0, searchReq = 0, listFor = "";

function openPalette() {
  palette.hidden = false;
  input.value = "";
  renderSearchOptions([], "");
  setTimeout(() => input.focus(), 10);
}
const closePalette = () => (palette.hidden = true);
$("#search-trigger").addEventListener("click", openPalette);
palette.addEventListener("mousedown", (e) => { if (e.target === palette) closePalette(); });
document.addEventListener("keydown", (e) => {
  if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) {
    e.preventDefault();
    palette.hidden ? openPalette() : closePalette();
  } else if (e.key === "Escape" && !palette.hidden) closePalette();
});

function renderSearchOptions(items, q) {
  listFor = q;
  let groups;
  if (!q) {
    const recent = state.recent.map((s) => [s, (state.wlQuotes[s] || {}).name || "Recently viewed"]);
    groups = [["Recent", recent.slice(0, 5)], ["Popular", POPULAR.filter(([s]) => !state.recent.slice(0, 5).includes(s)).slice(0, 6)]];
  } else {
    const opts = items.map((i) => [i.symbol, i.name]);
    if (/^[A-Za-z.\-^]{1,6}$/.test(q) && !opts.some(([s]) => s === q.toUpperCase())) opts.push([q.toUpperCase(), "Open ticker directly"]);
    groups = [["Results", opts]];
  }
  let idx = 0;
  const html = groups.filter(([, o]) => o.length).map(([g, o]) =>
    `<li class="grp">${g}</li>` + o.map(([s, n]) => `<li class="opt" data-i="${idx++}" data-sym="${esc(s)}">${avatar(s, 28)}<span class="sym">${esc(s)}</span><span class="nm">${esc(n)}</span><span class="go">↵</span></li>`).join("")).join("");
  list.innerHTML = html || `<li class="none">${t("No matches for “{q}”.", { q: esc(q) })}</li>`;
  searchSel = 0;
  highlight();
}
function highlight() {
  $$(".opt", list).forEach((li) => li.classList.toggle("sel", +li.dataset.i === searchSel));
  $(`.opt[data-i="${searchSel}"]`, list)?.scrollIntoView({ block: "nearest" });
}
input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (!q) return renderSearchOptions([], "");
  searchTimer = setTimeout(async () => {
    const req = ++searchReq;
    const items = await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []);
    if (req === searchReq && input.value.trim() === q) renderSearchOptions(items, q);
  }, 180);
});
input.addEventListener("keydown", (e) => {
  const n = $$(".opt", list).length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (n) searchSel = (searchSel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    highlight();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const q = input.value.trim();
    if (q && listFor !== q) return submitSearch(q); // results for this text haven't arrived yet
    const sym = $(`.opt[data-i="${searchSel}"]`, list)?.dataset.sym || q.toUpperCase();
    if (sym) { closePalette(); go(sym); }
  }
});
// Enter pressed before results loaded: search now and open the best match
// (an exact ticker match wins, else the top result, else the text as a ticker).
async function submitSearch(q) {
  clearTimeout(searchTimer);
  const req = ++searchReq;
  list.innerHTML = `<li class="none">${t("Searching “{q}”…", { q: esc(q) })}</li>`;
  const items = await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []);
  if (req !== searchReq || palette.hidden) return;
  const exact = items.find((i) => i.symbol === q.toUpperCase());
  const sym = exact?.symbol || items[0]?.symbol || (/^[A-Za-z.\-^]{1,6}$/.test(q) ? q.toUpperCase() : null);
  if (!sym) return renderSearchOptions(items, q);
  closePalette();
  go(sym);
}

list.addEventListener("mousemove", (e) => {
  const i = e.target.closest(".opt")?.dataset.i;
  if (i != null && +i !== searchSel) { searchSel = +i; highlight(); }
});
list.addEventListener("click", (e) => {
  const s = e.target.closest(".opt")?.dataset.sym;
  if (s) { closePalette(); go(s); }
});

/* ================================================================ AI analysis */
async function loadConfig() {
  const cfg = await api("/api/config");
  state.cfg = cfg;
  const saved = store.get("mp.model", cfg.default_model);
  const models = cfg.models.some((m) => m.id === cfg.default_model) ? cfg.models : [{ id: cfg.default_model, label: cfg.default_model, price: "custom" }, ...cfg.models];
  const opts = models.map((m) => `<option value="${esc(m.id)}" ${m.id === saved ? "selected" : ""}>${esc(m.label)} · ${esc(m.price)}</option>`).join("");
  $$(".model-select").forEach((sel) => { sel.innerHTML = opts; sel.title = "USD per 1M tokens (input / output)"; });
  renderModelChips();
}
// One AI model / Deep think preference for every AI feature (set in Settings, shown as a chip on each card).
const currentModel = () => store.get("mp.model", null) || state.cfg?.default_model;
function renderModelChips() {
  const id = currentModel();
  const m = (state.cfg?.models || []).find((x) => x.id === id);
  const name = m ? m.label : id || "AI model";
  const deep = store.get("mp.deep", false);
  $$(".model-chip").forEach((c) => {
    $(".mc-name", c).textContent = `${name}${deep ? " · deep" : ""}`;
    c.title = `AI model: ${name}${m ? ` (${m.price} per 1M tokens)` : ""}${deep ? " · Deep think on" : ""} — change in Settings`;
  });
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-open-settings]")) openSettings(); });

$$(".model-select").forEach((sel) => sel.addEventListener("change", (e) => {
  store.set("mp.model", e.target.value);
  $$(".model-select").forEach((o) => (o.value = e.target.value));
  renderModelChips();
  schedulePrefsSync();
}));

function aiEmpty(symbol) {
  const cached = store.get(`mp.ai.${symbol}`, null);
  if (cached) return showAnalysis(cached.text, cached, false);
  $("#analyze-btn span").textContent = "Analyze";
  $("#ai-body").innerHTML = `<div class="ai-empty">
      <div class="ai-feed"><b>Live quote</b>Price, volume, moving averages, 52-week range</div>
      <div class="ai-feed"><b>Fundamentals</b>Valuation multiples, growth, margins, leverage</div>
      <div class="ai-feed"><b>Performance</b>1W · 1M · 3M · 6M · 1Y returns</div>
      <div class="ai-feed"><b>Headlines</b>${t("{n} latest news stories on {sym}", { n: 15, sym: esc(symbol) })}</div>
      ${state.aiEnabled
        ? `<div class="ai-note muted">${t("Click {btn} for a structured research note on {sym} — typically under $0.001 per run.", { btn: `<b>${t("Analyze")}</b>`, sym: esc(symbol) })}</div>`
        : `<div class="ai-note" style="grid-column:1/-1">${aiGateHTML("analysis")}</div>`}
    </div>`;
}

function stanceOf(text) {
  // Prefer the TL;DR section: with a user question, the answer section comes first and may mention any stance.
  const sec = text.match(/###\s*TL;?DR([\s\S]*?)(?=\n###|$)/i);
  const tldr = (sec ? sec[1] : text.split(/###\s*News/i)[0] || text).toLowerCase();
  const m = tldr.match(/\b(bullish|bearish|neutral)\b|看多|看空|中性/);
  return m ? m[1] || { 看多: "bullish", 看空: "bearish", 中性: "neutral" }[m[0]] : null;
}

const usageBits = (m) => [m?.model, m?.completion_tokens ? `${m.prompt_tokens + m.completion_tokens} tokens` : null,
  m?.cost != null ? `$${Number(m.cost).toFixed(5)}` : null, m?.at ? ago(m.at) : null].filter(Boolean).join(" · ");
const md = (text) => DOMPurify.sanitize(marked.parse(text || ""));

// The analysis, any follow-up Q&A under it, and the follow-up box. `ai` is the saved record:
// { text, model, question, usage…, at, thread: [{ q, a, model, cost, at, … }] }.
function showAnalysis(text, meta, streaming) {
  const stance = stanceOf(text);
  const stanceHTML = stance ? `<span class="stance ${{ bullish: "bull", bearish: "bear", neutral: "neutral" }[stance]}">${{ bullish: "▲", bearish: "▼", neutral: "◆" }[stance]} ${t(stance[0].toUpperCase() + stance.slice(1))}</span>` : "";
  $("#ai-body").innerHTML = `
    <div class="ai-meta">${stanceHTML}<span class="muted tiny">${esc(usageBits(meta))}</span><span class="sp"></span>${!streaming ? `<button class="btn" id="copy-ai" style="height:30px;padding:0 10px;font-size:12px">Copy</button>` : ""}</div>
    ${meta?.question ? `<div class="ai-q"><b>Q</b>${esc(meta.question)}</div>` : ""}
    ${streaming && !text ? `<div class="ai-thinking"><div class="spinner"></div>Gathering OpenBB data and analyzing…</div>` : ""}
    <div class="ai-output ${streaming ? "streaming" : ""}">${md(text)}</div>
    <div id="ai-thread" class="ai-thread"></div>
    ${!streaming && state.aiEnabled ? `<form class="ai-follow" id="ai-follow" autocomplete="off">
      <textarea id="ai-followup" rows="1" maxlength="1000" placeholder="${esc(t("Ask a follow-up question…"))}"></textarea>
      <button class="btn primary" type="submit" id="ai-follow-btn"><span>${t("Ask")}</span></button>
    </form>` : ""}`;
  $("#copy-ai")?.addEventListener("click", () => navigator.clipboard.writeText(text).then(() => toast("Analysis copied", false)));
  if (!streaming) $("#analyze-btn span").textContent = "Regenerate";
  renderThread(meta?.thread || []);
  const f = $("#ai-follow");
  if (f) {
    f.addEventListener("submit", (e) => { e.preventDefault(); askFollowUp(); });
    $("#ai-followup").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); askFollowUp(); } // Shift+Enter for a new line
    });
  }
}

function renderThread(thread, streaming = false) {
  const el = $("#ai-thread");
  if (!el) return;
  el.innerHTML = thread.map((x, i) => {
    const live = streaming && i === thread.length - 1;
    return `<div class="ai-turn">
      <div class="ai-q"><b>Q</b>${esc(x.q)}</div>
      ${live && !x.a ? `<div class="ai-thinking"><div class="spinner"></div>${t("Thinking…")}</div>` : ""}
      <div class="ai-output ${live ? "streaming" : ""}">${md(x.a)}</div>
      ${!live && x.at ? `<div class="muted tiny ai-turn-meta">${esc(usageBits(x))}</div>` : ""}
    </div>`;
  }).join("");
}

// POST an AI request and stream the Markdown answer; calls onText(fullText) as it grows. Returns { text, usage, context }.
// isCurrent() says whether the view that asked is still on screen (else the stream is abandoned).
async function streamText(url, payload, onText, isCurrent = () => true) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ lang: LANG, ...payload }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", usage = {}, context = null, pending = false, finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (raw.match(/^event: (.*)$/m) || [])[1] || "message";
        const data = JSON.parse((raw.match(/^data: (.*)$/m) || [, "{}"])[1]);
        if (!isCurrent()) throw new DOMException("moved on", "AbortError");
        if (ev === "error") throw new Error(data.error);
        if (ev === "usage") usage = data;
        else if (ev === "context") context = data;
        else if (data.text) text += data.text;
      }
      if (!pending) {
        pending = true;
        // A frame still queued when the stream ends must not repaint over the caller's final render.
        requestAnimationFrame(() => { pending = false; if (!finished && isCurrent()) onText(text); });
      }
    }
  } finally {
    finished = true;
  }
  return { text, usage, context };
}

const streamAnalyze = (symbol, body, onText) =>
  streamText("/api/analyze", { symbol, ...body }, onText, () => symbol === state.symbol);

async function analyze() {
  if (!state.aiEnabled) return promptAiSetup();
  const symbol = state.symbol, btn = $("#analyze-btn"), model = currentModel();
  const question = $("#ai-question").value.trim();
  btn.disabled = true;
  $("#analyze-btn span").textContent = question ? "Answering…" : "Analyzing…";
  let text = "", meta = { model, ...(question ? { question } : {}) }; // a new analysis starts a fresh thread
  showAnalysis("", meta, true);
  try {
    const res = await streamAnalyze(symbol, { model, question: question || null }, (tx) => { text = tx; showAnalysis(tx, meta, true); });
    text = res.text;
    meta = { ...meta, ...res.usage, at: new Date().toISOString() };
    store.set(`mp.ai.${symbol}`, { text, ...meta });
    showAnalysis(text, meta, false);
  } catch (e) {
    if (symbol !== state.symbol) return;
    text ? showAnalysis(text, meta, false) : aiEmpty(symbol);
    toast(t("AI analysis failed: {msg}", { msg: e.message }));
  } finally {
    btn.disabled = false;
  }
}

async function askFollowUp() {
  if (!state.aiEnabled) return promptAiSetup();
  const symbol = state.symbol, input = $("#ai-followup"), q = input?.value.trim();
  const ai = store.get(`mp.ai.${symbol}`, null);
  if (!q || !ai?.text || $("#ai-follow-btn").disabled) return;
  const thread = ai.thread || [];
  // The conversation so far: the analysis, then each follow-up and its answer.
  const history = [{ role: "assistant", content: ai.text }, ...thread.flatMap((x) => [{ role: "user", content: x.q }, { role: "assistant", content: x.a }])];
  const model = currentModel(), turn = { q, a: "" };
  const live = [...thread, turn];
  input.value = "";
  $("#ai-follow-btn").disabled = $("#analyze-btn").disabled = true;
  $("#ai-follow-btn span").textContent = t("Thinking…");
  renderThread(live, true);
  try {
    const res = await streamAnalyze(symbol, { model, question: q, history, first_question: ai.question || null },
      (tx) => { turn.a = tx; renderThread(live, true); });
    Object.assign(turn, { a: res.text, model, ...res.usage, at: new Date().toISOString() });
    store.set(`mp.ai.${symbol}`, { ...ai, thread: live });
  } catch (e) {
    if (symbol !== state.symbol) return;
    live.pop();
    if (input.isConnected && !input.value) input.value = q; // give the question back so it can be retried
    toast(t("AI analysis failed: {msg}", { msg: e.message }));
  } finally {
    if (symbol === state.symbol) {
      renderThread(live);
      $("#analyze-btn").disabled = false;
      if ($("#ai-follow-btn")) { $("#ai-follow-btn").disabled = false; $("#ai-follow-btn span").textContent = t("Ask"); }
    }
  }
}
$("#analyze-btn").addEventListener("click", analyze);
$("#ai-question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !$("#analyze-btn").disabled) { e.preventDefault(); analyze(); }
});

/* ================================================================ trade opportunities */
const money = (n, d = 0) => (n == null ? "∞" : `${n < 0 ? "-" : ""}$${fmt(Math.abs(n), d)}`);
const shortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "2-digit" });

async function loadSignals(symbol, quiet = false) {
  if (!quiet) {
    state.signals = null;
    $("#signals").innerHTML = Array.from({ length: 8 }, () => `<div class="sig sk" style="height:86px"></div>`).join("");
  }
  try {
    const sig = await api(`/api/signals/${symbol}`);
    if (symbol !== state.symbol) return;
    state.signals = sig;
    renderSignals();
    drawLevels();
  } catch (e) {
    if (symbol === state.symbol && !quiet) $("#signals").innerHTML = `<div class="muted" style="grid-column:1/-1">${t("Signals unavailable for {sym} ({msg}).", { sym: esc(symbol), msg: esc(e.message) })}</div>`;
  }
}

function renderSignals() {
  const tr = window.t; // `t` is the technicals object in here
  const { technicals: t, options: o } = state.signals;
  const px = t.price;
  const rsiLbl = t.rsi14 >= 70 ? ["Overbought", "down"] : t.rsi14 <= 30 ? ["Oversold", "up"] : t.rsi14 >= 55 ? ["Bullish momentum", "up"] : t.rsi14 <= 45 ? ["Bearish momentum", "down"] : ["Neutral", ""];
  const smaChips = [[20, t.sma20], [50, t.sma50], [200, t.sma200]].filter(([, v]) => v)
    .map(([n, v]) => `<span class="lv ${px > v ? "sup" : "res"}">${px > v ? "▲" : "▼"} ${n}D ${fmt(v)}</span>`).join("");
  const trendCls = /up/i.test(t.trend) ? "up" : /down/i.test(t.trend) ? "down" : "";
  const exp = o?.expirations?.find((e) => e.dte >= 20) || o?.expirations?.[0];
  let emHTML = `<div class="v">—</div><div class="d">No listed options</div>`;
  if (exp) {
    const lo = px - exp.expected_move, hi = px + exp.expected_move;
    const min = Math.min(lo, t.low_52w ?? lo) * 0.98, max = Math.max(hi, t.high_52w ?? hi) * 1.02;
    const pos = (v) => ((v - min) / (max - min)) * 100;
    emHTML = `<div class="v">±${fmt(exp.expected_move)} <span class="muted tiny">(±${fmt(exp.expected_move_pct, 1)}%)</span></div>
      <div class="d">${tr("By {date} · range {lo} – {hi}", { date: shortDate(exp.expiration), lo: fmt(lo), hi: fmt(hi) })}</div>
      <div class="em-bar" title="Options-implied 1σ range vs 52-week range"><span style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></span><b style="left:${pos(px)}%"></b></div>`;
  }
  const tiles = [
    `<div class="sig"><div class="k">Trend</div><div class="v ${trendCls}">${esc(t.trend)}</div><div class="lv-row">${smaChips}</div></div>`,
    `<div class="sig"><div class="k">RSI 14 <span class="${rsiLbl[1]}">${rsiLbl[0]}</span></div><div class="v">${fmt(t.rsi14, 1)}</div><div class="gauge"><i style="left:${Math.min(100, Math.max(0, t.rsi14))}%"></i></div></div>`,
    `<div class="sig"><div class="k">MACD <span class="${t.macd_cross === "bullish" ? "up" : "down"}">${tr(t.macd_cross)}</span></div><div class="v ${cls(t.macd_hist)}">${t.macd_hist >= 0 ? "+" : ""}${fmt(t.macd_hist, 3)}</div><div class="d">${tr("MACD {m} · signal {s}", { m: fmt(t.macd, 2), s: fmt(t.macd_signal, 2) })}</div></div>`,
    `<div class="sig"><div class="k">ATR 14</div><div class="v">${fmt(t.atr14)}</div><div class="d">${tr("{atr}% daily range · vol {v}× avg", { atr: fmt(t.atr_pct), v: fmt(t.vol_ratio) })}</div></div>`,
    `<div class="sig wide"><div class="k">Key levels</div><div class="lv-row">${(t.resistance || []).slice().reverse().map((x) => `<span class="lv res">R ${fmt(x)}</span>`).join("")}<span class="lv px">● ${fmt(px)}</span>${(t.support || []).map((x) => `<span class="lv sup">S ${fmt(x)}</span>`).join("")}</div><div class="d" style="margin-top:6px">${tr("20-day {a} – {b} · 52-week {c} – {d}", { a: fmt(t.low_20d), b: fmt(t.high_20d), c: fmt(t.low_52w), d: fmt(t.high_52w) })}</div></div>`,
    `<div class="sig wide"><div class="k">Expected move (options)</div>${emHTML}</div>`,
    `<div class="sig"><div class="k">IV vs HV</div><div class="v">${o?.iv30 != null ? `${fmt(o.iv30, 1)}%` : "—"} <span class="muted tiny">/ ${fmt(t.hv20, 1)}%</span></div><div class="d">${o?.iv_hv_ratio ? `${fmt(o.iv_hv_ratio)}× · ${esc(tr((o.vol_regime || "").split("(")[0].trim()))}` : "30d implied / 20d realized"}</div></div>`,
    `<div class="sig"><div class="k">Put / Call OI</div><div class="v">${exp ? fmt(exp.put_call_oi) : "—"}</div><div class="d">${exp ? `${tr(exp.put_call_oi > 1 ? "Put-heavy (hedging)" : "Call-heavy")} · ${tr("vol P/C {v}", { v: fmt(exp.put_call_volume) })}` : ""}</div></div>`,
    `<div class="sig wide"><div class="k">${tr("Largest open interest")} ${exp ? `· ${shortDate(exp.expiration)}` : ""}</div><div class="lv-row">${exp ? exp.top_call_oi.map((x) => `<span class="lv res">C ${fmt(x, x % 1 ? 1 : 0)}</span>`).join("") + exp.top_put_oi.map((x) => `<span class="lv sup">P ${fmt(x, x % 1 ? 1 : 0)}</span>`).join("") : "—"}</div><div class="d" style="margin-top:6px">Big OI strikes often act as magnets / walls near expiration.</div></div>`,
    `<div class="sig wide"><div class="k">Momentum</div><div class="lv-row">${[["1W", t.ret_1w], ["1M", t.ret_1m], ["3M", t.ret_3m]].map(([k, v]) => `<span class="lv ${v >= 0 ? "sup" : "res"}">${k} ${pct(v)}</span>`).join("")}</div><div class="d" style="margin-top:6px">${tr("Close vs 20D high: {v}", { v: pct((px / t.high_20d - 1) * 100) })}</div></div>`,
  ];
  $("#signals").innerHTML = tiles.join("");
}

/* ================================================================ options chain */
const optState = { data: null, view: "both", strikes: store.get("mp.optStrikes", 25) };
async function loadOptions(symbol, expiration = null, strikes = optState.strikes) {
  const req = (optState.req = (optState.req || 0) + 1); // ignore stale responses when settings change quickly
  $("#opt-table").innerHTML = `<div class="sk-line"></div><div class="sk-line" style="width:80%"></div><div class="sk-line" style="width:60%"></div>`;
  if (!expiration) { $("#opt-stats").innerHTML = ""; $("#opt-exp").innerHTML = ""; }
  try {
    const url = `/api/options/${symbol}?strikes=${strikes}${expiration ? `&expiration=${expiration}` : ""}`;
    let d;
    for (let attempt = 0; ; attempt++) { // Yahoo's options endpoint fails intermittently
      try { d = await api(url); break; } catch (e) {
        if (attempt >= 1 || symbol !== state.symbol) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (symbol !== state.symbol || req !== optState.req) return;
    optState.data = d;
    renderOptions();
  } catch (e) {
    if (symbol === state.symbol && req === optState.req) $("#opt-table").innerHTML = `<div class="muted">${t("Options unavailable for {sym} ({msg}).", { sym: esc(symbol), msg: esc(e.message) })}</div>`;
  }
}
function renderOptions() {
  const d = optState.data;
  if (!d.expirations.length) {
    $("#opt-exp").hidden = true;
    $("#opt-stats").innerHTML = "";
    $("#opt-table").innerHTML = `<div class="muted">${t("No listed options for {sym}.", { sym: esc(state.symbol) })}</div>`;
    return;
  }
  $("#opt-exp").hidden = false;
  $("#opt-exp").innerHTML = d.expirations.map((e) => `<option value="${e.expiration}">${shortDate(e.expiration)} · ${e.dte}d</option>`).join("");
  $("#opt-exp").value = d.expiration;
  const s = d.summary;
  $("#opt-sub").textContent = t("Chain by expiration · {src}", { src: t(s.quoted ? "delayed mid-quotes" : "last trade prices (market closed)") });
  renderFlow(d.flow, d.expiration);
  $("#opt-stats").innerHTML = [
    ["ATM IV", s.atm_iv != null ? `${fmt(s.atm_iv, 1)}%` : "—"],
    ["Expected move", s.expected_move != null ? `±${fmt(s.expected_move)} · ${fmt(s.expected_move_pct, 1)}%` : "—"],
    ["Max pain", fmt(s.max_pain)],
    ["Days to exp.", d.dte],
    ["Call OI", s.call_oi ? big(s.call_oi) : "—"], ["Put OI", s.put_oi ? big(s.put_oi) : "—"], ["P/C OI", fmt(s.put_call_oi)], ["P/C volume", fmt(s.put_call_volume)],
  ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");

  const view = optState.view, showC = view !== "put", showP = view !== "call";
  // Drop the least useful columns first so both sides fit the card without sideways scrolling.
  const ALL = [["Bid", "bid"], ["Ask", "ask"], ["Mid", "mid"], ["IV", "iv"], ["Δ", "delta"], ["Vol", "volume"], ["OI", "oi"]];
  const sides = (showC ? 1 : 0) + (showP ? 1 : 0);
  const fit = Math.max(2, Math.floor(($("#opt-table").clientWidth - 76) / 66 / sides));
  const keep = ["mid", "iv", "oi", "delta", "volume", "bid", "ask"].slice(0, fit === 6 ? 5 : fit); // bid/ask only as a pair
  const cols = ALL.filter(([, k]) => keep.includes(k));
  optState.fit = fit;
  const cell = (l, k) => {
    if (!l) return `<td class="na">—</td>`;
    const v = l[k];
    const txt = k === "iv" ? (v != null ? `${fmt(v, 1)}%` : "—") : k === "volume" || k === "oi" ? (v ? big(v) : "—")
      : k === "delta" ? fmt(v) : k === "mid" && !l.quoted ? `<span title="Last trade (no live quote)">${fmt(v)}*</span>` : v ? fmt(v) : "—";
    return `<td>${txt}</td>`;
  };
  const side = (l, flip) => (flip ? cols.slice().reverse() : cols).map(([, k]) => cell(l, k)).join("");
  const head = (flip) => (flip ? cols.slice().reverse() : cols).map(([h]) => `<th>${h}</th>`).join("");
  // Calls read right-to-left toward the strike so both sides' mids sit next to it.
  const spot = d.spot;
  let spotDone = false;
  const body = d.rows.map((r) => {
    let line = "";
    if (!spotDone && r.strike >= spot) {
      spotDone = true;
      line = `<tr class="spot-row"><td colspan="${(showC ? cols.length : 0) + 1 + (showP ? cols.length : 0)}"><span>${t("Spot {px}", { px: fmt(spot) })}</span></td></tr>`;
    }
    return line + `<tr data-strike="${r.strike}">` +
      (showC ? side(r.call, true).replace(/<td/g, `<td class="c${r.strike < spot ? " itm" : ""}"`) : "") +
      `<td class="strike">${fmt(r.strike, r.strike % 1 ? 2 : 0)}</td>` +
      (showP ? side(r.put, false).replace(/<td/g, `<td class="p${r.strike > spot ? " itm" : ""}"`) : "") + `</tr>`;
  }).join("");
  $("#opt-table").innerHTML = `<table class="opt-table mono">
    <thead><tr class="grp">${showC ? `<th colspan="${cols.length}" class="c">Calls</th>` : ""}<th></th>${showP ? `<th colspan="${cols.length}" class="p">Puts</th>` : ""}</tr>
    <tr>${showC ? head(true) : ""}<th class="strike">Strike</th>${showP ? head(false) : ""}</tr></thead>
    <tbody>${body}</tbody></table>
    <p class="muted tiny opt-foot">${t("Shaded cells are in the money.")} ${s.quoted ? "" : t("* priced from last trade — no live bid/ask outside market hours.") + " "}${t("Δ is Black-Scholes delta from the contract's IV.")}</p>`;
  // Center the at-the-money strikes in the scroll box.
  const wrap = $("#opt-table"), spotRow = $(".spot-row", wrap);
  if (spotRow) wrap.scrollTop = spotRow.offsetTop - wrap.clientHeight / 2;
  if (optState.focus) focusContract();
}

// Jump to the contract picked in Biggest flow and blink it for a few seconds.
function focusContract() {
  const { strike, kind, expiration } = optState.focus;
  const d = optState.data;
  if (d.expiration !== expiration) return;
  const tr = $(`.opt-table tr[data-strike="${strike}"]`);
  if (!tr) {
    if (optState.focus.widened) { optState.focus = null; return; }
    optState.focus.widened = true; // strike lies outside the ±N window: fetch every strike for this view
    loadOptions(state.symbol, expiration, 0);
    return;
  }
  optState.focus = null;
  const wrap = $("#opt-table");
  wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  wrap.scrollTo({ top: tr.offsetTop - wrap.clientHeight / 2 + tr.offsetHeight / 2, behavior: "smooth" });
  const cells = [...tr.querySelectorAll(`td.${kind === "call" ? "c" : "p"}, td.strike`)];
  cells.forEach((c) => { c.classList.remove("blink"); void c.offsetWidth; c.classList.add("blink"); });
  setTimeout(() => cells.forEach((c) => c.classList.remove("blink")), 3400);
}
// Re-pick the chain's columns when the card width changes (sidebar/news column reflow, window resize).
function refitOptions() {
  if (!optState.data?.rows?.length) return;
  const sides = optState.view === "both" ? 2 : 1;
  const fit = Math.max(2, Math.floor(($("#opt-table").clientWidth - 76) / 66 / sides));
  if (Math.min(fit, 7) !== Math.min(optState.fit, 7)) renderOptions();
}
new ResizeObserver(refitOptions).observe($("#opt-table"));
addEventListener("resize", refitOptions);
// Biggest call / put contracts across all expirations — reference outside the near-the-money table.
function renderFlow(flow, current) {
  const el = $("#opt-flow");
  if (!flow || (!flow.calls.length && !flow.puts.length)) { el.innerHTML = ""; return; }
  const item = (x, kind) => `<button class="flow-item ${kind}${x.expiration === current ? " cur" : ""}" data-exp="${x.expiration}" data-strike="${x.strike}"
      title="${kind === "call" ? "Call" : "Put"} ${fmt(x.strike, x.strike % 1 ? 2 : 0)} · ${shortDate(x.expiration)} (${x.dte}d) · ${fmt(x.mid)} premium · vol ${x.volume.toLocaleString()} / OI ${x.oi ? x.oi.toLocaleString() : "—"} — click to jump to it in the chain">
      <span class="fl-k">${fmt(x.strike, x.strike % 1 ? 2 : 0)}${kind === "call" ? "C" : "P"}</span>
      <span class="fl-e">${shortDate(x.expiration)}</span>
      <span class="fl-p">$${big(x.premium)}</span>
      <span class="fl-v">${t("{v} vol", { v: big(x.volume) })} · ${x.otm_pct >= 0 ? "+" : ""}${fmt(x.otm_pct, 1)}%${x.unusual ? ` <b class="fl-u">unusual</b>` : ""}</span>
    </button>`;
  const row = (label, list, kind) => list.length ? `<div class="flow-row"><span class="flow-lbl ${kind}">${label}</span><div class="flow-list">${list.map((x) => item(x, kind)).join("")}</div></div>` : "";
  el.innerHTML = `<div class="sub-h">Biggest flow <span class="muted tiny" style="text-transform:none;letter-spacing:0;font-weight:500">${t("all expirations · strikes within ±30% · by premium traded (vol × price × 100)")}${optState.data?.summary?.quoted ? "" : ` · ${t("last session")}`}</span></div>`
    + row("Calls", flow.calls, "call") + row("Puts", flow.puts, "put");
}
$("#opt-flow").addEventListener("click", (e) => {
  const b = e.target.closest(".flow-item");
  if (!b || !state.symbol || !optState.data) return;
  const kind = b.classList.contains("call") ? "call" : "put";
  optState.focus = { strike: +b.dataset.strike, kind, expiration: b.dataset.exp };
  if (optState.view !== "both" && optState.view !== kind) { // the filter hides this side
    optState.view = "both";
    $$("#opt-view button").forEach((x) => x.classList.toggle("active", x.dataset.view === "both"));
    if (b.dataset.exp === optState.data.expiration) return renderOptions();
  }
  if (b.dataset.exp === optState.data.expiration) focusContract();
  else loadOptions(state.symbol, b.dataset.exp);
});
$("#opt-strikes").value = String(optState.strikes);
$("#opt-strikes").addEventListener("change", (e) => {
  optState.strikes = +e.target.value;
  store.set("mp.optStrikes", optState.strikes);
  if (state.symbol) loadOptions(state.symbol, optState.data?.expiration);
});
$("#opt-exp").addEventListener("change", (e) => state.symbol && loadOptions(state.symbol, e.target.value));
$("#opt-view").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || !optState.data) return;
  optState.view = b.dataset.view;
  $$("#opt-view button").forEach((x) => x.classList.toggle("active", x === b));
  renderOptions();
});

/* ================================================================ corporate events */
async function loadEvents(symbol) {
  state.events = null;
  $("#ev-card").hidden = false;
  $("#events").innerHTML = `<div class="sk-line"></div><div class="sk-line" style="width:75%"></div><div class="sk-line" style="width:55%"></div>`;
  try {
    const ev = await api(`/api/events/${symbol}`);
    if (symbol !== state.symbol) return;
    state.events = ev;
    renderEvents(ev);
  } catch {
    if (symbol === state.symbol) $("#ev-card").hidden = true;
  }
}
function renderEvents(ev) {
  const parts = [];
  const e = ev.earnings;
  if (e) {
    const when = e.days === 0 ? t("Today") : e.days === 1 ? t("Tomorrow") : t("in {n} days", { n: e.days });
    const range = e.eps_low != null && e.eps_high != null ? ` <span class="muted">(${fmt(e.eps_low)}–${fmt(e.eps_high)})</span>` : "";
    parts.push(`<div class="ev-next ${e.days <= 7 ? "soon" : ""}">
      <div class="ev-k">Next earnings <span class="ev-when">${when}</span></div>
      <div class="ev-date">${shortDate(e.date)}${e.time ? ` <span class="muted">· ${t(e.time)}</span>` : ""}</div>
      <div class="ev-est">${e.eps_estimate != null ? `${t("EPS est")} <b class="mono">${fmt(e.eps_estimate)}</b>${range}` : ""}${e.revenue_estimate ? ` · ${t("Rev est")} <b class="mono">$${big(e.revenue_estimate)}</b>` : ""}</div>
    </div>`);
  }
  if (ev.history.length) {
    // Day = the report date's session, Next = the session after. The one that first prices in the report
    // (Day for before-open reports, Next for after-close) is the reaction and is shown bold.
    const move = (v, react, tip) => `<span class="ev-react ${cls(v)}${react ? " is-react" : ""}" title="${t(tip)}${react ? ` · ${t("reaction to the report")}` : ""}">${v != null ? pct(v, 1) : "—"}</span>`;
    parts.push(`<div class="ev-sec">Earnings history</div>
      <div class="ev-row ev-head"><span></span><span>${t("EPS / est")}</span><span>${t("Surprise")}</span><span>${t("Day")}</span><span>${t("Next")}</span></div>
      <div class="ev-hist">${ev.history.map((h) => {
      const beat = h.eps_estimate == null ? null : h.eps >= h.eps_estimate;
      const bmo = h.timing === "before_open";
      const mdate = new Date(h.date + "T12:00:00").toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
      return `<div class="ev-row"><span class="muted" title="${shortDate(h.date)} · ${t(bmo ? "Before open" : "After close")}">${mdate} ${bmo ? "☀" : "☾"}</span>
        <span class="mono" title="${t("Reported EPS / estimate")}">${fmt(h.eps)}<span class="muted">/${fmt(h.eps_estimate)}</span></span>
        ${beat == null ? "<span></span>" : `<span class="ev-tag ${beat ? "up" : "down"}" title="${t(beat ? "Beat the EPS estimate" : "Missed the EPS estimate")}">${h.surprise_pct != null ? pct(h.surprise_pct, 0) : beat ? "Beat" : "Miss"}</span>`}
        ${move(h.day_pct, bmo, "Stock move on the report date")}${move(h.next_day_pct, !bmo, "Stock move on the session after the report date")}</div>`;
    }).join("")}</div>
      <div class="muted tiny ev-note">${t("☾ after close · ☀ before open · bold = the session that reacted to the report")}</div>`);
  }
  const d = ev.dividends;
  if (d?.amount) {
    const freq = { 1: "annual", 2: "semi-annual", 4: "quarterly", 12: "monthly" }[d.per_year] || `${d.per_year}×/yr`;
    const px = state.lastPrice;
    const upcoming = d.ex_date && new Date(d.ex_date + "T23:59:59") >= new Date();
    parts.push(`<div class="ev-sec">Dividend</div><div class="ev-div">
      <div><b class="mono">$${fmt(d.amount, d.amount < 0.1 ? 4 : 2)}</b> <span class="muted">${freq}</span>${d.raised ? ` <span class="ev-tag up">Raised</span>` : ""}</div>
      <div class="muted tiny">${t("{a}/yr", { a: `$${fmt(d.annual)}` })}${px ? ` · ${t("{y}% yield", { y: fmt((d.annual / px) * 100) })}` : ""}</div>
      <div class="tiny">${t(upcoming ? "Upcoming ex-div" : "Last ex-div")} <b>${shortDate(d.ex_date || d.last_ex_date)}</b>${d.pay_date ? ` · ${t("paid {date}", { date: shortDate(d.pay_date) })}` : ""}</div>
    </div>`);
  }
  if (ev.filings.length) {
    parts.push(`<div class="ev-sec">SEC filings</div><div class="ev-files">${ev.filings.map((f) => `
      <a class="ev-file" href="${esc(f.url)}" target="_blank" rel="noopener">
        <span class="ev-form">${esc(f.form)}</span><span class="ev-title">${esc(f.title)}</span><span class="muted tiny">${shortDate(f.date)}</span>
      </a>`).join("")}</div>`);
  }
  if (ev.split) parts.push(`<div class="ev-split muted tiny">${t("Last split:")} <b>${esc(ev.split.ratio)}</b> ${t("on {date}", { date: shortDate(ev.split.date) })}</div>`);
  $("#ev-card").hidden = !parts.length;
  $("#events").innerHTML = parts.join("");
}

const RISKS = {
  conservative: { label: "Conservative", desc: "Defined-risk only — credit/debit spreads, covered calls, cash-secured puts. Higher win-rate, smaller payoff." },
  moderate: { label: "Moderate", desc: "Balanced reward/risk — debit spreads and long options around 0.30–0.60 delta, sensible stops." },
  aggressive: { label: "Aggressive", desc: "Directional conviction — lower-delta long options, shorter expirations. Bigger payoff, lower win-rate." },
};
const tradeKey = (sym, risk) => `mp.trade.${sym}.${risk}`;
function getTrade(sym, risk) {
  const t = store.get(tradeKey(sym, risk), null);
  if (t) return t;
  const legacy = store.get(`mp.trade.${sym}`, null); // pre per-risk storage
  return legacy && (legacy.risk_profile || "moderate") === risk ? legacy : null;
}

function setRisk(r, { reload = true } = {}) {
  state.risk = r;
  store.set("mp.risk", r);
  schedulePrefsSync();
  $$("#risk-tabs button").forEach((b) => { b.classList.toggle("active", b.dataset.risk === r); b.setAttribute("aria-checked", b.dataset.risk === r); });
  $("#risk-desc").textContent = t(RISKS[r].desc);
  if (!$("#trade-btn").disabled) $("#trade-btn span").textContent = "Generate ideas";
  $("#trade-btn").title = `Generate ${RISKS[r].label.toLowerCase()} trade ideas`;
  if (reload && state.symbol && !$("#trade-btn").disabled) {
    const t = getTrade(state.symbol, r);
    t ? showTrade(t) : tradeEmpty();
  }
}
$("#risk-tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setRisk(b.dataset.risk); });

function tradeEmpty() {
  state.trade = null;
  drawLevels();
  const r = state.risk, sym = state.symbol;
  $("#trade-btn span").textContent = "Generate ideas";
  if (!state.aiEnabled) {
    $("#trade-body").innerHTML = `<div style="margin-top:8px">${aiGateHTML("trade ideas")}<p class="muted tiny" style="margin-top:8px">The live signals below are computed locally and always available.</p></div>`;
    return;
  }
  const others = Object.keys(RISKS).filter((k) => k !== r && sym && getTrade(sym, k));
  $("#trade-body").innerHTML = `<div class="trade-empty">${t("No {risk} ideas for {sym} yet — click {btn} (~1 min, under $0.01).", { risk: `<b>${t(RISKS[r].label.toLowerCase())}</b>`, sym: `<b>${esc(sym || "")}</b>`, btn: `<b>${t("Generate ideas")}</b>` })}
    ${others.length ? `<div class="others"><span class="muted tiny">Saved:</span>${others.map((k) => `<button class="chip" data-show-risk="${k}">${RISKS[k].label}</button>`).join("")}</div>` : ""}</div>`;
}
$("#trade-body").addEventListener("click", (e) => { const k = e.target.closest("[data-show-risk]")?.dataset.showRisk; if (k) setRisk(k); });

function renderProgress(steps, active, t0) {
  const order = ["data", "model", "validate"];
  const labels = { data: "Pull quote, technicals & option chain (OpenBB)", model: "AI drafts stock setup & option strategies", validate: "Validate contracts against live chain · compute payoffs & POP" };
  $("#trade-body").innerHTML = `<div class="trade-progress">${order.map((k) => {
    const st = order.indexOf(k) < order.indexOf(active) ? "done" : k === active ? "active" : "";
    return `<div class="step ${st}"><span class="ic">${st === "done" ? "✓" : ""}</span>${labels[k]}${k === "model" && st === "active" ? modelProgress(steps, t0) : ""}</div>`;
  }).join("")}</div>`;
}

async function generateTrades() {
  if (!state.aiEnabled) return promptAiSetup();
  const symbol = state.symbol, risk = state.risk, btn = $("#trade-btn");
  btn.disabled = true;
  $("#trade-btn span").textContent = "Generating…";
  let prog = {};
  let active = "data";
  const t0 = Date.now();
  renderProgress(prog, active, t0);
  const timer = setInterval(() => { if (active === "model") renderProgress(prog, active, t0); }, 1000);
  try {
    const r = await fetch("/api/trade-ideas", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ symbol, model: currentModel(), risk, deep: store.get("mp.deep", false), lang: LANG }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", result = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (raw.match(/^event: (.*)$/m) || [])[1] || "message";
        const data = JSON.parse((raw.match(/^data: (.*)$/m) || [, "{}"])[1]);
        if (symbol !== state.symbol) return;
        if (ev === "error") throw new Error(data.error);
        if (ev === "status") active = data.step;
        if (ev === "progress") prog = data;
        if (ev === "result") result = data;
      }
      if (!result) renderProgress(prog, active, t0);
    }
    if (!result) throw new Error("No result returned");
    store.set(tradeKey(symbol, risk), result);
    if (state.risk === risk) showTrade(result);
    else toast(t("{risk} ideas for {sym} are ready", { risk: t(RISKS[risk].label), sym: symbol }), false);
  } catch (e) {
    if (symbol !== state.symbol) return;
    btn.disabled = false;
    const saved = getTrade(symbol, state.risk);
    saved ? showTrade(saved) : tradeEmpty();
    toast(t("Trade ideas failed: {msg}", { msg: e.message }));
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    if (symbol === state.symbol && !$(".thesis")) $("#trade-btn span").textContent = "Generate ideas";
  }
}
$("#trade-btn").addEventListener("click", generateTrades);

function confRing(v, color, label = "confidence") {
  const r = 32, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, v || 0));
  return `<div class="conf"><svg viewBox="0 0 76 76" width="76" height="76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--hover)" stroke-width="6"/>
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}"/></svg>
    <div class="n"><div>${p}<small>${t(label)}</small></div></div></div>`;
}

function payoffSVG(m, spot, id) {
  const pts = m.curve;
  if (!pts?.length) return "";
  const W = 400, H = 140, pad = 6;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const yMax = Math.max(...ys, 0), yMin = Math.min(...ys, 0), span = yMax - yMin || 1;
  const X = (v) => ((v - x0) / (x1 - x0)) * W;
  const Y = (v) => pad + ((yMax - v) / span) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L${W},${Y(0)}L0,${Y(0)}Z`;
  const be = (m.breakevens || []).filter((b) => b > x0 && b < x1);
  return `<div class="payoff" data-id="${id}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <clipPath id="above-${id}"><rect x="0" y="0" width="${W}" height="${Y(0)}"/></clipPath>
      <clipPath id="below-${id}"><rect x="0" y="${Y(0)}" width="${W}" height="${H}"/></clipPath>
    </defs>
    <path d="${area}" fill="var(--up)" opacity=".18" clip-path="url(#above-${id})"/>
    <path d="${area}" fill="var(--down)" opacity=".18" clip-path="url(#below-${id})"/>
    <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--border-2)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <path d="${line}" fill="none" stroke="var(--up)" stroke-width="2" clip-path="url(#above-${id})" vector-effect="non-scaling-stroke"/>
    <path d="${line}" fill="none" stroke="var(--down)" stroke-width="2" clip-path="url(#below-${id})" vector-effect="non-scaling-stroke"/>
    <line x1="${X(spot)}" x2="${X(spot)}" y1="0" y2="${H}" stroke="var(--text)" stroke-dasharray="3 3" opacity=".5" vector-effect="non-scaling-stroke"/>
    ${be.map((b) => `<circle cx="${X(b)}" cy="${Y(0)}" r="3.5" fill="var(--warn)"/>`).join("")}
    <line class="hover" x1="-10" x2="-10" y1="0" y2="${H}" stroke="var(--accent)" vector-effect="non-scaling-stroke"/>
  </svg><div class="tip">${t("At expiry · spot {px}", { px: fmt(spot) })}</div></div>`;
}

// metricsById: { [payoff data-id]: metrics }
function bindPayoffs(root, metricsById) {
  $$(".payoff", root).forEach((el) => {
    const m = metricsById[el.dataset.id];
    if (!m) return;
    const svg = $("svg", el), tip = $(".tip", el), hl = $(".hover", el);
    const xs = m.curve.map((p) => p[0]);
    const def = tip.textContent;
    svg.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const f = (e.clientX - rect.left) / rect.width;
      const S = xs[0] + f * (xs[xs.length - 1] - xs[0]);
      let k = 0;
      while (k < m.curve.length - 2 && m.curve[k + 1][0] < S) k++;
      const [a, b] = [m.curve[k], m.curve[k + 1]];
      const pl = a[1] + ((b[1] - a[1]) * (S - a[0])) / (b[0] - a[0] || 1);
      hl.setAttribute("x1", f * 400); hl.setAttribute("x2", f * 400);
      tip.innerHTML = `${state.symbol} ${fmt(S)} → <span class="${cls(pl)}">${pl >= 0 ? "+" : ""}${money(pl)}</span>`;
    });
    svg.addEventListener("mouseleave", () => { tip.textContent = def; hl.setAttribute("x1", -10); hl.setAttribute("x2", -10); });
  });
}

function optCardHTML(o, id, spot) {
  const m = o.metrics || {};
  return `<div class="opt-card">
      <div><div class="t">${esc(o.name)}</div><div class="o">${esc(o.outlook || "")}</div></div>
      <div class="mgrid">
        <div class="m"><div class="k">${t(`Net ${m.net_type || ""}`.trim())}</div><div class="v ${m.net_type === "credit" ? "up" : ""}">${money(Math.abs(m.net ?? 0))}</div></div>
        <div class="m"><div class="k">Max profit</div><div class="v up">${m.max_profit == null ? "Unlimited" : money(m.max_profit)}</div></div>
        <div class="m"><div class="k">Max loss</div><div class="v down">${m.max_loss == null ? "Unlimited" : money(m.max_loss)}</div></div>
        <div class="m"><div class="k">Breakeven</div><div class="v be">${(m.breakevens || []).map((b) => fmt(b)).join(" / ") || "—"}</div></div>
        <div class="m"><div class="k">Prob. profit</div><div class="v">${m.pop != null ? `${fmt(m.pop, 0)}%` : "—"}</div></div>
        <div class="m"><div class="k">Reward / risk</div><div class="v">${m.reward_risk != null ? `${fmt(m.reward_risk)}×` : m.max_profit == null ? "Open" : "—"}</div></div>
      </div>
      ${payoffSVG(m, spot, id)}
      <div class="legs-wrap"><table class="legs"><thead><tr><th></th><th>Qty</th><th>Contract</th><th>Mid</th><th>Δ</th><th>IV</th></tr></thead><tbody>
        ${o.legs.map((l) => `<tr><td class="act ${l.action}">${t(l.action.toUpperCase())}</td><td>${l.qty}</td><td>${legLabel(l)}</td><td>${l.type === "stock" ? "" : fmt(l.mid)}</td><td>${l.delta != null ? fmt(l.delta) : ""}</td><td>${l.iv != null ? `${fmt(l.iv, 0)}%` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <details><summary>Why this trade · management · risks</summary>
        ${o.rationale ? `<p><b>Why:</b> ${esc(o.rationale)}</p>` : ""}${o.management ? `<p><b>Manage:</b> ${esc(o.management)}</p>` : ""}${o.risks ? `<p><b>Risk:</b> ${esc(o.risks)}</p>` : ""}
        ${(o.notes || []).map((n) => `<p class="muted tiny">↺ ${esc(n)}</p>`).join("")}
      </details>
    </div>`;
}

function legLabel(l) {
  if (l.type === "stock") return `${l.qty * 100} sh ${esc(state.symbol)} @ ${fmt(l.price)}`;
  const d = new Date(l.expiration + "T12:00:00").toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
  return `${d} <b>${fmt(l.strike, l.strike % 1 ? 1 : 0)}${l.type === "call" ? "C" : "P"}</b> <span class="muted">${l.dte}d</span>`;
}

function showTrade(d) {
  state.trade = d;
  drawLevels();
  const biasColor = { bullish: "var(--up)", bearish: "var(--down)" }[d.bias] || "var(--warn)";
  const bias = d.bias || "neutral";
  const u = d.usage || {};
  const meta = [u.model, u.cost != null ? `$${Number(u.cost).toFixed(4)}` : null, d.generated_at ? ago(d.generated_at) : null, d.spot ? `ref price ${fmt(d.spot)}` : null].filter(Boolean).join(" · ");

  const st = d.stock_trade || {};
  const sm = st.metrics || {};
  let plan = "";
  if (st.direction === "long" || st.direction === "short") {
    const tg = (st.targets || []).map((x, i) => `<div class="lvl tgt"><div class="k">${t("Target {n}", { n: i + 1 })}</div><div class="v">${fmt(x)}</div><div class="d up">${pct(sm.targets_pct?.[i])} · ${sm.reward_risk?.[i] != null ? `${fmt(sm.reward_risk[i], 1)}R` : ""}</div></div>`).join("");
    plan = `<div class="plan">
      <div class="plan-head"><span class="dir ${st.direction}">${st.direction === "long" ? "▲ LONG" : "▼ SHORT"}</span><b>${esc(st.setup || "")}</b><span class="muted tiny">· ${esc(st.timeframe || "")}</span>${st.conditional || Math.abs(sm.entry_vs_spot_pct ?? 0) > 1 ? `<span class="chip static">Limit entry · wait for zone</span>` : ""}</div>
      <div class="plan-grid">
        <div class="lvl entry"><div class="k">Entry zone</div><div class="v">${fmt(st.entry_low)} – ${fmt(st.entry_high)}</div><div class="d muted">${t("{p} vs now", { p: pct(sm.entry_vs_spot_pct) })}</div></div>
        <div class="lvl stop"><div class="k">Stop</div><div class="v">${fmt(st.stop)}</div><div class="d down">${pct(sm.stop_pct)} · ${t("risk {r}/sh", { r: money(sm.risk_per_share, 2) })}</div></div>
        ${tg}
      </div>
      <dl class="kv"><dt>Rationale</dt><dd>${esc(st.rationale || "")}</dd><dt>Invalidation</dt><dd>${esc(st.invalidation || "")}</dd></dl>
      ${sm.consistent === false ? `<div class="warn-note">⚠︎ Levels look inconsistent with the direction — double-check before using.</div>` : ""}
    </div>`;
  } else {
    plan = `<div class="plan"><div class="plan-head"><span class="dir none">NO TRADE</span><b>${esc(st.setup || "No clean stock setup right now")}</b></div><p class="muted">${esc(st.rationale || "")}</p></div>`;
  }

  const ideas = d.option_ideas || [];
  const optHTML = ideas.map((o, idx) => optCardHTML(o, `t${idx}`, d.spot)).join("");

  const list = (xs) => (xs || []).map((x) => `<li>${esc(x)}</li>`).join("");
  $("#trade-body").innerHTML = `
    <div class="thesis">${confRing(d.confidence, biasColor)}
      <div><div class="thesis-top"><span class="stance ${{ bullish: "bull", bearish: "bear" }[bias] || "neutral"}">${{ bullish: "▲", bearish: "▼" }[bias] || "◆"} ${t(bias[0].toUpperCase() + bias.slice(1))}</span>
        <span class="chip static">${esc(t("{r} risk", { r: t(d.risk_profile || "") }))}</span><span class="muted tiny">${esc(meta)}</span></div>
        <p>${esc(d.summary || "")}</p></div>
    </div>
    <div class="sub-h">Stock setup</div>${plan}
    ${ideas.length ? `<div class="sub-h">Option strategies</div><div class="opt-grid">${optHTML}</div>` : ""}
    ${(d.catalysts?.length || d.risks?.length) ? `<div class="sub-h">Catalysts & risks</div><div class="bullets"><div><b class="tiny muted">CATALYSTS</b><ul>${list(d.catalysts)}</ul></div><div><b class="tiny muted">RISKS</b><ul>${list(d.risks)}</ul></div></div>` : ""}`;
  bindPayoffs($("#trade-body"), Object.fromEntries(ideas.map((o, i) => [`t${i}`, o.metrics])));
  $("#trade-btn span").textContent = "Regenerate";
}

/* ================================================================ my position */
function modelProgress(p, t0) {
  const secs = Math.round((Date.now() - t0) / 1000);
  const bits = [`${secs}s`];
  if (p.thinking && !p.chars) bits.push(t("thinking… {n}k chars", { n: (p.thinking / 1000).toFixed(1) }));
  if (p.chars) bits.push(t("writing {n} chars", { n: p.chars }));
  return ` <span class="muted tiny mono">${bits.join(" · ")}</span>`;
}

const posKey = (sym) => `mp.pos.${sym}`;
const posHash = (ps) => JSON.stringify(ps);
const form = $("#pos-form");
const posForm = { kind: "stock", side: "long", type: "call" };

function segPick(id, attr, val) {
  $$(`#${id} button`).forEach((b) => b.classList.toggle("active", b.dataset[attr] === val));
}

function openPosForm(open = true) {
  form.hidden = !open;
  $(".pos-empty")?.toggleAttribute("hidden", open);
  $("#pos-add-toggle span").textContent = open ? "Close" : "+ Add position";
  if (open) {
    setPosKind(posForm.kind);
    $("#pos-qty").focus();
  }
}
$("#pos-add-toggle").addEventListener("click", () => openPosForm(form.hidden));
$("#pos-cancel").addEventListener("click", () => openPosForm(false));

function setPosKind(kind) {
  posForm.kind = kind;
  segPick("pos-kind", "kind", kind);
  form.classList.toggle("is-option", kind === "option");
  $("#pos-qty-lbl").textContent = kind === "option" ? "Contracts" : "Shares";
  $("#pos-qty").placeholder = kind === "option" ? "1" : "100";
  $("#pos-cost-lbl").textContent = kind === "option" ? "Premium / share" : "Avg cost / share";
  if (kind === "option") loadChainMeta(state.symbol);
  updatePosHint();
}
$("#pos-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setPosKind(b.dataset.kind); });
$("#pos-side").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { posForm.side = b.dataset.side; segPick("pos-side", "side", b.dataset.side); } });
$("#pos-type").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { posForm.type = b.dataset.type; segPick("pos-type", "type", b.dataset.type); updatePosHint(); } });

async function loadChainMeta(symbol) {
  if (state.chainMeta?.symbol === symbol) return;
  $("#pos-exp").innerHTML = `<option>Loading…</option>`;
  $("#pos-strike").innerHTML = "";
  try {
    const meta = await api(`/api/chain-meta/${symbol}`);
    if (symbol !== state.symbol) return;
    state.chainMeta = { symbol, ...meta };
    if (!meta.expirations.length) {
      $("#pos-exp").innerHTML = `<option value="">No listed options</option>`;
      return;
    }
    $("#pos-exp").innerHTML = meta.expirations.map((e) => `<option value="${e.expiration}">${shortDate(e.expiration)} · ${e.dte}d</option>`).join("");
    const monthly = meta.expirations.find((e) => e.dte >= 25) || meta.expirations[0];
    $("#pos-exp").value = monthly.expiration;
    fillStrikes();
  } catch {
    $("#pos-exp").innerHTML = `<option value="">Options unavailable</option>`;
  }
}
function fillStrikes() {
  const e = state.chainMeta?.expirations.find((x) => x.expiration === $("#pos-exp").value);
  if (!e) return;
  const spot = state.chainMeta.spot;
  $("#pos-strike").innerHTML = e.strikes.map((k) => `<option value="${k}">${k}</option>`).join("");
  $("#pos-strike").value = e.strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
  updatePosHint();
}
$("#pos-exp").addEventListener("change", fillStrikes);
$("#pos-strike").addEventListener("change", updatePosHint);

function currentMark() {
  if (posForm.kind === "stock") return state.lastPrice;
  const e = state.chainMeta?.expirations.find((x) => x.expiration === $("#pos-exp").value);
  return e?.mids[$("#pos-strike").value]?.[posForm.type] ?? null;
}
function updatePosHint() {
  const m = currentMark();
  if (posForm.kind === "stock") { $("#pos-form-hint").textContent = m != null ? t("Current price: {px}", { px: fmt(m) }) : ""; return; }
  const e = state.chainMeta?.expirations.find((x) => x.expiration === $("#pos-exp").value);
  const live = e?.live?.[$("#pos-strike").value]?.[posForm.type];
  $("#pos-form-hint").textContent = m != null
    ? t("{src}: {px} ({c} per contract)", { src: t(live ? "Current mid" : "Last trade (no live quote)"), px: fmt(m), c: money(m * 100) })
    : t("No trades yet for this contract — enter your cost");
}
$("#pos-use-mark").addEventListener("click", () => { const m = currentMark(); if (m != null) $("#pos-cost").value = m; });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const qty = parseFloat($("#pos-qty").value), cost = parseFloat($("#pos-cost").value);
  if (!(qty > 0) || !(cost >= 0)) return toast("Enter a quantity and cost.");
  const p = { kind: posForm.kind, side: posForm.side, qty, cost };
  if (posForm.kind === "option") {
    if (!$("#pos-exp").value || !$("#pos-strike").value) return toast("Pick an expiration and strike.");
    Object.assign(p, { type: posForm.type, strike: parseFloat($("#pos-strike").value), expiration: $("#pos-exp").value });
  }
  if (state.user) {
    const { data, error } = await sb.from("positions").insert(toPosRow(state.symbol, p, state.user.id)).select().single();
    if (error) return toast(`Couldn't save position: ${error.message}`);
    p.id = data.id;
  }
  state.positions.push(p);
  if (!state.user) store.set(posKey(state.symbol), state.positions);
  $("#pos-qty").value = "";
  $("#pos-cost").value = "";
  openPosForm(false);
  toast("Position added", false);
  evaluatePositions();
});

async function removePosition(i) {
  const p = state.positions[i];
  if (state.user && p?.id) {
    const { error } = await sb.from("positions").delete().eq("id", p.id);
    if (error) return toast(`Couldn't remove position: ${error.message}`);
  }
  state.positions.splice(i, 1);
  if (!state.user) store.set(posKey(state.symbol), state.positions);
  evaluatePositions();
}

async function evaluatePositions() {
  const symbol = state.symbol;
  if (!state.positions.length) {
    state.posEval = null;
    renderPositions();
    return;
  }
  if (!state.posEval) $("#pos-body").innerHTML = skeleton(3);
  try {
    const ev = await api("/api/positions/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, positions: state.positions }) });
    if (symbol !== state.symbol) return;
    state.posEval = ev;
    renderPositions();
    if (ev.rows.some((r) => r.unpriced)) setTimeout(() => symbol === state.symbol && evaluatePositions(), 8000);
  } catch (e) {
    if (symbol === state.symbol) $("#pos-body").innerHTML = `<div class="err">${t("Couldn't price positions — {msg}", { msg: esc(e.message) })}</div>`;
  }
}

const ACTION_TONE = { hold: "good", add: "good", take_profit: "good", trim: "mid", roll: "mid", hedge: "mid", cut_loss: "bad", close: "bad" };
const VERDICT_TONE = { hold: "good", add: "good", trim: "mid", roll: "mid", hedge: "mid", close: "bad" };

// Shares keep trading pre/post market; options don't, so only stock legs move.
function extPnl(ev) {
  const e = state.ext;
  const stock = ev.rows.filter((r) => r.kind === "stock");
  if (!e || e.price == null || !stock.length) return "";
  const d = stock.reduce((a, r) => a + (r.side === "buy" ? 1 : -1) * r.qty * (e.price - r.mark), 0);
  return `<div class="ext-mini" title="Change in your shares' value at the ${esc(e.label.toLowerCase())} price (${fmt(e.price)})">${esc(e.label)} <b class="${cls(d)}">${d >= 0 ? "+" : ""}${money(d)}</b></div>`;
}

function renderPositions() {
  const ev = state.posEval;
  $("#pos-review").hidden = !state.positions.length;
  drawLevels();
  if (!state.positions.length) {
    $("#pos-body").innerHTML = `<div class="pos-empty"><b>${t("No position in {sym}", { sym: esc(state.symbol) })}</b><div class="muted tiny">${t("Use {btn} to enter the shares or option contracts you hold — you'll see live P/L, greeks and a combined payoff, and can ask AI to review it.", { btn: `<b>${t("+ Add position")}</b>` })}</div></div>`;
    return;
  }
  if (!ev) return;
  const tot = ev.total;
  const review = state.posReview && state.posReview.hash === posHash(state.positions) ? state.posReview : null;
  const actions = Object.fromEntries((review?.positions || []).map((p) => [p.index, p]));
  const rows = ev.rows.map((r) => {
    // Cost has its own "Unit cost" column; the caption shows the current price and contract details.
    const sub = r.unpriced ? `<span class="warn-note" style="margin:0">price unavailable</span>`
      : r.kind === "option"
      ? `${r.quoted === false ? "last" : "mid"} ${fmt(r.mark)} · ${r.dte}d · ${r.moneyness}${r.iv ? ` · IV ${fmt(r.iv, 0)}%` : ""}`
      : t("now {px}", { px: fmt(r.mark) });
    const a = actions[r.index];
    return `<tr>
      <td><div class="desc"><span class="kind ${r.side === "buy" ? "long" : "short"}">${r.side === "buy" ? "LONG" : "SHORT"}</span><div><b>${esc(r.label.replace(/^(Long|Short) /, ""))}</b><div class="sub">${sub}</div></div></div></td>
      <td>${fmt(r.cost)}<div class="sub">${r.kind === "option" ? t("{c}/contract", { c: money(r.cost * 100) }) : t("per share")}</div></td>
      <td>${money(r.market_value)}</td>
      <td class="${cls(r.pnl)}">${r.pnl >= 0 ? "+" : ""}${money(r.pnl)}</td>
      <td class="${cls(r.pnl_pct)}">${pct(r.pnl_pct, 1)}</td>
      <td>${fmt(r.delta, 0)}</td>
      <td class="${r.theta ? cls(r.theta) : ""}">${r.theta ? money(r.theta, 2) : "—"}</td>
      <td><button class="rm-btn" title="Remove" data-rm-pos="${r.index}">×</button></td>
    </tr>${a ? `<tr class="act-row"><td colspan="8"><span class="act-chip ${ACTION_TONE[a.action] || "mid"}"><b>${esc(t(String(a.action).replace("_", " ")))}</b>${esc(a.reason || "")}</span></td></tr>` : ""}`;
  }).join("");
  const p = ev.payoff;
  $("#pos-body").innerHTML = `
    <div class="pos-summary">
      <div class="m"><div class="k">Market value</div><div class="v">${money(tot.market_value)}</div><div class="ext-mini">${t("cost {c}", { c: money(tot.cost_basis) })}</div></div>
      <div class="m"><div class="k">Unrealized P/L</div><div class="v ${cls(tot.pnl)}">${tot.pnl >= 0 ? "+" : ""}${money(tot.pnl)} <span class="tiny">${pct(tot.pnl_pct, 1)}</span></div>${extPnl(ev)}</div>
      <div class="m" title="Share-equivalent exposure: P/L change per $1 move in the stock"><div class="k">Net delta</div><div class="v">${fmt(tot.delta, 0)} <span class="tiny muted">sh</span></div></div>
      <div class="m" title="Estimated P/L from one day of time decay"><div class="k">Theta / day</div><div class="v ${tot.theta ? cls(tot.theta) : ""}">${money(tot.theta, 2)}</div></div>
    </div>
    <div class="pos-table-wrap"><table class="pos-table">
      <thead><tr><th>Position</th><th title="Average cost per share (options: premium per share, ×100 per contract)">Unit cost</th><th>Value</th><th>P/L</th><th>%</th><th>Δ</th><th>Θ/day</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${p ? `<div class="pos-payoff"><div class="row"><b style="font-size:13px">${t("Combined payoff at {date}", { date: shortDate(p.horizon) })}</b>
      <span class="muted tiny">${t("Breakeven {be} · Max profit {mp} · Max loss {ml} · P(profit) {pop}%", { be: (p.breakevens || []).map((b) => fmt(b)).join(" / ") || "—", mp: p.max_profit == null ? t("unlimited") : money(p.max_profit), ml: p.max_loss == null ? t("unlimited") : money(p.max_loss), pop: fmt(p.pop, 0) })}</span></div>
      ${payoffSVG(p, ev.spot, "pos")}</div>` : ""}
    ${(ev.notes || []).map((n) => `<p class="muted tiny">↺ ${esc(n)}</p>`).join("")}`;
  if (p) bindPayoffs($("#pos-body"), { pos: p });
}
$("#pos-body").addEventListener("click", (e) => { const i = e.target.closest("[data-rm-pos]")?.dataset.rmPos; if (i != null) removePosition(+i); });

async function reviewPositions() {
  if (!state.aiEnabled) return promptAiSetup();
  const symbol = state.symbol, btn = $("#pos-review-btn"), question = $("#pos-question").value.trim();
  const hash = posHash(state.positions);
  btn.disabled = true;
  $("#pos-review-btn span").textContent = "Reviewing…";
  const labels = { data: "Mark positions to market & pull signals", model: "AI reviews thesis, risk & exits", validate: "Price suggested adjustments on the live chain" };
  const order = ["data", "model", "validate"];
  let active = "data", prog = {};
  const t0 = Date.now();
  const paint = () => ($("#pos-review-body").innerHTML = `<div class="trade-progress">${order.map((k) => {
    const st = order.indexOf(k) < order.indexOf(active) ? "done" : k === active ? "active" : "";
    return `<div class="step ${st}"><span class="ic">${st === "done" ? "✓" : ""}</span>${labels[k]}${k === "model" && st === "active" ? modelProgress(prog, t0) : ""}</div>`;
  }).join("")}</div>`);
  paint();
  const timer = setInterval(() => { if (active === "model") paint(); }, 1000);
  try {
    const r = await fetch("/api/positions/review", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ symbol, positions: state.positions, question, model: currentModel(), deep: store.get("mp.deep", false), lang: LANG }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", result = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (raw.match(/^event: (.*)$/m) || [])[1] || "message";
        const data = JSON.parse((raw.match(/^data: (.*)$/m) || [, "{}"])[1]);
        if (symbol !== state.symbol) return;
        if (ev === "error") throw new Error(data.error);
        if (ev === "status") active = data.step;
        if (ev === "progress") prog = data;
        if (ev === "result") result = data;
      }
      if (!result) paint();
    }
    if (!result) throw new Error("No result returned");
    result.hash = hash;
    state.posReview = result;
    store.set(`mp.posreview.${symbol}`, result);
    renderReview();
    renderPositions();
  } catch (e) {
    if (symbol !== state.symbol) return;
    renderReview();
    toast(t("Review failed: {msg}", { msg: e.message }));
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    $("#pos-review-btn span").textContent = state.posReview ? "Review again" : "Review my position";
  }
}
$("#pos-review-btn").addEventListener("click", reviewPositions);

function renderReview() {
  const r = state.posReview;
  if (!r) return ($("#pos-review-body").innerHTML = "");
  const stale = r.hash !== posHash(state.positions);
  const tone = VERDICT_TONE[r.verdict] || "mid";
  const color = { good: "var(--up)", bad: "var(--down)", mid: "var(--warn)" }[tone];
  const u = r.usage || {};
  const meta = [u.model, u.cost != null ? `$${Number(u.cost).toFixed(4)}` : null, r.generated_at ? ago(r.generated_at) : null, r.spot ? `ref price ${fmt(r.spot)}` : null].filter(Boolean).join(" · ");
  const lvl = (label, v, c, sub) => `<div class="lvl ${c}"><div class="k">${label}</div><div class="v">${v != null ? fmt(v) : "—"}</div>${sub ? `<div class="d muted">${esc(sub)}</div>` : ""}</div>`;
  const adj = r.adjustments || [];
  $("#pos-review-body").innerHTML = `
    ${stale ? `<div class="warn-note" style="margin:12px 0 0">⚠︎ Your positions changed since this review — run it again for an up-to-date view.</div>` : ""}
    <div class="thesis">${confRing(r.health, color, "health")}
      <div><div class="thesis-top"><span class="verdict ${tone}">${esc(t(r.verdict || ""))}</span><span class="muted tiny">${esc(meta)}</span></div>
      <p>${esc(r.summary || "")}</p></div>
    </div>
    ${r.answer && r.question ? `<div class="answer"><div class="q">“${esc(r.question)}”</div>${esc(r.answer)}</div>` : ""}
    <div class="sub-h">Exit plan</div>
    <div class="levels-grid">
      ${lvl("Stop loss", r.stop_loss, "stop", r.stop_loss && r.spot ? t("{p} from ref", { p: pct((r.stop_loss / r.spot - 1) * 100) }) : "")}
      ${lvl("Take profit", r.take_profit, "tgt", r.take_profit && r.spot ? t("{p} from ref", { p: pct((r.take_profit / r.spot - 1) * 100) }) : "")}
      <div class="lvl entry"><div class="k">Watch levels</div>${(r.watch_levels || []).map((w) => `<div class="d" style="margin-top:4px"><b class="mono">${fmt(w.price)}</b> <span class="muted">${esc(w.why || "")}</span></div>`).join("") || `<div class="v">—</div>`}</div>
    </div>
    ${r.risk_flags?.length ? `<div class="sub-h">Risk flags</div><ul class="flags">${r.risk_flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    ${adj.length ? `<div class="sub-h">Suggested adjustments</div><div class="opt-grid">${adj.map((a, i) => optCardHTML(a, `a${i}`, r.spot)).join("")}</div>` : ""}`;
  if (adj.length) bindPayoffs($("#pos-review-body"), Object.fromEntries(adj.map((a, i) => [`a${i}`, a.metrics])));
}

async function loadPositionsFor(symbol) {
  state.positions = state.user ? [] : store.get(posKey(symbol), []);
  if (state.user) {
    const { data, error } = await sb.from("positions").select("*").eq("symbol", symbol).order("created_at");
    if (symbol !== state.symbol) return;
    if (error) toast(`Couldn't load positions: ${error.message}`);
    state.positions = (data || []).map(fromPosRow);
  }
  state.posEval = null;
  state.posReview = store.get(`mp.posreview.${symbol}`, null);
  state.chainMeta = state.chainMeta?.symbol === symbol ? state.chainMeta : null;
  openPosForm(false);
  $("#pos-question").value = "";
  $("#pos-review-btn span").textContent = state.posReview ? "Review again" : "Review my position";
  renderPositions();
  renderReview();
  if (state.positions.length) evaluatePositions();
}

/* ================================================================ chart controls */
$("#range-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.range = b.dataset.range;
  $$("#range-tabs button").forEach((x) => x.classList.toggle("active", x === b));
  renderTfTabs();
  loadHistory();
});
$("#style-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.style = b.dataset.style;
  store.set("mp.style", state.style);
  $$("#style-tabs button").forEach((x) => x.classList.toggle("active", x === b));
  renderChart(false);
});
$$("#style-tabs button").forEach((x) => x.classList.toggle("active", x.dataset.style === state.style));
renderTfTabs();

/* ================================================================ routing */
function go(symbol) {
  const hash = symbol ? `#/${encodeURIComponent(symbol.toUpperCase())}` : "#/";
  if (location.hash === hash || (hash === "#/" && !location.hash)) route(); // same page: refresh it
  else location.hash = hash;
}

async function route() {
  const symbol = decodeURIComponent(location.hash.replace(/^#\/?/, "")).toUpperCase();
  window.scrollTo(0, 0);
  if (!symbol) {
    setChartExpanded(false);
    state.symbol = null;
    state.source?.close();
    $("#stock-view").hidden = true;
    $("#home-view").hidden = false;
    document.body.classList.remove("quote-docked"); // the observer sees no change when the card goes from off-screen to hidden
    document.title = "Maru Pulse";
    renderWatchlist();
    return;
  }
  Object.assign(state, { symbol, lastPrice: null, prevClose: null, bars: [], rawBars: [], quote: null, overview: null, baseStats: null, trade: null, signals: null });
  $("#home-view").hidden = true;
  $("#stock-view").hidden = false;
  document.title = `${symbol} · Maru Pulse`;
  $("#q-symbol").textContent = symbol;
  $("#q-name").textContent = "";
  $("#q-exch").textContent = "";
  $("#q-price").textContent = "—";
  $("#q-change").textContent = "";
  $("#q-change").className = "delta";
  $("#q-updated").textContent = "";
  renderExt(null);
  setAvatar(symbol);
  $("#stats").innerHTML = `<div class="sk-line" style="grid-column:1/-1"></div><div class="sk-line" style="grid-column:1/-1;width:70%"></div>`;
  $("#ranges").innerHTML = "";
  $("#legend").innerHTML = "";
  $("#range-ret").innerHTML = "";
  priceSeries?.setData([]);
  volSeries.setData([]);
  renderStar();
  renderWatchlist();
  $("#ai-question").value = "";
  aiEmpty(symbol);
  state.signals = null;
  const saved = getTrade(symbol, state.risk);
  saved ? showTrade(saved) : tradeEmpty();
  loadSignals(symbol);
  loadOptions(symbol);
  loadPositionsFor(symbol);
  loadEvents(symbol);
  loadStockNews(symbol);
  loadOverview(symbol);
  loadNextEarnings(symbol);
  loadHistory();
  try {
    let q;
    for (let attempt = 0; ; attempt++) { // Yahoo quotes fail intermittently; retry before giving up
      try { q = await api(`/api/quote/${symbol}`); break; } catch (e) {
        if (attempt >= 2 || symbol !== state.symbol) throw e;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    if (symbol !== state.symbol) return;
    renderQuote(q);
    pushRecent(symbol);
    if (state.range === "1D" && state.bars.length) renderChart(false);
    startStream(symbol);
  } catch {
    if (symbol !== state.symbol) return;
    $("#q-name").innerHTML = `<span class="err">${t("Couldn't load a quote for “{sym}” — the data source may be busy, or the ticker may not exist.", { sym: esc(symbol) })}</span> <button class="link-btn" onclick="route()">${t("Retry")}</button>`;
    $("#stats").innerHTML = "";
  }
}
window.addEventListener("hashchange", route);

/* ================================================================ account: Supabase auth, sync, BYOK */
let sb = null; // Supabase client (null when the server has no Supabase config)
state.user = null;
state.byok = null; // { key_hint, updated_at } of the saved OpenRouter key; the key itself never reaches the browser

async function authHeaders() {
  if (!sb) return {};
  const { data } = await sb.auth.getSession(); // refreshes an expired access token
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

function refreshAiAvailability() {
  state.aiEnabled = !!(state.user && state.byok);
  renderBrief();
  renderChat();
  if (state.symbol) {
    if (!$("#analyze-btn").disabled) aiEmpty(state.symbol);
    if (!$("#trade-btn").disabled) { const t = getTrade(state.symbol, state.risk); t ? showTrade(t) : tradeEmpty(); }
  }
}

// Shown wherever AI is unavailable: tells the user exactly what's missing.
function aiGateHTML(what) {
  if (!state.cfg) return "";
  what = t(what);
  if (!sb) return `<div class="ai-note warn">${t("AI {what} needs the server's Supabase settings (see README).", { what })}</div>`;
  if (!state.user) return `<div class="ai-gate">${t("Sign in and add your own OpenRouter API key to use AI {what}.", { what })} <button class="btn primary" onclick="openAuth()">${t("Sign in")}</button></div>`;
  return `<div class="ai-gate">${t("Add your OpenRouter API key to use AI {what}.", { what })} <button class="btn primary" onclick="openSettings()">${t("Add API key")}</button></div>`;
}
function promptAiSetup() {
  if (!state.user) return openAuth();
  openSettings();
  toast("Add your OpenRouter API key to use AI features.");
}

/* ---------------- modals */
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
$$(".modal").forEach((m) => m.addEventListener("mousedown", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.hidden = true; }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => (m.hidden = true)); });

function authMsg(text) { $("#auth-msg").textContent = text; $("#auth-msg").className = `auth-msg ${text ? "err" : ""}`; }
function openAuth() {
  if (!sb) return toast("Sign-in isn't configured on this server.");
  authMsg("");
  openModal("#auth-modal");
}
// Google OAuth (PKCE): Google → Supabase → back here with ?code=…, which supabase-js exchanges for a session.
$("#google-btn").addEventListener("click", async () => {
  const btn = $("#google-btn");
  btn.disabled = true;
  try { sessionStorage.setItem("mp.returnTo", location.hash); } catch {}
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } },
  });
  if (error) { authMsg(error.message || "Couldn't start Google sign-in."); btn.disabled = false; }
});

const displayName = (u) => u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || "Account";
const avatarUrl = (u) => u?.user_metadata?.avatar_url || u?.user_metadata?.picture || "";

function renderAccount() {
  const b = $("#account-btn");
  b.hidden = !sb;
  if (!sb) return;
  const u = state.user;
  b.classList.toggle("signed-in", !!u);
  const pic = avatarUrl(u);
  b.innerHTML = !u ? "<span>Sign in</span>"
    : pic ? `<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${esc(displayName(u)[0].toUpperCase())}'))">`
    : `<span>${esc(displayName(u)[0].toUpperCase())}</span>`;
  b.title = u ? t("{name} — Settings", { name: displayName(u) }) : t("Sign in with Google");
}
$("#account-btn").addEventListener("click", () => (state.user ? openSettings() : openAuth()));

/* ---------------- settings */
function openSettings() {
  if (!state.user) return openAuth();
  const u = state.user, pic = avatarUrl(u);
  $("#set-user").innerHTML = `${pic ? `<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer">` : `<span class="ph">${esc(displayName(u)[0].toUpperCase())}</span>`}
    <div><b>${esc(displayName(u))}</b><div class="muted tiny">${t("{email} · Google account · data syncs across devices", { email: esc(u.email || "") })}</div></div>`;
  renderKeyStatus();
  $$("#pref-theme button").forEach((b) => b.classList.toggle("active", b.dataset.theme === (document.documentElement.dataset.theme === "light" ? "light" : "dark")));
  $("#pref-ext").checked = state.showExt;
  $("#pref-levels").checked = state.showLevels;
  openModal("#settings-modal");
}
$("#signout-btn").addEventListener("click", async () => { closeModal("#settings-modal"); await sb.auth.signOut(); toast("Signed out", false); });
$("#pref-theme").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  applyTheme(b.dataset.theme);
  $$("#pref-theme button").forEach((x) => x.classList.toggle("active", x === b));
});
$("#pref-ext").addEventListener("change", (e) => setShowExt(e.target.checked));
$("#pref-levels").addEventListener("change", (e) => setShowLevels(e.target.checked));

function renderKeyStatus() {
  const k = state.byok;
  $("#key-status").innerHTML = k
    ? `<span class="ok">✓ Key saved</span><span class="mono">sk-or-…${esc(k.key_hint)}</span><span class="muted tiny">${t("updated {ago}", { ago: ago(k.updated_at) })}</span><span class="sp"></span><button class="link-btn" id="key-remove" type="button" style="padding:0;color:var(--down)">Remove</button>`
    : `<span class="none">No key saved</span><span class="muted tiny">AI analysis, trade ideas and position reviews are off until you add one.</span>`;
  $("#key-input").placeholder = k ? "Paste a new key to replace it" : "sk-or-v1-…";
  $("#key-remove")?.addEventListener("click", removeKey);
}
async function loadByok() {
  if (!state.user) { state.byok = null; return; }
  const { data } = await sb.from("user_api_keys").select("key_hint, updated_at").eq("provider", "openrouter").maybeSingle();
  state.byok = data || null;
}
$("#key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("#key-input").value.trim();
  if (!key) return;
  const btn = $("#key-save");
  btn.disabled = true;
  $("#key-save span").textContent = "Verifying…";
  try {
    // Check the key with OpenRouter before storing it.
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
    if (r.status === 401 || r.status === 403) throw new Error("OpenRouter rejected this key. Check it and try again.");
    if (!r.ok) throw new Error(`Couldn't verify the key with OpenRouter (HTTP ${r.status}).`);
    $("#key-save span").textContent = "Saving…";
    const { error } = await sb.rpc("set_api_key", { p_provider: "openrouter", p_key: key });
    if (error) throw error;
    $("#key-input").value = "";
    await fetch("/api/byok/refresh", { method: "POST", headers: await authHeaders() });
    await loadByok();
    renderKeyStatus();
    refreshAiAvailability();
    toast("OpenRouter key verified and saved", false);
  } catch (err) {
    toast(err.message || "Couldn't save the key.");
  } finally {
    btn.disabled = false;
    $("#key-save span").textContent = "Verify & save";
  }
});
async function removeKey() {
  if (!confirm(t("Remove your saved OpenRouter key? AI features will be off until you add one again."))) return;
  const { error } = await sb.rpc("delete_api_key", { p_provider: "openrouter" });
  if (error) return toast(error.message);
  await fetch("/api/byok/refresh", { method: "POST", headers: await authHeaders() });
  state.byok = null;
  renderKeyStatus();
  refreshAiAvailability();
  toast("Key removed", false);
}

/* ---------------- preferences sync */
function currentPrefs() {
  return {
    theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
    model: store.get("mp.model", null), risk: state.risk, deep: store.get("mp.deep", false),
    ext: state.showExt, levels: state.showLevels, calTab: state.calTab, calFilter: state.calFilter,
  };
}
let prefsTimer = null, applyingPrefs = false;
function schedulePrefsSync() {
  if (!state.user || applyingPrefs) return;
  clearTimeout(prefsTimer);
  $("#prefs-sync").textContent = "Saving…";
  prefsTimer = setTimeout(async () => {
    const { error } = await sb.from("user_settings").upsert({ user_id: state.user.id, prefs: currentPrefs(), updated_at: new Date().toISOString() });
    $("#prefs-sync").textContent = error ? "Couldn't sync" : "Synced to your account";
  }, 800);
}
function applyPrefs(p) {
  applyingPrefs = true;
  try {
    if (p.theme) applyTheme(p.theme);
    if (p.model) { store.set("mp.model", p.model); $$(".model-select").forEach((o) => { if ([...o.options].some((x) => x.value === p.model)) o.value = p.model; }); }
    if (typeof p.deep === "boolean") { store.set("mp.deep", p.deep); $$(".deep-toggle").forEach((o) => (o.checked = p.deep)); }
    if (typeof p.ext === "boolean" && p.ext !== state.showExt) setShowExt(p.ext);
    if (typeof p.levels === "boolean" && p.levels !== state.showLevels) setShowLevels(p.levels);
    if (p.calTab) { state.calTab = p.calTab; store.set("mp.calTab", p.calTab); }
    if (p.calFilter) { state.calFilter = p.calFilter; store.set("mp.calFilter", p.calFilter); }
    if (p.risk && RISKS[p.risk]) setRisk(p.risk);
    renderModelChips();
    renderCalendar();
  } finally {
    applyingPrefs = false;
  }
}

/* ---------------- data sync on sign-in / sign-out */
async function syncOnLogin() {
  const uid = state.user.id;
  // Watchlist: the account is the source of truth; seed it from this browser the first time.
  const { data: wl, error: wlErr } = await sb.from("watchlist_items").select("symbol, sort_order").order("sort_order");
  if (!wlErr) {
    if (!wl.length && state.watchlist.length) {
      await sb.from("watchlist_items").insert(state.watchlist.map((symbol, i) => ({ user_id: uid, symbol, sort_order: i })));
    } else {
      state.watchlist = wl.map((r) => r.symbol);
    }
  }
  // Positions: seed from this browser's saved positions the first time.
  const { count } = await sb.from("positions").select("id", { count: "exact", head: true });
  if (count === 0) {
    const rows = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("mp.pos.")) continue;
      for (const p of store.get(k, [])) rows.push(toPosRow(k.slice(7), p, uid));
    }
    if (rows.length) await sb.from("positions").insert(rows);
  }
  // Preferences.
  const { data: st } = await sb.from("user_settings").select("prefs").maybeSingle();
  if (st?.prefs && Object.keys(st.prefs).length) applyPrefs(st.prefs);
  else await sb.from("user_settings").upsert({ user_id: uid, prefs: currentPrefs() });
  await loadByok();
  renderWatchlist(); renderStar(); refreshWatchlist(true); loadCalendar();
  if (state.symbol) loadPositionsFor(state.symbol);
}
function onLogout() {
  state.byok = null;
  state.watchlist = store.get("mp.watchlist", ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN"]); // back to this browser's guest list
  renderWatchlist(); renderStar(); refreshWatchlist(true); loadCalendar();
  if (state.symbol) loadPositionsFor(state.symbol);
}

async function initAuth(cfg) {
  if (!cfg.supabase || !window.supabase) { renderAccount(); refreshAiAvailability(); return; }
  // PKCE returns ?code=… in the query string, leaving the #/SYMBOL router alone.
  sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.key, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let handled = null;
  const onSession = async (session) => {
    const prev = state.user?.id || null, next = session?.user || null;
    state.user = next;
    renderAccount();
    if (next && next.id !== handled) { handled = next.id; await syncOnLogin(); toast(t("Signed in as {name}", { name: displayName(next) }), false); }
    if (!next && prev) { handled = null; onLogout(); }
    refreshAiAvailability();
  };
  sb.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => onSession(session), 0); // don't await Supabase calls inside the auth callback
  });
  const { data } = await sb.auth.getSession(); // also completes the ?code= exchange after the Google redirect
  // Tidy the OAuth callback URL and return to the page the user signed in from.
  const qs = new URLSearchParams(location.search);
  if (qs.has("code") || qs.has("error")) {
    if (qs.get("error")) toast(`Google sign-in failed: ${qs.get("error_description") || qs.get("error")}`);
    let back = "";
    try { back = sessionStorage.getItem("mp.returnTo") || ""; sessionStorage.removeItem("mp.returnTo"); } catch {}
    history.replaceState(null, "", location.pathname + (back || location.hash));
    if (back && back !== location.hash) route();
  }
  await onSession(data.session);
}

/* ---------------- positions: account-backed when signed in */
function toPosRow(symbol, p, uid) {
  return { user_id: uid, symbol, kind: p.kind, side: p.side, qty: p.qty, cost: p.cost,
    option_type: p.kind === "option" ? p.type : null, strike: p.kind === "option" ? p.strike : null, expiration: p.kind === "option" ? p.expiration : null };
}
const fromPosRow = (r) => ({ id: r.id, kind: r.kind, side: r.side, qty: +r.qty, cost: +r.cost,
  ...(r.kind === "option" ? { type: r.option_type, strike: +r.strike, expiration: r.expiration } : {}) });

/* ================================================================ boot */
$("#today").textContent = new Date().toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
renderStatus();
renderWatchlist();
renderRecent();
loadConfig().then(() => initAuth(state.cfg)).catch(() => {});
setRisk(state.risk, { reload: false });
$$(".deep-toggle").forEach((el) => {
  el.checked = store.get("mp.deep", false);
  el.addEventListener("change", () => { store.set("mp.deep", el.checked); $$(".deep-toggle").forEach((o) => (o.checked = el.checked)); renderModelChips(); schedulePrefsSync(); });
});
$("#levels-btn").classList.toggle("on", state.showLevels);
$("#ext-btn").classList.toggle("on", state.showExt);
loadIndices();
loadCalendar();
loadMarketNews();
loadMovers();
refreshWatchlist(true);
route();

setInterval(renderStatus, 30000);
setInterval(() => { if (state.cal) { renderUpNext(); if (!state.symbol) renderCalendarNext(); } }, 30000);
setInterval(loadCalendar, 15 * 60000); // also feeds the sidebar "Up next" on every page
setInterval(() => { if (state.symbol && state.positions?.length && marketStatus().key === "open") evaluatePositions(); }, 30000);
setInterval(() => { if (!state.symbol) loadIndices(); }, 20000);
setInterval(() => refreshWatchlist(false), 10000);
setInterval(() => refreshWatchlist(true), 120000);
setInterval(() => { if (!state.symbol) { loadMarketNews(); loadMovers(); } }, 120000);
// Stock page background refreshes while there's trading to show.
const isTrading = () => { const k = marketStatus().key; return k === "open" || (k === "ext" && state.showExt); };
setInterval(() => {
  // Intraday charts pick up the bars' real volume / OHLC (live ticks only move the price).
  if (state.symbol && state.intraday && ["1D", "5D", "1M"].includes(state.range) && (marketStatus().key === "open" || (isTrading() && ["1D", "5D"].includes(state.range)))) loadHistory(false, true);
}, 60000);
setInterval(() => { if (state.symbol && isTrading()) { loadSignals(state.symbol, true); loadStockNews(state.symbol, true); } }, 5 * 60000);
// Coming back to a tab after a while (or waking the laptop): catch everything up at once.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return void (hiddenAt = Date.now());
  if (!hiddenAt || Date.now() - hiddenAt < 60000) return;
  refreshWatchlist(true);
  if (!state.symbol) return void (loadIndices(), loadMarketNews(), loadMovers());
  startStream(state.symbol);
  loadHistory(false, true);
  loadSignals(state.symbol, true);
  loadStockNews(state.symbol, true);
});
