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
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
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
  return `<span class="avatar${logoOk.has(sym) ? " logo-ok" : ""}${logoLight.has(sym) ? " logo-light" : ""}" style="background:linear-gradient(135deg,hsl(${h} 65% 52%),hsl(${(h + 40) % 360} 65% 42%));${size ? `width:${size}px;height:${size}px` : ""}"><span class="mono-lbl">${esc(label)}</span>${img}</span>`;
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
  symbol: null, range: "1D", style: "area", bars: [], intraday: true, prevClose: null, lastPrice: null, quote: null,
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
  if (day === "Sat" || day === "Sun") return { key: "closed", label: "Market closed" };
  if (mins >= 570 && mins < 960) return { key: "open", label: `Market open · closes in ${Math.floor((960 - mins) / 60)}h ${(960 - mins) % 60}m` };
  if (mins >= 240 && mins < 570) return { key: "ext", label: "Pre-market" };
  if (mins >= 960 && mins < 1200) return { key: "ext", label: "After hours" };
  return { key: "closed", label: "Market closed" };
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
  chart.applyOptions(chartTheme());
  if (state.bars.length) renderChart(false);
}
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
// Mouse wheel scrolls the page, not the chart; drag to pan, pinch to zoom.
const chart = LightweightCharts.createChart($("#chart"), {
  autoSize: true, ...chartTheme(),
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
  priceSeries = state.style === "candle"
    ? chart.addCandlestickSeries({ upColor: upC, downColor: downC, borderVisible: false, wickUpColor: upC, wickDownColor: downC })
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
  priceSeries.setData(bars.map((b) => {
    if (state.style === "candle") return b.ext ? { ...b, color: extC, wickColor: extC, borderColor: extC } : b;
    return b.ext ? { time: b.time, value: b.close, lineColor: extC, topColor: extC + "22", bottomColor: extC + "00" } : { time: b.time, value: b.close };
  }));
  if (state.range === "1D" && state.prevClose) {
    priceSeries.createPriceLine({ price: state.prevClose, color: css("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "Prev close" });
  }
  drawLevels();
  volSeries.setData(bars.map((b) => ({ time: b.time, value: b.volume || 0, color: b.ext ? extC + "44" : (b.close >= b.open ? upC : downC) + "55" })));
  chart.timeScale().applyOptions({ timeVisible: state.intraday, secondsVisible: false });
  if (fit) requestAnimationFrame(() => chart.timeScale().fitContent());
  renderRangeReturn();
  setLegend(null);
}

// Support/resistance + trade-plan price lines, toggled by the "Levels" button.
let levelLines = [];
function drawLevels() {
  if (!priceSeries) return;
  levelLines.forEach((l) => priceSeries.removePriceLine(l));
  levelLines = [];
  if (!state.showLevels) return;
  const add = (price, color, title, style = 1) => price != null && levelLines.push(priceSeries.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true }));
  const t = state.signals?.technicals;
  const plan = state.trade?.stock_trade;
  // Your own position: average cost of shares, plus the AI review's stop / target.
  const held = (state.posEval?.rows || []).filter((r) => r.kind === "stock");
  if (held.length) {
    const sh = held.reduce((a, r) => a + r.qty, 0);
    add(held.reduce((a, r) => a + r.qty * r.cost, 0) / sh, "#14b8a6", "Avg cost", 0);
  }
  const rv = state.posReview && state.posReview.hash === posHash(state.positions || []) ? state.posReview : null;
  if (rv) {
    add(rv.stop_loss, css("--down"), "My stop", 2);
    add(rv.take_profit, css("--up"), "My target", 2);
  }
  if (plan && ["long", "short"].includes(plan.direction)) {
    add(plan.entry_low, css("--accent"), "Entry", 0);
    if (plan.entry_high !== plan.entry_low) add(plan.entry_high, css("--accent"), "", 0);
    add(plan.stop, css("--down"), "Stop", 0);
    (plan.targets || []).forEach((x, i) => add(x, css("--up"), `T${i + 1}`, 0));
  } else if (t) {
    (t.resistance || []).slice(0, 2).forEach((x) => add(x, css("--down"), "R"));
    (t.support || []).slice(0, 2).forEach((x) => add(x, css("--up"), "S"));
  }
}
function setShowLevels(on) {
  state.showLevels = on;
  store.set("mp.levels", on);
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
  if (typeof t === "string") return new Date(t + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
function setLegend(bar) {
  const b = bar || state.bars[state.bars.length - 1];
  if (!b) return ($("#legend").innerHTML = "");
  const c = cls(b.close - b.open);
  $("#legend").innerHTML = `<span>${fmtTime(b.time)}</span><span><b>O</b>${fmt(b.open)}</span><span><b>H</b>${fmt(b.high)}</span><span><b>L</b>${fmt(b.low)}</span><span class="${c}"><b>C</b>${fmt(b.close)}</span><span><b>Vol</b>${big(b.volume)}</span>`;
}
const barIndex = new Map();
const timeKey = (t) => (typeof t === "object" ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : t);
chart.subscribeCrosshairMove((p) => setLegend(p.time && p.point ? barIndex.get(timeKey(p.time)) : null));

async function loadHistory(fit = true) {
  const { symbol, range } = state;
  $("#chart-loading").classList.add("on");
  try {
    const h = await api(`/api/history/${symbol}?range=${range}&ext=${state.showExt}`);
    if (symbol !== state.symbol || range !== state.range) return;
    state.bars = h.bars;
    state.intraday = h.intraday;
    barIndex.clear();
    h.bars.forEach((b) => barIndex.set(b.time, b));
    renderChart(fit);
  } catch (e) {
    if (symbol !== state.symbol) return;
    state.bars = [];
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
  if (state.range === "1D" || (extTick && state.range === "5D")) {
    if (t.bar_time > last.time && Math.floor(t.bar_time / 86400) === Math.floor(last.time / 86400)) {
      const nb = { time: t.bar_time, open: price, high: price, low: price, close: price, volume: 0, ...(extTick ? { ext: true } : {}) };
      bars.push(nb);
      barIndex.set(nb.time, nb);
    } else if (t.bar_time !== last.time) return;
  }
  const b = bars[bars.length - 1];
  b.close = price;
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  const extC = css("--muted");
  priceSeries.update(state.style === "candle"
    ? (b.ext ? { ...b, color: extC, wickColor: extC, borderColor: extC } : b)
    : (b.ext ? { time: b.time, value: b.close, lineColor: extC, topColor: extC + "22", bottomColor: extC + "00" } : { time: b.time, value: b.close }));
  renderRangeReturn();
}

/* ================================================================ stock view */
function setAvatar(sym) {
  const tpl = document.createElement("template");
  tpl.innerHTML = avatar(sym);
  const el = tpl.content.firstElementChild;
  el.id = "q-avatar";
  $("#q-avatar").replaceWith(el);
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
  const t = e.time ? new Date(e.time * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";
  el.hidden = false;
  el.innerHTML = `${e.kind === "pre" ? SUNRISE : MOON}<span class="lbl">${esc(e.label)}</span><span class="px">${fmt(e.price)}</span>
    <span class="ch ${cls(e.change)}">${e.change >= 0 ? "+" : ""}${fmt(e.change)} (${pct(e.change_percent)})</span>${t ? `<span class="muted tiny">${t} ET</span>` : ""}`;
  if (state.posEval && e && state.posEval.rows.some((r) => r.kind === "stock")) renderPositions();
}

function setShowExt(on) {
  state.showExt = on;
  store.set("mp.ext", on);
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
  if (state.range === "1D" && state.bars.length) renderRangeReturn();
  const s = marketStatus();
  $("#q-updated").textContent = s.key === "open"
    ? `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
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
    renderRanges();
    tag.className = "live-tag on";
    $("span", tag).textContent = marketStatus().key === "open" ? "Live" : "Streaming";
    requestAnimationFrame(() => tag.classList.add("tick"));
    setTimeout(() => tag.classList.remove("tick"), 900);
  };
  // The server recycles each stream every ~60s and EventSource reconnects on its own;
  // only show "Reconnecting" if no quote arrives for a while.
  let lastMsg = Date.now();
  src.addEventListener("message", () => (lastMsg = Date.now()));
  src.onerror = () => setTimeout(() => {
    if (state.source === src && Date.now() - lastMsg > 8000) { tag.className = "live-tag"; $("span", tag).textContent = "Reconnecting"; }
  }, 8000);
}

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

async function loadStockNews(symbol) {
  $("#stock-news-title").textContent = `${symbol} News`;
  $("#stock-news").innerHTML = skeleton(6);
  try {
    const items = await withRetry(() => api(`/api/news/${symbol}?limit=20`), { tries: 2 });
    if (symbol === state.symbol) $("#stock-news").innerHTML = newsHTML(items);
  } catch {
    if (symbol === state.symbol) $("#stock-news").innerHTML = `<div class="muted" style="padding:12px 0">No news found for ${esc(symbol)}.</div>`;
  }
}

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
  const pretty = new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return dateStr === today ? `Today · ${pretty}` : dateStr === tomorrow ? `Tomorrow · ${pretty}` : pretty;
}
const fmtEtTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
function countdown(ms) {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
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
  } catch {
    if (!state.cal) $("#cal-body").innerHTML = `<div class="cal-empty">Calendar unavailable right now. <button class="link-btn" onclick="loadCalendar()">Retry</button></div>`;
  }
}

function econRows() {
  const evs = state.cal?.economic || [];
  return state.calFilter === "critical" ? evs.filter((e) => e.tier === "critical") : evs;
}

function renderCalendarNext() {
  const now = Date.now();
  const next = (state.cal?.economic || []).find((e) => e.tier === "critical" && etDate(e.datetime) > now - 5 * 6e4);
  if (!next) return ($("#cal-next").innerHTML = "");
  // Several critical releases often share a slot (e.g. GDP + Core PCE at 8:30 AM).
  const same = state.cal.economic.filter((e) => e.tier === "critical" && e.datetime === next.datetime);
  const v = next.values?.[0] || {};
  const bits = same.length > 1 ? "" : [v.consensus && `Consensus ${v.consensus}`, v.previous && `Prev ${v.previous}`].filter(Boolean).join(" · ");
  $("#cal-next").innerHTML = `<div class="cal-next"><span class="pulse"></span>
    <div class="what"><b>Next critical: ${same.map((e) => esc(e.event)).join(" + ")}</b><span>${dayLabel(next.date)} · ${fmtEtTime(next.time)} ET${bits ? ` · ${esc(bits)}` : ""}</span></div>
    <div class="count">${countdown(etDate(next.datetime) - now)}<small>to release</small></div></div>`;
}

function renderCalendar() {
  const cal = state.cal;
  if (!cal) return;
  const econ = econRows(), earn = cal.earnings || [];
  $$("#cal-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === state.calTab);
    const n = b.dataset.tab === "economy" ? econ.length : earn.length;
    b.innerHTML = `${b.dataset.tab === "economy" ? "Economy" : "Earnings"}<span class="n">${n}</span>`;
  });
  $$("#cal-filter button").forEach((b) => b.classList.toggle("active", b.dataset.f === state.calFilter));
  $("#cal-filter").hidden = state.calTab !== "economy";
  renderCalendarNext();

  const byDay = (rows) => rows.reduce((m, r) => ((m[r.date] ||= []).push(r), m), {});
  const today = nyToday();
  let html = "";
  if (state.calTab === "economy") {
    const days = byDay(econ);
    for (const [date, rows] of Object.entries(days)) {
      html += `<div class="cal-day ${date === today ? "today" : ""}"><span>${dayLabel(date)}</span><span>${rows.length} event${rows.length > 1 ? "s" : ""}</span></div>`;
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
    if (!econ.length) html = `<div class="cal-empty">No ${state.calFilter === "critical" ? "critical" : "major"} US releases in the next 7 days.</div>`;
  } else {
    const timeLbl = (t) => (t === "pre-market" ? "☀ Before open" : t === "after-hours" ? "☾ After close" : "Time TBA");
    for (const [date, rows] of Object.entries(byDay(earn))) {
      html += `<div class="cal-day ${date === today ? "today" : ""}"><span>${dayLabel(date)}</span><span>${rows.length} report${rows.length > 1 ? "s" : ""}</span></div>`;
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
  renderCalendar();
});
$("#cal-filter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.calFilter = b.dataset.f;
  store.set("mp.calFilter", state.calFilter);
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

// Stock page: flag an upcoming earnings report.
async function loadNextEarnings(symbol) {
  const el = $("#q-earn");
  el.hidden = true;
  try {
    const e = await api(`/api/next-earnings/${symbol}`);
    if (symbol !== state.symbol || !e.date) return;
    const days = Math.round((new Date(e.date + "T12:00:00") - new Date(nyToday() + "T12:00:00")) / 864e5);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const t = e.time === "pre-market" ? "before the open" : e.time === "after-hours" ? "after the close" : "";
    el.innerHTML = `📅 Earnings ${when} · ${new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}${t ? ` ${t}` : ""}${e.eps_consensus != null ? ` · EPS est. ${fmt(e.eps_consensus)}` : ""}`;
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
        ${q.ext ? `<div class="ic-ext">${esc(q.ext.label)} ${fmt(q.ext.price)} <span class="${cls(q.ext.change_percent)}">${pct(q.ext.change_percent)}</span></div>` : ""}
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
  store.set("mp.watchlist", state.watchlist);
  renderStar();
  renderWatchlist();
  if (adding) refreshWatchlist(true);
  toast(adding ? `${sym} added to watchlist` : `${sym} removed from watchlist`, false);
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
  $("#wl-count").textContent = state.watchlist.length || "";
  if (!state.watchlist.length) {
    $("#watchlist").innerHTML = `<li class="wl-empty">Your watchlist is empty. Open a stock and tap <b>☆ Watch</b> to track it here.</li>`;
    return;
  }
  $("#watchlist").innerHTML = state.watchlist.map((s) => {
    const q = state.wlQuotes[s] || {};
    const prev = q.price != null && q.change != null ? q.price - q.change : null;
    return `<li class="wl-item ${s === state.symbol ? "active" : ""}" data-sym="${esc(s)}">
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
$("#watchlist").addEventListener("click", (e) => {
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

$("#menu-btn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("#scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));

/* ================================================================ search palette */
const palette = $("#palette"), input = $("#search-input"), list = $("#search-results");
let searchTimer, searchSel = 0, searchReq = 0, listFor = "";

function openPalette() {
  palette.hidden = false;
  input.value = "";
  renderOptions([], "");
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

function renderOptions(items, q) {
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
  list.innerHTML = html || `<li class="none">No matches for “${esc(q)}”.</li>`;
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
  if (!q) return renderOptions([], "");
  searchTimer = setTimeout(async () => {
    const req = ++searchReq;
    const items = await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []);
    if (req === searchReq && input.value.trim() === q) renderOptions(items, q);
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
  list.innerHTML = `<li class="none">Searching “${esc(q)}”…</li>`;
  const items = await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []);
  if (req !== searchReq || palette.hidden) return;
  const exact = items.find((i) => i.symbol === q.toUpperCase());
  const sym = exact?.symbol || items[0]?.symbol || (/^[A-Za-z.\-^]{1,6}$/.test(q) ? q.toUpperCase() : null);
  if (!sym) return renderOptions(items, q);
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
  state.aiEnabled = cfg.ai_enabled;
  const saved = store.get("mp.model", cfg.default_model);
  const models = cfg.models.some((m) => m.id === cfg.default_model) ? cfg.models : [{ id: cfg.default_model, label: cfg.default_model, price: "custom" }, ...cfg.models];
  const opts = models.map((m) => `<option value="${esc(m.id)}" ${m.id === saved ? "selected" : ""}>${esc(m.label)} · ${esc(m.price)}</option>`).join("");
  $$(".model-select").forEach((sel) => { sel.innerHTML = opts; sel.title = "USD per 1M tokens (input / output)"; });
}
$$(".model-select").forEach((sel) => sel.addEventListener("change", (e) => {
  store.set("mp.model", e.target.value);
  $$(".model-select").forEach((o) => (o.value = e.target.value));
}));

function aiEmpty(symbol) {
  const cached = store.get(`mp.ai.${symbol}`, null);
  if (cached) return showAnalysis(cached.text, cached, false);
  $("#analyze-btn span").textContent = "Analyze";
  $("#ai-body").innerHTML = `<div class="ai-empty">
      <div class="ai-feed"><b>Live quote</b>Price, volume, moving averages, 52-week range</div>
      <div class="ai-feed"><b>Fundamentals</b>Valuation multiples, growth, margins, leverage</div>
      <div class="ai-feed"><b>Performance</b>1W · 1M · 3M · 6M · 1Y returns</div>
      <div class="ai-feed"><b>Headlines</b>15 latest news stories on ${esc(symbol)}</div>
      ${state.aiEnabled
        ? `<div class="ai-note muted">Click <b>Analyze</b> for a structured research note on ${esc(symbol)} — typically under $0.001 per run.</div>`
        : `<div class="ai-note warn">Add <code>OPENROUTER_API_KEY</code> to <code>.env</code> and restart the server to enable AI analysis.</div>`}
    </div>`;
}

function stanceOf(text) {
  const tldr = (text.split(/###\s*News/i)[0] || text).toLowerCase();
  const m = tldr.match(/\b(bullish|bearish|neutral)\b/);
  return m ? m[1] : null;
}

function showAnalysis(text, meta, streaming) {
  const stance = stanceOf(text);
  const stanceHTML = stance ? `<span class="stance ${{ bullish: "bull", bearish: "bear", neutral: "neutral" }[stance]}">${{ bullish: "▲", bearish: "▼", neutral: "◆" }[stance]} ${stance[0].toUpperCase() + stance.slice(1)}</span>` : "";
  const bits = [meta?.model, meta?.completion_tokens ? `${meta.prompt_tokens + meta.completion_tokens} tokens` : null, meta?.cost != null ? `$${Number(meta.cost).toFixed(5)}` : null, meta?.at ? ago(meta.at) : null].filter(Boolean);
  $("#ai-body").innerHTML = `
    <div class="ai-meta">${stanceHTML}<span class="muted tiny">${esc(bits.join(" · "))}</span><span class="sp"></span>${!streaming ? `<button class="btn" id="copy-ai" style="height:30px;padding:0 10px;font-size:12px">Copy</button>` : ""}</div>
    ${streaming && !text ? `<div class="ai-thinking"><div class="spinner"></div>Gathering OpenBB data and analyzing…</div>` : ""}
    <div class="ai-output ${streaming ? "streaming" : ""}">${DOMPurify.sanitize(marked.parse(text || ""))}</div>`;
  $("#copy-ai")?.addEventListener("click", () => navigator.clipboard.writeText(text).then(() => toast("Analysis copied", false)));
  if (!streaming) $("#analyze-btn span").textContent = "Regenerate";
}

async function analyze() {
  if (!state.aiEnabled) return toast("Set OPENROUTER_API_KEY in .env and restart the server.");
  const symbol = state.symbol, btn = $("#analyze-btn"), model = $("#model-select").value;
  btn.disabled = true;
  $("#analyze-btn span").textContent = "Analyzing…";
  let text = "", meta = { model };
  showAnalysis("", meta, true);
  try {
    const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, model }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", pending = false;
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
        if (ev === "usage") meta = { ...meta, ...data };
        else if (data.text) text += data.text;
      }
      if (!pending) {
        pending = true;
        requestAnimationFrame(() => { pending = false; if (symbol === state.symbol) showAnalysis(text, meta, true); });
      }
    }
    meta.at = new Date().toISOString();
    store.set(`mp.ai.${symbol}`, { text, ...meta });
    showAnalysis(text, meta, false);
  } catch (e) {
    if (symbol !== state.symbol) return;
    text ? showAnalysis(text, meta, false) : aiEmpty(symbol);
    toast(`AI analysis failed: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}
$("#analyze-btn").addEventListener("click", analyze);

/* ================================================================ trade opportunities */
const money = (n, d = 0) => (n == null ? "∞" : `${n < 0 ? "-" : ""}$${fmt(Math.abs(n), d)}`);
const shortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

async function loadSignals(symbol) {
  state.signals = null;
  $("#signals").innerHTML = Array.from({ length: 8 }, () => `<div class="sig sk" style="height:86px"></div>`).join("");
  try {
    const sig = await api(`/api/signals/${symbol}`);
    if (symbol !== state.symbol) return;
    state.signals = sig;
    renderSignals();
    drawLevels();
  } catch (e) {
    if (symbol === state.symbol) $("#signals").innerHTML = `<div class="muted" style="grid-column:1/-1">Signals unavailable for ${esc(symbol)} (${esc(e.message)}).</div>`;
  }
}

function renderSignals() {
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
      <div class="d">By ${shortDate(exp.expiration)} · range ${fmt(lo)} – ${fmt(hi)}</div>
      <div class="em-bar" title="Options-implied 1σ range vs 52-week range"><span style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></span><b style="left:${pos(px)}%"></b></div>`;
  }
  const tiles = [
    `<div class="sig"><div class="k">Trend</div><div class="v ${trendCls}">${esc(t.trend)}</div><div class="lv-row">${smaChips}</div></div>`,
    `<div class="sig"><div class="k">RSI 14 <span class="${rsiLbl[1]}">${rsiLbl[0]}</span></div><div class="v">${fmt(t.rsi14, 1)}</div><div class="gauge"><i style="left:${Math.min(100, Math.max(0, t.rsi14))}%"></i></div></div>`,
    `<div class="sig"><div class="k">MACD <span class="${t.macd_cross === "bullish" ? "up" : "down"}">${t.macd_cross}</span></div><div class="v ${cls(t.macd_hist)}">${t.macd_hist >= 0 ? "+" : ""}${fmt(t.macd_hist, 3)}</div><div class="d">MACD ${fmt(t.macd, 2)} · signal ${fmt(t.macd_signal, 2)}</div></div>`,
    `<div class="sig"><div class="k">ATR 14</div><div class="v">${fmt(t.atr14)}</div><div class="d">${fmt(t.atr_pct)}% daily range · vol ${fmt(t.vol_ratio)}× avg</div></div>`,
    `<div class="sig wide"><div class="k">Key levels</div><div class="lv-row">${(t.resistance || []).slice().reverse().map((x) => `<span class="lv res">R ${fmt(x)}</span>`).join("")}<span class="lv px">● ${fmt(px)}</span>${(t.support || []).map((x) => `<span class="lv sup">S ${fmt(x)}</span>`).join("")}</div><div class="d" style="margin-top:6px">20-day ${fmt(t.low_20d)} – ${fmt(t.high_20d)} · 52-week ${fmt(t.low_52w)} – ${fmt(t.high_52w)}</div></div>`,
    `<div class="sig wide"><div class="k">Expected move (options)</div>${emHTML}</div>`,
    `<div class="sig"><div class="k">IV vs HV</div><div class="v">${o?.iv30 != null ? `${fmt(o.iv30, 1)}%` : "—"} <span class="muted tiny">/ ${fmt(t.hv20, 1)}%</span></div><div class="d">${o?.iv_hv_ratio ? `${fmt(o.iv_hv_ratio)}× · ${esc((o.vol_regime || "").split("(")[0])}` : "30d implied / 20d realized"}</div></div>`,
    `<div class="sig"><div class="k">Put / Call OI</div><div class="v">${exp ? fmt(exp.put_call_oi) : "—"}</div><div class="d">${exp ? `${exp.put_call_oi > 1 ? "Put-heavy (hedging)" : "Call-heavy"} · vol P/C ${fmt(exp.put_call_volume)}` : ""}</div></div>`,
    `<div class="sig wide"><div class="k">Largest open interest ${exp ? `· ${shortDate(exp.expiration)}` : ""}</div><div class="lv-row">${exp ? exp.top_call_oi.map((x) => `<span class="lv res">C ${fmt(x, x % 1 ? 1 : 0)}</span>`).join("") + exp.top_put_oi.map((x) => `<span class="lv sup">P ${fmt(x, x % 1 ? 1 : 0)}</span>`).join("") : "—"}</div><div class="d" style="margin-top:6px">Big OI strikes often act as magnets / walls near expiration.</div></div>`,
    `<div class="sig wide"><div class="k">Momentum</div><div class="lv-row">${[["1W", t.ret_1w], ["1M", t.ret_1m], ["3M", t.ret_3m]].map(([k, v]) => `<span class="lv ${v >= 0 ? "sup" : "res"}">${k} ${pct(v)}</span>`).join("")}</div><div class="d" style="margin-top:6px">Close vs 20D high: ${pct((px / t.high_20d - 1) * 100)}</div></div>`,
  ];
  $("#signals").innerHTML = tiles.join("");
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
  $$("#risk-tabs button").forEach((b) => { b.classList.toggle("active", b.dataset.risk === r); b.setAttribute("aria-checked", b.dataset.risk === r); });
  $("#risk-desc").textContent = RISKS[r].desc;
  if (!$("#trade-btn").disabled) $("#trade-btn span").textContent = `Generate ${RISKS[r].label} ideas`;
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
  $("#trade-btn span").textContent = `Generate ${RISKS[r].label} ideas`;
  if (!state.aiEnabled) {
    $("#trade-body").innerHTML = `<div class="ai-note warn" style="margin-top:8px">Add <code>OPENROUTER_API_KEY</code> to <code>.env</code> and restart the server to generate AI trade ideas. Signals above are computed locally and always available.</div>`;
    return;
  }
  const others = Object.keys(RISKS).filter((k) => k !== r && sym && getTrade(sym, k));
  $("#trade-body").innerHTML = `<div class="trade-empty">No <b>${RISKS[r].label.toLowerCase()}</b> ideas for <b>${esc(sym || "")}</b> yet — click <b>Generate ${RISKS[r].label} ideas</b> (~1 min, under $0.01).
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
  if (!state.aiEnabled) return toast("Set OPENROUTER_API_KEY in .env and restart the server.");
  const symbol = state.symbol, risk = state.risk, btn = $("#trade-btn");
  btn.disabled = true;
  $("#trade-btn span").textContent = "Generating…";
  let prog = {};
  let active = "data";
  const t0 = Date.now();
  renderProgress(prog, active, t0);
  const timer = setInterval(() => { if (active === "model") renderProgress(prog, active, t0); }, 1000);
  try {
    const r = await fetch("/api/trade-ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, model: $(".model-select").value, risk, deep: $("#trade-card .deep-toggle").checked }) });
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
    else toast(`${RISKS[risk].label} ideas for ${symbol} are ready`, false);
  } catch (e) {
    if (symbol !== state.symbol) return;
    btn.disabled = false;
    const t = getTrade(symbol, state.risk);
    t ? showTrade(t) : tradeEmpty();
    toast(`Trade ideas failed: ${e.message}`);
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    if (symbol === state.symbol && !$(".thesis")) $("#trade-btn span").textContent = `Generate ${RISKS[state.risk].label} ideas`;
  }
}
$("#trade-btn").addEventListener("click", generateTrades);

function confRing(v, color, label = "confidence") {
  const r = 32, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, v || 0));
  return `<div class="conf"><svg viewBox="0 0 76 76" width="76" height="76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--hover)" stroke-width="6"/>
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}"/></svg>
    <div class="n"><div>${p}<small>${label}</small></div></div></div>`;
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
  </svg><div class="tip">At expiry · spot ${fmt(spot)}</div></div>`;
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
        <div class="m"><div class="k">Net ${m.net_type || ""}</div><div class="v ${m.net_type === "credit" ? "up" : ""}">${money(Math.abs(m.net ?? 0))}</div></div>
        <div class="m"><div class="k">Max profit</div><div class="v up">${m.max_profit == null ? "Unlimited" : money(m.max_profit)}</div></div>
        <div class="m"><div class="k">Max loss</div><div class="v down">${m.max_loss == null ? "Unlimited" : money(m.max_loss)}</div></div>
        <div class="m"><div class="k">Breakeven</div><div class="v be">${(m.breakevens || []).map((b) => fmt(b)).join(" / ") || "—"}</div></div>
        <div class="m"><div class="k">Prob. profit</div><div class="v">${m.pop != null ? `${fmt(m.pop, 0)}%` : "—"}</div></div>
        <div class="m"><div class="k">Reward / risk</div><div class="v">${m.reward_risk != null ? `${fmt(m.reward_risk)}×` : m.max_profit == null ? "Open" : "—"}</div></div>
      </div>
      ${payoffSVG(m, spot, id)}
      <div class="legs-wrap"><table class="legs"><thead><tr><th></th><th>Qty</th><th>Contract</th><th>Mid</th><th>Δ</th><th>IV</th></tr></thead><tbody>
        ${o.legs.map((l) => `<tr><td class="act ${l.action}">${l.action.toUpperCase()}</td><td>${l.qty}</td><td>${legLabel(l)}</td><td>${l.type === "stock" ? "" : fmt(l.mid)}</td><td>${l.delta != null ? fmt(l.delta) : ""}</td><td>${l.iv != null ? `${fmt(l.iv, 0)}%` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <details><summary>Why this trade · management · risks</summary>
        ${o.rationale ? `<p><b>Why:</b> ${esc(o.rationale)}</p>` : ""}${o.management ? `<p><b>Manage:</b> ${esc(o.management)}</p>` : ""}${o.risks ? `<p><b>Risk:</b> ${esc(o.risks)}</p>` : ""}
        ${(o.notes || []).map((n) => `<p class="muted tiny">↺ ${esc(n)}</p>`).join("")}
      </details>
    </div>`;
}

function legLabel(l) {
  if (l.type === "stock") return `${l.qty * 100} sh ${esc(state.symbol)} @ ${fmt(l.price)}`;
  const d = new Date(l.expiration + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    const tg = (st.targets || []).map((x, i) => `<div class="lvl tgt"><div class="k">Target ${i + 1}</div><div class="v">${fmt(x)}</div><div class="d up">${pct(sm.targets_pct?.[i])} · ${sm.reward_risk?.[i] != null ? `${fmt(sm.reward_risk[i], 1)}R` : ""}</div></div>`).join("");
    plan = `<div class="plan">
      <div class="plan-head"><span class="dir ${st.direction}">${st.direction === "long" ? "▲ LONG" : "▼ SHORT"}</span><b>${esc(st.setup || "")}</b><span class="muted tiny">· ${esc(st.timeframe || "")}</span>${st.conditional || Math.abs(sm.entry_vs_spot_pct ?? 0) > 1 ? `<span class="chip static">Limit entry · wait for zone</span>` : ""}</div>
      <div class="plan-grid">
        <div class="lvl entry"><div class="k">Entry zone</div><div class="v">${fmt(st.entry_low)} – ${fmt(st.entry_high)}</div><div class="d muted">${pct(sm.entry_vs_spot_pct)} vs now</div></div>
        <div class="lvl stop"><div class="k">Stop</div><div class="v">${fmt(st.stop)}</div><div class="d down">${pct(sm.stop_pct)} · risk ${money(sm.risk_per_share, 2)}/sh</div></div>
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
      <div><div class="thesis-top"><span class="stance ${{ bullish: "bull", bearish: "bear" }[bias] || "neutral"}">${{ bullish: "▲", bearish: "▼" }[bias] || "◆"} ${bias[0].toUpperCase() + bias.slice(1)}</span>
        <span class="chip static">${esc(d.risk_profile || "")} risk</span><span class="muted tiny">${esc(meta)}</span></div>
        <p>${esc(d.summary || "")}</p></div>
    </div>
    <div class="sub-h">Stock setup</div>${plan}
    ${ideas.length ? `<div class="sub-h">Option strategies</div><div class="opt-grid">${optHTML}</div>` : ""}
    ${(d.catalysts?.length || d.risks?.length) ? `<div class="sub-h">Catalysts & risks</div><div class="bullets"><div><b class="tiny muted">CATALYSTS</b><ul>${list(d.catalysts)}</ul></div><div><b class="tiny muted">RISKS</b><ul>${list(d.risks)}</ul></div></div>` : ""}`;
  bindPayoffs($("#trade-body"), Object.fromEntries(ideas.map((o, i) => [`t${i}`, o.metrics])));
  $("#trade-btn span").textContent = `Regenerate ${RISKS[state.risk].label}`;
}

/* ================================================================ my position */
function modelProgress(p, t0) {
  const secs = Math.round((Date.now() - t0) / 1000);
  const bits = [`${secs}s`];
  if (p.thinking && !p.chars) bits.push(`thinking… ${(p.thinking / 1000).toFixed(1)}k chars`);
  if (p.chars) bits.push(`writing ${p.chars} chars`);
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
  $("#pos-form-hint").textContent = m != null ? `Current ${posForm.kind === "option" ? "mid" : "price"}: ${fmt(m)}${posForm.kind === "option" ? ` (${money(m * 100)} per contract)` : ""}` : "";
}
$("#pos-use-mark").addEventListener("click", () => { const m = currentMark(); if (m != null) $("#pos-cost").value = m; });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const qty = parseFloat($("#pos-qty").value), cost = parseFloat($("#pos-cost").value);
  if (!(qty > 0) || !(cost >= 0)) return toast("Enter a quantity and cost.");
  const p = { kind: posForm.kind, side: posForm.side, qty, cost };
  if (posForm.kind === "option") {
    if (!$("#pos-exp").value || !$("#pos-strike").value) return toast("Pick an expiration and strike.");
    Object.assign(p, { type: posForm.type, strike: parseFloat($("#pos-strike").value), expiration: $("#pos-exp").value });
  }
  state.positions.push(p);
  store.set(posKey(state.symbol), state.positions);
  $("#pos-qty").value = "";
  $("#pos-cost").value = "";
  openPosForm(false);
  toast("Position added", false);
  evaluatePositions();
});

function removePosition(i) {
  state.positions.splice(i, 1);
  store.set(posKey(state.symbol), state.positions);
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
    if (symbol === state.symbol) $("#pos-body").innerHTML = `<div class="err">Couldn't price positions — ${esc(e.message)}</div>`;
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
    $("#pos-body").innerHTML = `<div class="pos-empty"><b>No position in ${esc(state.symbol)}</b><div class="muted tiny">Add the shares or option contracts you hold to see live P/L, greeks and a combined payoff — then ask AI to review it.</div>
      <button class="btn" style="margin-top:12px" onclick="openPosForm(true)">+ Add position</button></div>`;
    return;
  }
  if (!ev) return;
  const t = ev.total;
  const review = state.posReview && state.posReview.hash === posHash(state.positions) ? state.posReview : null;
  const actions = Object.fromEntries((review?.positions || []).map((p) => [p.index, p]));
  const rows = ev.rows.map((r) => {
    const sub = r.unpriced ? `cost ${fmt(r.cost)} · <span class="warn-note" style="margin:0">price unavailable</span>`
      : r.kind === "option"
      ? `cost ${fmt(r.cost)} → mid ${fmt(r.mark)} · ${r.dte}d · ${r.moneyness}${r.iv ? ` · IV ${fmt(r.iv, 0)}%` : ""}`
      : `avg ${fmt(r.cost)} → ${fmt(r.mark)}`;
    const a = actions[r.index];
    return `<tr>
      <td><div class="desc"><span class="kind ${r.side === "buy" ? "long" : "short"}">${r.side === "buy" ? "LONG" : "SHORT"}</span><div><b>${esc(r.label.replace(/^(Long|Short) /, ""))}</b><div class="sub">${sub}</div></div></div></td>
      <td>${money(r.market_value)}</td>
      <td class="${cls(r.pnl)}">${r.pnl >= 0 ? "+" : ""}${money(r.pnl)}</td>
      <td class="${cls(r.pnl_pct)}">${pct(r.pnl_pct, 1)}</td>
      <td>${fmt(r.delta, 0)}</td>
      <td class="${r.theta ? cls(r.theta) : ""}">${r.theta ? money(r.theta, 2) : "—"}</td>
      <td><button class="rm-btn" title="Remove" data-rm-pos="${r.index}">×</button></td>
    </tr>${a ? `<tr class="act-row"><td colspan="7"><span class="act-chip ${ACTION_TONE[a.action] || "mid"}"><b>${esc(String(a.action).replace("_", " "))}</b>${esc(a.reason || "")}</span></td></tr>` : ""}`;
  }).join("");
  const p = ev.payoff;
  $("#pos-body").innerHTML = `
    <div class="pos-summary">
      <div class="m"><div class="k">Market value</div><div class="v">${money(t.market_value)}</div></div>
      <div class="m"><div class="k">Unrealized P/L</div><div class="v ${cls(t.pnl)}">${t.pnl >= 0 ? "+" : ""}${money(t.pnl)} <span class="tiny">${pct(t.pnl_pct, 1)}</span></div>${extPnl(ev)}</div>
      <div class="m" title="Share-equivalent exposure: P/L change per $1 move in the stock"><div class="k">Net delta</div><div class="v">${fmt(t.delta, 0)} <span class="tiny muted">sh</span></div></div>
      <div class="m" title="Estimated P/L from one day of time decay"><div class="k">Theta / day</div><div class="v ${t.theta ? cls(t.theta) : ""}">${money(t.theta, 2)}</div></div>
      <div class="m"><div class="k">Cost basis</div><div class="v">${money(t.cost_basis)}</div></div>
    </div>
    <div class="pos-table-wrap"><table class="pos-table">
      <thead><tr><th>Position</th><th>Value</th><th>P/L</th><th>%</th><th>Δ</th><th>Θ/day</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${p ? `<div class="pos-payoff"><div class="row"><b style="font-size:13px">Combined payoff at ${shortDate(p.horizon)}</b>
      <span class="muted tiny">Breakeven ${(p.breakevens || []).map((b) => fmt(b)).join(" / ") || "—"} · Max profit ${p.max_profit == null ? "unlimited" : money(p.max_profit)} · Max loss ${p.max_loss == null ? "unlimited" : money(p.max_loss)} · P(profit) ${fmt(p.pop, 0)}%</span></div>
      ${payoffSVG(p, ev.spot, "pos")}</div>` : ""}
    ${(ev.notes || []).map((n) => `<p class="muted tiny">↺ ${esc(n)}</p>`).join("")}`;
  if (p) bindPayoffs($("#pos-body"), { pos: p });
}
$("#pos-body").addEventListener("click", (e) => { const i = e.target.closest("[data-rm-pos]")?.dataset.rmPos; if (i != null) removePosition(+i); });

async function reviewPositions() {
  if (!state.aiEnabled) return toast("Set OPENROUTER_API_KEY in .env and restart the server.");
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
    const r = await fetch("/api/positions/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, positions: state.positions, question, model: $("#pos-review .model-select").value, deep: $("#pos-review .deep-toggle").checked }) });
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
    toast(`Review failed: ${e.message}`);
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
      <div><div class="thesis-top"><span class="verdict ${tone}">${esc(r.verdict || "")}</span><span class="muted tiny">${esc(meta)}</span></div>
      <p>${esc(r.summary || "")}</p></div>
    </div>
    ${r.answer && r.question ? `<div class="answer"><div class="q">“${esc(r.question)}”</div>${esc(r.answer)}</div>` : ""}
    <div class="sub-h">Exit plan</div>
    <div class="levels-grid">
      ${lvl("Stop loss", r.stop_loss, "stop", r.stop_loss && r.spot ? pct((r.stop_loss / r.spot - 1) * 100) + " from ref" : "")}
      ${lvl("Take profit", r.take_profit, "tgt", r.take_profit && r.spot ? pct((r.take_profit / r.spot - 1) * 100) + " from ref" : "")}
      <div class="lvl entry"><div class="k">Watch levels</div>${(r.watch_levels || []).map((w) => `<div class="d" style="margin-top:4px"><b class="mono">${fmt(w.price)}</b> <span class="muted">${esc(w.why || "")}</span></div>`).join("") || `<div class="v">—</div>`}</div>
    </div>
    ${r.risk_flags?.length ? `<div class="sub-h">Risk flags</div><ul class="flags">${r.risk_flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    ${adj.length ? `<div class="sub-h">Suggested adjustments</div><div class="opt-grid">${adj.map((a, i) => optCardHTML(a, `a${i}`, r.spot)).join("")}</div>` : ""}`;
  if (adj.length) bindPayoffs($("#pos-review-body"), Object.fromEntries(adj.map((a, i) => [`a${i}`, a.metrics])));
}

function loadPositionsFor(symbol) {
  state.positions = store.get(posKey(symbol), []);
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
  loadHistory();
});
$("#style-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.style = b.dataset.style;
  $$("#style-tabs button").forEach((x) => x.classList.toggle("active", x === b));
  renderChart();
});

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
    state.symbol = null;
    state.source?.close();
    $("#stock-view").hidden = true;
    $("#home-view").hidden = false;
    document.title = "Maru Pulse";
    renderWatchlist();
    return;
  }
  Object.assign(state, { symbol, lastPrice: null, prevClose: null, bars: [], quote: null, overview: null, baseStats: null, trade: null, signals: null });
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
  aiEmpty(symbol);
  state.signals = null;
  const saved = getTrade(symbol, state.risk);
  saved ? showTrade(saved) : tradeEmpty();
  loadSignals(symbol);
  loadPositionsFor(symbol);
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
    $("#q-name").innerHTML = `<span class="err">Couldn't load a quote for “${esc(symbol)}” — the data source may be busy, or the ticker may not exist.</span> <button class="link-btn" onclick="route()">Retry</button>`;
    $("#stats").innerHTML = "";
  }
}
window.addEventListener("hashchange", route);

/* ================================================================ boot */
$("#today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
renderStatus();
renderWatchlist();
renderRecent();
loadConfig().then(() => {
  if (state.symbol && !$("#analyze-btn").disabled) aiEmpty(state.symbol);
  if (state.symbol && !state.trade && !$("#trade-btn").disabled) tradeEmpty();
}).catch(() => {});
setRisk(state.risk, { reload: false });
$$(".deep-toggle").forEach((el) => {
  el.checked = store.get("mp.deep", false);
  el.addEventListener("change", () => { store.set("mp.deep", el.checked); $$(".deep-toggle").forEach((o) => (o.checked = el.checked)); });
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
setInterval(() => { if (!state.symbol && state.cal) renderCalendarNext(); }, 30000);
setInterval(() => { if (!state.symbol) loadCalendar(); }, 15 * 60000);
setInterval(() => { if (state.symbol && state.positions?.length && marketStatus().key === "open") evaluatePositions(); }, 30000);
setInterval(() => { if (!state.symbol) loadIndices(); }, 20000);
setInterval(() => refreshWatchlist(false), 10000);
setInterval(() => refreshWatchlist(true), 120000);
setInterval(() => { if (!state.symbol) { loadMarketNews(); loadMovers(); } }, 120000);
setInterval(() => { if (state.symbol && state.range === "1D" && marketStatus().key === "open") loadHistory(false); }, 60000);
