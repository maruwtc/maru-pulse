"""Market News webapp powered by the OpenBB Platform + OpenRouter AI analysis."""

import os

import certifi

# python.org macOS builds ship without a CA bundle; SEC search needs one.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import asyncio
import logging
import threading
import warnings
import json
import math
import re
import time
from datetime import date, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from yfinance.data import YfData
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openbb import obb
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import trading

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Supabase: auth + per-user data. The publishable key is public (RLS protects data); the secret
# key is server-only and is used solely to decrypt a signed-in user's BYOK OpenRouter key.
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4.1-flash")
NY = ZoneInfo("America/New_York")
PROVIDER = "yfinance"
STREAM_LIFETIME = 60  # seconds per SSE connection

# Cheap-but-capable OpenRouter models (USD per 1M tokens, input/output).
MODELS = [
    {"id": "deepseek/deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash", "price": "$0.02 / $0.60"},
    {"id": "z-ai/glm-5.3-flash", "label": "GLM 5.3 Flash", "price": "$0.02 / $0.30"},
    {"id": "openai/gpt-6-luna", "label": "GPT-6 Luna", "price": "$0.10 / $0.50"},
    # Free tier: no token cost, but OpenRouter rate-limits free models and their providers may log prompts.
    {"id": "qwen/qwen3.8-27b:free", "label": "Qwen 3.8-27b (free)", "price": "free"},
    {"id": "nvidia/nemotron-3-ultra-550b-a55b:free", "label": "Nemotron 3 Ultra (free)", "price": "free"},
    {"id": "google/gemma-4-26b-a4b-it:free", "label": "Gemma 4 26b A4B IT (free)", "price": "free"}
]

MARKET_NEWS_SYMBOLS = "SPY,QQQ,DIA,IWM"

# Chart ranges -> (yfinance interval, lookback days, intraday?)
RANGES = {
    "1D": ("1m", 5, True),
    "5D": ("5m", 7, True),
    "1M": ("30m", 31, True),
    "6M": ("1d", 183, False),
    "1Y": ("1d", 365, False),
    "5Y": ("1W", 5 * 365, False),
}

app = FastAPI(title="Maru Pulse")
log = logging.getLogger("maru_pulse")
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # don't log every outbound request
# OpenBB's yfinance quote fetcher prints a warning and drops the symbol when Yahoo intermittently
# answers 401; get_quotes() retries those symbols itself, so silence the noisy duplicate.
warnings.filterwarnings("ignore", message=r"Error getting data for .*")

_cache: dict[str, tuple[float, object]] = {}


def cached(key: str, ttl: float, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def clean(v):
    """Make pandas/numpy values JSON-safe."""
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "item"):
        return clean(v.item())
    return v


def records(df) -> list[dict]:
    return [{k: clean(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


def sse(event: str | None, data: dict) -> str:
    return (f"event: {event}\n" if event else "") + f"data: {json.dumps(data, default=str)}\n\n"


def obb_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs).to_df().reset_index()
    except Exception as e:  # OpenBB raises a mix of error types for empty/bad symbols
        raise HTTPException(status_code=502, detail=f"OpenBB error: {str(e).strip()[:300]}")


# ---------------------------------------------------------------- data helpers


def get_quotes(symbols: str) -> list[dict]:
    """Quotes for a comma-separated list, with change fields.

    yfinance omits last_price for ETFs and indices, so fall back to the close of
    the latest daily bar (which Yahoo updates intraday)."""
    wanted = [x.strip().upper() for x in symbols.split(",") if x.strip()]
    try:
        quotes = records(obb_call(obb.equity.price.quote, symbols, provider=PROVIDER)) if wanted else []
    except HTTPException:  # every symbol failed — handled by the retry below
        quotes = []
    dropped = [x for x in wanted if x not in {q["symbol"] for q in quotes}]
    if dropped:  # Yahoo sometimes rejects a few symbols in a burst (HTTP 401); retry them once
        time.sleep(0.8)
        try:
            quotes += records(obb_call(obb.equity.price.quote, ",".join(dropped), provider=PROVIDER))
        except HTTPException as e:
            if not quotes:
                raise e
        still = [x for x in wanted if x not in {q["symbol"] for q in quotes}]
        if still:
            log.info("no quote from Yahoo for %s after retry", ",".join(still))
    missing = [q["symbol"] for q in quotes if q.get("last_price") is None or q.get("prev_close") is None]
    if missing:
        start = (datetime.now(NY) - timedelta(days=10)).date()
        try:
            hist = obb_call(obb.equity.price.historical, ",".join(missing), start_date=start, provider=PROVIDER)
            if "symbol" not in hist:
                hist["symbol"] = missing[0]
            closes = {s: list(g["close"]) for s, g in hist.groupby("symbol")}
        except HTTPException:
            closes = {}
        for q in quotes:
            c = closes.get(q["symbol"], [])
            if q.get("last_price") is None and c:
                q["last_price"] = clean(c[-1])
            if q.get("prev_close") is None and len(c) > 1:
                q["prev_close"] = clean(c[-2])
    for q in quotes:
        last, prev = q.get("last_price"), q.get("prev_close")
        q["change"] = (last - prev) if last and prev else None
        q["change_percent"] = (last / prev - 1) * 100 if last and prev else None
    return quotes


def get_quote(symbol: str) -> dict:
    def load():
        quotes = get_quotes(symbol)
        if not quotes:
            raise HTTPException(404, f"No quote for {symbol}")
        return quotes[0]

    return cached(f"quote:{symbol}", 3, load)


def _parse_ext(q: dict) -> dict:
    state = q.get("marketState")
    out = {"market_state": state}
    for k in ("pre", "post"):
        price = q.get(f"{k}MarketPrice")
        if price:
            out[k] = {"price": clean(price), "change": clean(q.get(f"{k}MarketChange")),
                      "change_percent": clean(q.get(f"{k}MarketChangePercent")), "time": q.get(f"{k}MarketTime")}
    session = None
    if state == "PRE" and "pre" in out:
        session = "pre"
    elif state != "REGULAR" and "post" in out:
        session = "post"
    if session:
        out["session"] = {"kind": session, "label": "Pre-market" if session == "pre" else "After hours", **out[session]}
    return out


_ext_lock = threading.Lock()
EXT_TTL = 20


def get_ext_many(symbols: list[str]) -> dict[str, dict]:
    """Pre-market / after-hours quotes (not exposed by OpenBB's quote model).

    Uses Yahoo's batch quote endpoint through yfinance's authenticated session: one request for
    all symbols instead of one `Ticker.info` call each — bursts of per-symbol calls get HTTP 401s.
    `session` is the extended session worth showing now: pre-market while it trades, otherwise the
    latest after-hours print until the regular session opens."""
    now = time.time()
    out, need = {}, []
    for sym in symbols:
        hit = _cache.get(f"ext:{sym}")
        if hit and now - hit[0] < EXT_TTL:
            out[sym] = hit[1]
        else:
            need.append(sym)
    if need:
        with _ext_lock:
            # Another request may have fetched these while we waited for the lock.
            now = time.time()
            for sym in list(need):
                hit = _cache.get(f"ext:{sym}")
                if hit and now - hit[0] < EXT_TTL:
                    out[sym] = hit[1]
                    need.remove(sym)
            rows, ttl_start, err = {}, now, None
            for attempt in range(2):  # a 401 usually means a stale crumb; yfinance refreshes it on retry
                if not need:
                    break
                try:
                    data = YfData().get_raw_json("https://query1.finance.yahoo.com/v7/finance/quote",
                                                 params={"symbols": ",".join(need), "formatted": "false"}, timeout=10)
                    rows = {q["symbol"]: _parse_ext(q) for q in (data.get("quoteResponse") or {}).get("result") or []}
                    err = None
                    break
                except Exception as e:  # never let extended-hours data break a page
                    err = e
                    time.sleep(0.6)
            if err is not None:
                log.info("extended-hours quote failed for %s: %s", ",".join(need), str(err)[:80])
                ttl_start = now - EXT_TTL + 5  # try again in ~5s
            for sym in need:
                out[sym] = rows.get(sym, {})
                _cache[f"ext:{sym}"] = (ttl_start, out[sym])
    return out


def get_ext(symbol: str) -> dict:
    return get_ext_many([symbol])[symbol]


def get_history(symbol: str, rng: str, extended: bool = False) -> dict:
    interval, days, intraday = RANGES[rng]
    extended = extended and rng in ("1D", "5D")

    def load():
        start = (datetime.now(NY) - timedelta(days=days)).date()
        kwargs = {"extended_hours": True} if extended else {}
        df = obb_call(
            obb.equity.price.historical, symbol, start_date=start, interval=interval, provider=PROVIDER, **kwargs
        )
        if df.empty:
            raise HTTPException(404, f"No price history for {symbol}")
        if rng == "1D":  # keep only the latest session
            days_ = sorted({d.date() for d in df["date"]})
            keep = {days_[-1]}
            today = df[df["date"].apply(lambda d: d.date() == days_[-1])]
            # In pre-market the newest day has no regular bars yet; show the prior session for context.
            if extended and len(days_) > 1 and not any(570 <= d.hour * 60 + d.minute < 960 for d in today["date"]):
                keep.add(days_[-2])
            df = df[df["date"].apply(lambda d: d.date() in keep)]
        bars = []
        for row in df.itertuples():
            d = row.date
            if intraday:
                # Bars are naive exchange-local times; encode them as "UTC" so the
                # chart's axis reads in New York time.
                d = d.to_pydatetime() if hasattr(d, "to_pydatetime") else d
                if d.tzinfo is not None:
                    d = d.astimezone(NY)
                t = int((d.replace(tzinfo=None) - datetime(1970, 1, 1)).total_seconds())
                mins = d.hour * 60 + d.minute
                ext = mins < 570 or mins >= 960  # outside 9:30-16:00 ET
            else:
                t, ext = d.isoformat()[:10], False
            bar = {"time": t, "open": clean(row.open), "high": clean(row.high), "low": clean(row.low),
                   "close": clean(row.close), "volume": clean(row.volume)}
            if ext:
                bar["ext"] = True
            bars.append(bar)
        return {"symbol": symbol, "range": rng, "intraday": intraday, "interval": interval, "extended": extended, "bars": bars}

    return cached(f"hist:{symbol}:{rng}:{int(extended)}", 30 if intraday else 600, load)


def yahoo_search_news(symbols: list[str], limit: int) -> list[dict]:
    """Fallback news source: Yahoo's search API (headline, publisher, time; no summary).

    Used when the news endpoint behind OpenBB/yfinance fails (it returns HTTP 500 during outages)."""
    per = max(5, min(20, -(-limit // len(symbols))))
    out = []
    for sym in symbols:
        try:
            data = YfData().get_raw_json("https://query1.finance.yahoo.com/v1/finance/search",
                                         params={"q": sym, "newsCount": per, "quotesCount": 0}, timeout=10)
        except Exception:
            continue
        for n in data.get("news") or []:
            if not n.get("title") or not n.get("link"):
                continue
            ts = n.get("providerPublishTime")
            out.append({"date": datetime.fromtimestamp(ts, NY).isoformat() if ts else None, "title": n["title"],
                        "url": n["link"], "source": n.get("publisher"), "symbol": sym, "summary": None})
    return out


def get_news(symbols: str, limit: int) -> list[dict]:
    def load():
        df = None
        for attempt in range(2):  # Yahoo sometimes returns nothing under a burst of requests
            try:
                df = obb_call(obb.news.company, symbols, provider=PROVIDER, limit=limit)
                break
            except HTTPException:
                if attempt == 0:
                    time.sleep(1)
        if df is not None:
            df = df.sort_values("date", ascending=False).drop_duplicates("title")
            cols = [c for c in ("date", "title", "url", "source", "symbol", "summary") if c in df]
            return records(df[cols])
        items = yahoo_search_news([x for x in symbols.split(",") if x], limit)
        if not items:
            raise HTTPException(502, "News is temporarily unavailable from Yahoo — try again shortly.")
        log.info("news for %s served from Yahoo search fallback", symbols)
        seen, uniq = set(), []
        for it in sorted(items, key=lambda x: x["date"] or "", reverse=True):
            if it["title"] not in seen:
                seen.add(it["title"])
                uniq.append(it)
        return uniq[:limit]

    return cached(f"news:{symbols}:{limit}", 120, load)


# ---------------------------------------------------------------- API routes


@app.get("/api/config")
def config():
    return {"models": MODELS, "default_model": DEFAULT_MODEL,
            "supabase": {"url": SUPABASE_URL, "key": SUPABASE_PUBLISHABLE_KEY} if SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY else None,
            "byok_ready": bool(SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY)}


@app.get("/api/search")
def search(q: str = Query(min_length=1)):
    def load():
        df = obb_call(obb.equity.search, q, provider="sec")
        return records(df.head(12)[["symbol", "name"]])

    try:
        return cached(f"search:{q.lower()}", 3600, load)
    except HTTPException:
        return []


@app.get("/api/quote/{symbol}")
def quote(symbol: str):
    symbol = symbol.upper()
    return {**get_quote(symbol), "ext": get_ext(symbol)}


@app.get("/api/history/{symbol}")
def history(symbol: str, range: str = "1D", ext: bool = True):
    if range not in RANGES:
        raise HTTPException(400, f"range must be one of {list(RANGES)}")
    return get_history(symbol.upper(), range, extended=ext)


@app.get("/api/news/{symbol}")
def company_news(symbol: str, limit: int = 20):
    return get_news(symbol.upper(), limit)


@app.get("/api/market-news")
def market_news(limit: int = 30):
    return get_news(MARKET_NEWS_SYMBOLS, limit)


@app.get("/api/indices")
def indices():
    def load():
        order = ["SPY", "QQQ", "DIA", "IWM", "^VIX"]
        quotes = sorted(get_quotes(",".join(order)), key=lambda q: order.index(q["symbol"]))
        ext = get_ext_many([q["symbol"] for q in quotes])
        return [{"symbol": q["symbol"], "name": q.get("name"), "price": q["last_price"],
                 "change_percent": q["change_percent"], "ext": ext_brief(ext.get(q["symbol"]))} for q in quotes]

    return cached("indices", 15, load)


@app.get("/api/movers")
def movers():
    def load():
        out = {}
        for kind, fn in (("gainers", obb.equity.discovery.gainers), ("losers", obb.equity.discovery.losers),
                         ("active", obb.equity.discovery.active)):
            df = obb_call(fn, provider=PROVIDER).head(8)
            out[kind] = [{"symbol": r["symbol"], "name": r.get("name"), "price": r.get("price"),
                          "percent_change": (r.get("percent_change") or 0) * 100} for r in records(df)]
        return out

    return cached("movers", 120, load)


def ext_brief(e: dict | None) -> dict | None:
    s = (e or {}).get("session")
    return {k: s[k] for k in ("kind", "label", "price", "change", "change_percent")} if s else None


@app.get("/api/quotes")
def quotes(symbols: str = Query(min_length=1)):
    syms = ",".join(sorted({s.strip().upper() for s in symbols.split(",") if s.strip()})[:30])

    def load():
        qs = get_quotes(syms)
        ext = get_ext_many([q["symbol"] for q in qs])
        return [{"symbol": q["symbol"], "name": q.get("name"), "price": q["last_price"], "change": q["change"],
                 "change_percent": q["change_percent"], "ext": ext_brief(ext.get(q["symbol"]))} for q in qs]

    return cached(f"quotes:{syms}", 5, load)


@app.get("/api/sparklines")
def sparklines(symbols: str = Query(min_length=1)):
    """Latest-session 5-minute closes per symbol, for mini charts."""
    syms = sorted({s.strip().upper() for s in symbols.split(",") if s.strip()})[:30]

    def load():
        start = (datetime.now(NY) - timedelta(days=5)).date()
        df = obb_call(obb.equity.price.historical, ",".join(syms), start_date=start, interval="5m", provider=PROVIDER)
        if "symbol" not in df:
            df["symbol"] = syms[0]
        out = {}
        for sym, g in df.groupby("symbol"):
            last_day = g["date"].iloc[-1].date()
            g = g[g["date"].apply(lambda d: d.date() == last_day)]
            out[sym] = [round(float(c), 4) for c in g["close"] if c == c]
        return out

    return cached(f"spark:{','.join(syms)}", 60, load)


@app.get("/api/overview/{symbol}")
def overview(symbol: str):
    """Company profile + key fundamentals."""
    symbol = symbol.upper()

    def load():
        out = {"symbol": symbol}
        try:
            p = records(obb_call(obb.equity.profile, symbol, provider=PROVIDER))[0]
            out.update({k: p.get(k) for k in ("name", "long_description", "company_url", "sector", "industry_category",
                                              "employees", "hq_address_city", "hq_state", "hq_country",
                                              "market_cap", "shares_outstanding", "dividend_yield", "beta")})
        except HTTPException:
            pass
        try:
            m = records(obb_call(obb.equity.fundamental.metrics, symbol, provider=PROVIDER))[0]
            out.update({k: m.get(k) for k in ("pe_ratio", "forward_pe", "peg_ratio", "price_to_book",
                                              "enterprise_to_ebitda", "revenue_growth", "earnings_growth",
                                              "gross_margin", "operating_margin", "profit_margin",
                                              "return_on_equity", "debt_to_equity", "current_ratio",
                                              "price_return_1y", "market_cap", "beta")})
        except HTTPException:
            pass
        return out

    return cached(f"overview:{symbol}", 3600, load)


@app.get("/api/stream/{symbol}")
async def stream(request: Request, symbol: str, interval: float = 5):
    """Server-sent events: push a fresh quote every few seconds.

    Each connection ends after STREAM_LIFETIME seconds and the browser's EventSource
    reconnects transparently. Never-ending streams otherwise block uvicorn's graceful
    shutdown, which hangs `--reload`."""
    symbol = symbol.upper()
    interval = max(2.0, interval)

    async def gen():
        yield "retry: 1000\n\n"
        deadline = time.time() + STREAM_LIFETIME
        while time.time() < deadline and not await request.is_disconnected():
            try:
                q = await run_in_threadpool(get_quote, symbol)
                ext = await run_in_threadpool(get_ext, symbol)
                now = datetime.now(NY).replace(tzinfo=None, second=0, microsecond=0)
                payload = {"symbol": symbol, "price": q.get("last_price"), "change": q.get("change"),
                           "change_percent": q.get("change_percent"), "volume": q.get("volume"),
                           **{k: q.get(k) for k in ("open", "high", "low", "bid", "ask", "bid_size", "ask_size")},
                           "ext": ext.get("session"), "market_state": ext.get("market_state"),
                           "bar_time": int((now - datetime(1970, 1, 1)).total_seconds()),
                           "ts": time.time()}
                yield sse(None, payload)
            except Exception as e:
                yield sse("quote_error", {"error": str(e)[:200]})
            await asyncio.sleep(interval)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- AI analysis


class ChatTurn(BaseModel):
    role: str  # user | assistant
    content: str


class AnalyzeRequest(BaseModel):
    symbol: str
    model: str | None = None
    question: str | None = None
    history: list[ChatTurn] | None = None  # follow-ups: earlier turns, starting with the analysis itself
    first_question: str | None = None      # the question asked with the original analysis, if any
    lang: str | None = None  # UI language, e.g. "zh-Hant"


def build_context(symbol: str) -> str:
    q = get_quote(symbol)
    parts = [f"## Quote\n{json.dumps({k: q.get(k) for k in ('name', 'last_price', 'change_percent', 'open', 'high', 'low', 'prev_close', 'volume', 'volume_average', 'year_high', 'year_low', 'ma_50d', 'ma_200d', 'currency')}, default=str)}"]

    try:
        m = records(obb_call(obb.equity.fundamental.metrics, symbol, provider=PROVIDER))[0]
        keep = ("market_cap", "pe_ratio", "forward_pe", "peg_ratio", "price_to_book", "enterprise_to_ebitda",
                "revenue_growth", "earnings_growth", "gross_margin", "operating_margin", "profit_margin",
                "return_on_equity", "debt_to_equity", "current_ratio", "dividend_yield", "beta", "price_return_1y")
        parts.append(f"## Fundamentals\n{json.dumps({k: m.get(k) for k in keep}, default=str)}")
    except HTTPException:
        pass

    try:
        bars = get_history(symbol, "1Y")["bars"]
        closes = [b["close"] for b in bars if b["close"]]
        def ret(n):
            return f"{(closes[-1] / closes[-n - 1] - 1) * 100:.2f}%" if len(closes) > n else "n/a"
        parts.append(
            f"## Price performance (daily closes)\n1W {ret(5)}, 1M {ret(21)}, 3M {ret(63)}, 6M {ret(126)}, "
            f"1Y {ret(len(closes) - 1)}; 1Y range {min(closes):.2f}-{max(closes):.2f}"
        )
    except HTTPException:
        pass

    try:
        ext = get_ext(symbol)
        sess = {k: ext[k] for k in ("pre", "post") if k in ext}
        if sess:
            for v in sess.values():
                if isinstance(v.get("time"), (int, float)):
                    v["time"] = datetime.fromtimestamp(v["time"], NY).strftime("%Y-%m-%d %H:%M ET")
            parts.append(f"## Extended-hours trading (pre-market / after hours)\nmarket_state={ext.get('market_state')} "
                         f"{json.dumps(sess, default=str)}")
    except Exception:
        pass

    try:
        ev = get_events(symbol)
        lines = []
        if ev.get("earnings"):
            lines.append(f"Next earnings: {json.dumps(ev['earnings'], default=str)}")
        if ev.get("history"):
            lines.append("Recent quarters (EPS reported vs estimate, surprise %): " + json.dumps(ev["history"], default=str))
        if ev.get("dividends"):
            lines.append(f"Dividends: {json.dumps(ev['dividends'], default=str)}")
        if ev.get("filings"):
            lines.append("Recent SEC filings: " + "; ".join(f"{f['date']} {f['form']} {f['title']}" for f in ev["filings"]))
        if lines:
            parts.append("## Earnings & corporate events\n" + "\n".join(lines))
    except Exception:
        pass

    try:
        news = get_news(symbol, 15)
        lines = [f"- [{(n.get('date') or '')[:10]}] {n['title']} ({n.get('source')}): {(n.get('summary') or '')[:300]}"
                 for n in news]
        parts.append("## Recent news\n" + "\n".join(lines))
    except HTTPException:
        pass

    if cal := calendar_context(symbol):
        parts.append(cal)

    return "\n\n".join(parts)


SYSTEM_PROMPT = """You are a sharp, balanced equity research analyst. Using ONLY the data provided, write a concise
analysis in Markdown with these sections:
### TL;DR  (2-3 sentences, include an overall stance: Bullish / Neutral / Bearish and a confidence level)
### News & Sentiment  (key themes from the headlines, sentiment per theme, what matters most)
### Price Action & Technicals  (trend vs 50/200-day averages, momentum, position in 52-week range)
### Fundamentals & Valuation  (valuation multiples, growth, margins, balance sheet)
### Macro Backdrop  (recent US data like CPI / jobs vs consensus and upcoming critical releases, and what they mean for this stock)
### Bull Case / Bear Case  (bullets)
### Key Risks & Catalysts to Watch
Be specific with numbers. Say when data is missing. End with a one-line reminder that this is not investment advice."""


QUESTION_PROMPT = """The user has a specific question about this stock. Put it first:
### Your Question  (answer it directly and specifically, using the numbers in the data — e.g. for "great earnings but
the stock didn't rise": compare the beat to expectations and the size of past surprises, the run-up into the report, the
after-hours / pre-market move, valuation, guidance or news themes, and "sell the news" positioning. Say clearly which
factors the data supports and what you cannot verify (e.g. guidance or call commentary not in the data).)
Then continue with the remaining sections, kept shorter. Write the whole response in the same language as the user's
question (e.g. Traditional Chinese if they wrote in Traditional Chinese), keeping tickers and numbers as-is."""

FOLLOWUP_PROMPT = """You are a sharp, balanced equity research analyst in an ongoing conversation about one stock.
Earlier in the conversation you wrote a research note; the user now has a follow-up. Using ONLY the data provided
(refreshed just now) and the conversation so far, answer the user's latest message directly and specifically, with
numbers where they help. Use Markdown. Keep it focused — usually under 250 words — and do not repeat the full report
or its section template. Say clearly when the data can't answer something. Write in the same language as the user's
latest message unless told otherwise. Not investment advice."""

# The app's UI language (request field `lang`). English needs no note.
LANG_NAMES = {"zh-Hant": "Traditional Chinese (繁體中文, as used in Taiwan and Hong Kong)"}


def lang_note(lang: str | None, json_mode: bool = False, report: bool = True) -> str:
    """Prompt suffix asking for output in the user's app language; overrides other language instructions."""
    name = LANG_NAMES.get(lang or "")
    if not name:
        return ""
    if not report:  # free-form answers (follow-ups): no report headings to keep
        return (f"\n\nLanguage (the user's app language; overrides any other language instruction): write the whole "
                f"response in {name}. Keep tickers and numbers as-is.")
    if json_mode:
        return (f"\n\nLanguage (the user's app language; overrides any other language instruction): write every "
                f"human-readable string value (summary, setup, rationale, outlook, management, risks, notes, reasons, "
                f"answers, catalysts, etc.) in {name}. Keep JSON keys and enumerated values exactly as specified in "
                f"English (e.g. bullish/bearish/neutral, long/short/none, buy/sell, call/put, debit/credit, "
                f"conservative/moderate/aggressive, hold/add/trim/roll/hedge/close/cut_loss/take_profit), plus tickers "
                f"and numbers.")
    return (f"\n\nLanguage (the user's app language; overrides any other language instruction): write the whole "
            f"response in {name}. Keep the heading '### TL;DR' exactly as-is and translate the other section headings. "
            f"In the TL;DR, state the stance as 看多 (Bullish), 中性 (Neutral) or 看空 (Bearish). Keep tickers and numbers as-is.")


class OpenRouterError(Exception):
    pass


async def openrouter_stream(api_key: str, messages: list[dict], model: str, **extra):
    """Yield ("text", str) chunks then ("usage", dict) from an OpenRouter streaming completion."""
    body = {"model": model, "stream": True, "usage": {"include": True}, "messages": messages, **extra}
    headers = {"Authorization": f"Bearer {api_key}", "X-Title": "Maru Pulse",
               "HTTP-Referer": "https://localhost:8000"}
    async with httpx.AsyncClient(timeout=180) as client:
        async with client.stream("POST", "https://openrouter.ai/api/v1/chat/completions", json=body, headers=headers) as r:
            if r.status_code in (401, 403):
                raise OpenRouterError("OpenRouter rejected your API key — update it in Settings.")
            if r.status_code == 402:
                raise OpenRouterError("Your OpenRouter account is out of credits — top up at openrouter.ai/credits.")
            if r.status_code != 200:
                raise OpenRouterError(f"OpenRouter {r.status_code}: {(await r.aread()).decode()[:500]}")
            async for line in r.aiter_lines():
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                try:
                    chunk = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if chunk.get("error"):
                    raise OpenRouterError(chunk["error"].get("message") or "OpenRouter error")
                for choice in chunk.get("choices", []):
                    delta = choice.get("delta") or {}
                    if delta.get("reasoning"):
                        yield "reasoning", delta["reasoning"]
                    if delta.get("content"):
                        yield "text", delta["content"]
                if chunk.get("usage"):
                    u = chunk["usage"]
                    yield "usage", {"model": chunk.get("model", model), "prompt_tokens": u.get("prompt_tokens"),
                                    "completion_tokens": u.get("completion_tokens"), "cost": u.get("cost")}


def reasoning_opts(deep: bool) -> dict:
    """Reasoning models can think for minutes on these prompts; default to fast answers."""
    return {"reasoning": {"max_tokens": 6000} if deep else {"enabled": False}}


# ---------------------------------------------------------------- auth + BYOK

_user_cache: dict[str, tuple[float, dict]] = {}
_key_cache: dict[str, tuple[float, str | None]] = {}


async def current_user(request: Request) -> dict | None:
    """Resolve the Supabase user from `Authorization: Bearer <access token>` (verified by Supabase Auth)."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer ") or not SUPABASE_URL:
        return None
    token = auth[7:].strip()
    hit = _user_cache.get(token)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{SUPABASE_URL}/auth/v1/user",
                                 headers={"apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        raise HTTPException(503, "Couldn't reach the sign-in service. Try again.")
    if r.status_code != 200:
        return None
    user = r.json()
    _user_cache[token] = (time.time(), user)
    return user


async def user_openrouter_key(user_id: str) -> str | None:
    hit = _key_cache.get(user_id)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/get_api_key_for_user",
                              headers={"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}"},
                              json={"p_user_id": user_id, "p_provider": "openrouter"})
    if r.status_code != 200:
        log.info("BYOK lookup failed (%s): %s", r.status_code, r.text[:120])
        raise HTTPException(503, "Couldn't load your API key. Try again.")
    key = r.json() or None
    _key_cache[user_id] = (time.time(), key)
    return key


async def require_ai_key(request: Request) -> tuple[str, str]:
    """AI features use the signed-in user's own OpenRouter key (BYOK). Returns (key, user id)."""
    if not (SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY):
        raise HTTPException(503, "Server is missing Supabase settings (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY).")
    user = await current_user(request)
    if not user:
        raise HTTPException(401, "Sign in to use AI features.")
    key = await user_openrouter_key(user["id"])
    if not key:
        raise HTTPException(400, "Add your OpenRouter API key in Settings to use AI features.")
    return key, user["id"]


# ---------------------------------------------------------------- AI audit log
_audit_tasks: set[asyncio.Task] = set()


class AiAudit:
    """One row in the append-only `ai_generations` table, written when the generation ends — however it ends.

    Handlers fill in fields as they go; `finish()` is called from a `finally`, so errors and client
    disconnects (status "cancelled") are recorded too. Writing never blocks or fails the user's request."""

    def __init__(self, kind: str, symbol: str, user_id: str, model: str, lang: str | None, request: dict):
        self.started = time.time()
        self.row = {"kind": kind, "symbol": symbol, "user_id": user_id, "model": model, "lang": lang,
                    "request": request, "messages": None, "output": None, "result": None, "usage": None,
                    "status": "cancelled", "error": None}

    def finish(self):
        self.row["duration_ms"] = int((time.time() - self.started) * 1000)
        task = asyncio.get_running_loop().create_task(self._write(dict(self.row)))
        _audit_tasks.add(task)  # keep a reference until it's done
        task.add_done_callback(_audit_tasks.discard)

    @staticmethod
    async def _write(row: dict):
        if not (SUPABASE_URL and SUPABASE_SECRET_KEY):
            return
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(f"{SUPABASE_URL}/rest/v1/ai_generations",
                                      headers={"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
                                               "Content-Type": "application/json", "Prefer": "return=minimal"},
                                      content=json.dumps(row, default=str))
            if r.status_code >= 300:
                log.warning("AI audit write failed (%s): %s", r.status_code, r.text[:200])
        except httpx.HTTPError as e:
            log.warning("AI audit write failed: %s", e)


@app.post("/api/byok/refresh")
async def byok_refresh(request: Request):
    """Called by the browser after saving/removing a key so the server drops its cached copy."""
    user = await current_user(request)
    if not user:
        raise HTTPException(401, "Not signed in.")
    _key_cache.pop(user["id"], None)
    return {"ok": True}


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, request: Request):
    api_key, user_id = await require_ai_key(request)
    symbol = req.symbol.upper()
    model = req.model or DEFAULT_MODEL
    context = await run_in_threadpool(build_context, symbol)
    question = (req.question or "").strip()[:1000]
    # Follow-ups: the last few turns, alternating assistant / user, each capped so the prompt stays bounded.
    history = [{"role": h.role, "content": h.content[:12000]} for h in (req.history or [])
               if h.role in ("user", "assistant") and h.content.strip()][-12:]
    followup = bool(history and question)
    head = f"Analyze {symbol}. Today is {datetime.now(NY):%Y-%m-%d %H:%M} ET.\n\n{context}"
    if followup:
        first_q = (req.first_question or "").strip()[:1000]
        messages = [{"role": "system", "content": FOLLOWUP_PROMPT + lang_note(req.lang, report=False)},
                    {"role": "user", "content": head + (f"\n\n## User's question\n{first_q}" if first_q else "")},
                    *history,
                    {"role": "user", "content": question}]
    else:
        system = SYSTEM_PROMPT + ("\n\n" + QUESTION_PROMPT if question else "") + lang_note(req.lang)
        ask = f"\n\n## User's question\n{question}" if question else ""
        messages = [{"role": "system", "content": system}, {"role": "user", "content": head + ask}]
    audit = AiAudit("analysis", symbol, user_id, model, req.lang,
                    {"question": question or None, **({"followup": True, "turns": len(history)} if followup else {})})
    audit.row["messages"] = messages

    async def gen():
        text = ""
        try:
            async for kind, value in openrouter_stream(api_key, messages, model):
                if kind == "usage":
                    audit.row["usage"] = value
                    yield sse("usage", value)
                elif kind == "text":
                    text += value
                    yield sse(None, {"text": value})
            audit.row["status"] = "ok"
        except (OpenRouterError, httpx.HTTPError) as e:
            audit.row.update(status="error", error=str(e))
            yield sse("error", {"error": str(e)})
            return
        finally:
            audit.row["output"] = text
            audit.finish()
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- AI market brief (home page)
class BriefRequest(BaseModel):
    model: str | None = None
    lang: str | None = None
    watchlist: list[str] = []


BRIEF_PROMPT = """You are a sharp markets editor writing today's US market brief for an active trader. Using ONLY the data
provided, write a tight Markdown brief with these sections (skip a section if there's nothing meaningful for it):
### Headline  (1-2 sentences: the single most important story of the day and how the market is reacting)
### Indexes  (S&P 500, Nasdaq 100, Dow, Russell 2000 and VIX moves; risk-on / risk-off read; note pre-market / after-hours moves when in session)
### Movers  (the notable gainers, losers and most-active names, and why if the headlines explain it)
### Macro & Calendar  (today's releases with actual vs consensus and what they imply; the next critical release and when, in ET)
### Earnings  (today's / tomorrow's notable reports and timing)
### Your Watchlist  (only if watchlist data is provided: the biggest movers and anything in the news about them)
### What to Watch  (2-4 bullets for the rest of the session / next day)
Use bullet points and specific numbers. Don't invent data, prices or reasons that aren't in the data — say when something
is unknown. Keep it under ~350 words. End with a one-line reminder that this is not investment advice."""


def session_label(now: datetime) -> str:
    mins = now.hour * 60 + now.minute
    if now.weekday() >= 5:
        return "weekend — markets closed (data is from the last session)"
    if 570 <= mins < 960:
        return "regular session open"
    if 240 <= mins < 570:
        return "pre-market (regular session opens 9:30 ET)"
    if 960 <= mins < 1200:
        return "after-hours (regular session closed at 16:00 ET)"
    return "markets closed"


def build_brief_context(watchlist: list[str]) -> str:
    now = datetime.now(NY)
    today = now.date().isoformat()
    parts = [f"Now: {now:%A %Y-%m-%d %H:%M} ET — {session_label(now)}."]
    try:
        parts.append("## Indexes (ETF proxies + VIX)\n" + "\n".join(
            f"- {q['symbol']} ({q.get('name')}): {q['price']:.2f} ({q['change_percent']:+.2f}%)"
            + (f"; {q['ext']['label']} {q['ext']['price']} ({q['ext']['change_percent']:+.2f}%)" if q.get("ext") else "")
            for q in indices() if q.get("price") is not None))
    except Exception:
        pass
    try:
        mv = movers()
        parts.append("## Movers\n" + "\n".join(
            f"{kind.title()}: " + "; ".join(f"{m['symbol']} ({m.get('name')}) {m['percent_change']:+.1f}% @ {m.get('price')}"
                                           for m in mv.get(kind, [])[:6])
            for kind in ("gainers", "losers", "active")))
    except Exception:
        pass
    try:
        econ = economic_calendar(7)
        todays = [e for e in econ if e["date"] == today]
        upcoming = [e for e in econ if e["date"] > today and e["tier"] == "critical"][:5]
        fmt_e = lambda e: f"- {e['date']} {e['time']} ET [{e['tier']}] {e['event']}: " + "; ".join(
            ", ".join(f"{k} {v}" for k, v in vals.items() if v) for vals in e["values"]) if e["values"] else f"- {e['date']} {e['time']} ET [{e['tier']}] {e['event']}"
        parts.append("## Economic calendar — today\n" + ("\n".join(fmt_e(e) for e in todays) or "No major US releases today."))
        if upcoming:
            parts.append("## Next critical releases\n" + "\n".join(fmt_e(e) for e in upcoming))
    except Exception:
        pass
    try:
        watch = set(watchlist)
        tomorrow = (now.date() + timedelta(days=1)).isoformat()
        earn = [e for e in earnings_calendar(3) if e["date"] in (today, tomorrow)
                and ((e["market_cap"] or 0) >= EARNINGS_MAJOR_CAP or e["symbol"] in watch)][:15]
        if earn:
            parts.append("## Earnings (today / tomorrow)\n" + "\n".join(
                f"- {e['date']} {e['symbol']} ({e.get('name')}), {e.get('time') or 'time n/a'}, EPS est {e.get('eps_consensus')}"
                + (" [on user's watchlist]" if e["symbol"] in watch else "") for e in earn))
    except Exception:
        pass
    if watchlist:
        try:
            qs = get_quotes(",".join(watchlist[:30]))
            parts.append("## User's watchlist\n" + "\n".join(
                f"- {q['symbol']} ({q.get('name')}): {q.get('last_price')} ({(q.get('change_percent') or 0):+.2f}%)" for q in qs))
        except Exception:
            pass
    try:
        news = market_news(20)
        parts.append("## Market headlines\n" + "\n".join(
            f"- [{(n.get('date') or '')[:16]}] {n['title']} ({n.get('source')}): {(n.get('summary') or '')[:220]}" for n in news))
    except Exception:
        pass
    return "\n\n".join(parts)


@app.post("/api/market-brief")
async def market_brief(req: BriefRequest, request: Request):
    api_key, user_id = await require_ai_key(request)
    model = req.model or DEFAULT_MODEL
    watchlist = [s.strip().upper() for s in req.watchlist if re.fullmatch(r"[A-Za-z0-9.^=-]{1,12}", s.strip())][:30]
    context = await run_in_threadpool(build_brief_context, watchlist)
    messages = [{"role": "system", "content": BRIEF_PROMPT + lang_note(req.lang, report=False)},
                {"role": "user", "content": f"Write today's market brief.\n\n{context}"}]
    audit = AiAudit("market_brief", "MARKET", user_id, model, req.lang, {"watchlist": watchlist})
    audit.row["messages"] = messages

    async def gen():
        text = ""
        try:
            async for kind, value in openrouter_stream(api_key, messages, model):
                if kind == "usage":
                    audit.row["usage"] = value
                    yield sse("usage", value)
                elif kind == "text":
                    text += value
                    yield sse(None, {"text": value})
            audit.row["status"] = "ok"
        except (OpenRouterError, httpx.HTTPError) as e:
            audit.row.update(status="error", error=str(e))
            yield sse("error", {"error": str(e)})
            return
        finally:
            audit.row["output"] = text
            audit.finish()
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- signals & trade ideas


def get_chain_raw(symbol: str):
    """Every listed contract as returned by Yahoo (including ones with no live quote)."""
    def load():
        try:
            return obb_call(obb.derivatives.options.chains, symbol, provider=PROVIDER)
        except HTTPException:  # Yahoo's options endpoint fails intermittently; one retry fixes most
            time.sleep(1)
            return obb_call(obb.derivatives.options.chains, symbol, provider=PROVIDER)

    return cached(f"chainraw:{symbol}", 300, load)


def get_chain(symbol: str, spot: float):
    return cached(f"chain:{symbol}", 300, lambda: trading.clean_chain(get_chain_raw(symbol), spot))


def get_signals(symbol: str) -> dict:
    def load():
        q = get_quote(symbol)
        spot = q["last_price"]
        tech = trading.technicals(get_history(symbol, "1Y")["bars"], spot)
        try:
            chain = get_chain(symbol, spot)
            opts = trading.options_summary(chain, spot, tech["hv20"]) if not chain.empty else None
        except HTTPException:
            opts = None
        return {"symbol": symbol, "technicals": tech, "options": opts}

    key = f"signals:{symbol}"
    hit = _cache.get(key)
    # Options lookups fail intermittently on Yahoo; keep those results only briefly so they retry.
    if hit and time.time() - hit[0] < (120 if hit[1]["options"] else 15):
        return hit[1]
    value = load()
    _cache[key] = (time.time(), value)
    return value


@app.get("/api/signals/{symbol}")
def signals(symbol: str):
    return get_signals(symbol.upper())


class TradeRequest(BaseModel):
    symbol: str
    model: str | None = None
    deep: bool = False
    risk: str = "moderate"  # conservative | moderate | aggressive
    lang: str | None = None  # UI language, e.g. "zh-Hant"


TRADE_PROMPT = """You are a disciplined professional trader and options strategist. Using ONLY the data provided,
propose trade setups for the stock. Respect the user's risk profile:
- conservative: defined-risk only, prefer spreads / covered calls / cash-secured puts, higher probability, smaller size.
- moderate: defined-risk spreads or long options with sensible deltas (0.30-0.60), balanced reward/risk.
- aggressive: may use long options with lower deltas, shorter expirations and directional conviction (still no naked short calls).

Rules:
- Base levels on the technicals (support/resistance, ATR, moving averages) and the options-implied expected move.
- Use the volatility regime: when IV >> HV prefer selling premium / credit or debit spreads; when IV << HV prefer buying options.
- Option legs MUST use expirations and strikes that appear in the CONTRACTS table. Never invent contracts.
- If the setup is unclear, say so: set stock_trade.direction to "none", set entry/stop/targets to null, and offer a neutral strategy (e.g. iron condor).
- If you give entry/stop/targets, direction MUST be "long" or "short" (use a limit entry zone for "wait for pullback" setups).
- Give 2-3 option ideas that express different trade-offs (e.g. directional debit spread, income/credit, higher-conviction long option).
- Be concise and specific; numbers over adjectives.

Return ONLY a JSON object with exactly this shape:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "summary": "2-3 sentence thesis",
  "stock_trade": {
    "direction": "long" | "short" | "none",
    "entry_low": number, "entry_high": number,
    "stop": number,
    "targets": [number, number],
    "timeframe": "e.g. 2-6 weeks",
    "setup": "short name, e.g. Pullback to 50-day MA",
    "rationale": "why",
    "invalidation": "what would prove this wrong"
  },
  "option_ideas": [
    {
      "name": "e.g. Bull Call Spread",
      "outlook": "e.g. Moderately bullish into Oct earnings",
      "legs": [{"action": "buy" | "sell", "type": "call" | "put" | "stock", "strike": number, "expiration": "YYYY-MM-DD", "qty": 1}],
      "rationale": "why this structure fits the IV regime and levels",
      "management": "profit-taking / stop / roll plan",
      "risks": "main risk"
    }
  ],
  "catalysts": ["..."],
  "risks": ["..."]
}"""


def build_trade_context(symbol: str) -> tuple[str, dict]:
    q = get_quote(symbol)
    spot = q["last_price"]
    sig = get_signals(symbol)
    tech, opts = sig["technicals"], sig["options"]
    parts = [
        f"## Quote\nprice {spot}, change {q.get('change_percent') and round(q['change_percent'], 2)}%, "
        f"day range {q.get('low')}-{q.get('high')}, volume {q.get('volume')} vs avg {q.get('volume_average')}",
        f"## Technicals\n{json.dumps(tech)}",
    ]
    chain = None
    if opts:
        parts.append(f"## Options summary\n{json.dumps(opts)}")
        chain = get_chain(symbol, spot)
        exps = [date.fromisoformat(e["expiration"]) for e in opts["expirations"]]
        cands = trading.candidate_contracts(chain, spot, exps)
        parts.append(f"## CONTRACTS (liquid, near the money; the only contracts you may use)\n{trading.contracts_table(cands)}")
    else:
        parts.append("## Options\nNo listed options data available — option_ideas must be an empty list.")
    try:
        news = get_news(symbol, 10)
        parts.append("## Headlines\n" + "\n".join(f"- [{(n.get('date') or '')[:10]}] {n['title']}" for n in news))
    except HTTPException:
        pass
    if cal := calendar_context(symbol):
        parts.append(cal + "\n(Account for these: e.g. earnings inflate IV and gap risk; avoid holding short premium through them unless intended.)")
    return "\n\n".join(parts), {"spot": spot, "chain": chain, "signals": sig}


def parse_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("Model did not return JSON")
    raw = text[start:end + 1]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(re.sub(r",\s*([}\]])", r"\1", raw))  # tolerate trailing commas


def enrich_ideas(ideas: dict, ctx: dict) -> dict:
    spot, chain, sig = ctx["spot"], ctx["chain"], ctx["signals"]
    st = ideas.get("stock_trade") or {}
    ideas["stock_trade"] = st
    st["direction"] = str(st.get("direction") or "none").lower()
    if st["direction"] not in ("long", "short"):
        # Models sometimes say "none" yet supply a coherent plan; infer it and mark as conditional.
        try:
            entry = (float(st["entry_low"]) + float(st["entry_high"])) / 2
            stop, tg = float(st["stop"]), [float(x) for x in st.get("targets") or []]
            if tg and stop < entry < min(tg):
                st["direction"], st["conditional"] = "long", True
            elif tg and stop > entry > max(tg):
                st["direction"], st["conditional"] = "short", True
            else:
                st["direction"] = "none"
        except (KeyError, TypeError, ValueError):
            st["direction"] = "none"
    if st["direction"] in ("long", "short"):
        st["metrics"] = trading.stock_metrics(st, spot)
    iv30 = (sig.get("options") or {}).get("iv30")
    enriched = []
    for idea in ideas.get("option_ideas") or []:
        if chain is None:
            break
        legs, notes = trading.resolve_legs(idea.get("legs") or [], chain, spot)
        if not legs:
            continue
        idea["legs"] = legs
        idea["notes"] = notes
        idea["metrics"] = trading.strategy_metrics(legs, spot, iv30)
        enriched.append(idea)
    ideas["option_ideas"] = enriched
    ideas["spot"] = spot
    ideas["generated_at"] = datetime.now(NY).isoformat()
    return ideas


@app.post("/api/trade-ideas")
async def trade_ideas(req: TradeRequest, request: Request):
    api_key, user_id = await require_ai_key(request)
    symbol = req.symbol.upper()
    model = req.model or DEFAULT_MODEL
    risk = req.risk if req.risk in ("conservative", "moderate", "aggressive") else "moderate"
    audit = AiAudit("trade_ideas", symbol, user_id, model, req.lang, {"risk": risk, "deep": req.deep})

    async def gen():
        try:
            async for event in run():
                yield event
        finally:
            audit.finish()

    async def run():
        yield sse("status", {"step": "data", "message": "Pulling quote, technicals and option chain from OpenBB…"})
        try:
            context, ctx = await run_in_threadpool(build_trade_context, symbol)
        except HTTPException as e:
            audit.row.update(status="error", error=str(e.detail))
            yield sse("error", {"error": e.detail})
            return
        yield sse("status", {"step": "model", "message": f"Asking {model} for trade setups…"})
        messages = [
            {"role": "system", "content": TRADE_PROMPT + lang_note(req.lang, json_mode=True)},
            {"role": "user", "content": f"Symbol: {symbol}. Today: {datetime.now(NY):%Y-%m-%d}. Risk profile: {risk}.\n\n{context}"},
        ]
        audit.row["messages"] = messages
        ideas, usage, last_err = None, None, None
        for attempt in range(2):  # retry once if the model returns malformed / incomplete JSON
            text = ""
            try:
                thinking = 0
                async for kind, value in openrouter_stream(api_key, messages, model, **reasoning_opts(req.deep)):
                    if kind == "usage":
                        usage = value
                    elif kind == "reasoning":
                        thinking += len(value)
                        yield sse("progress", {"thinking": thinking, "chars": len(text)})
                    else:
                        text += value
                        yield sse("progress", {"thinking": thinking, "chars": len(text), "attempt": attempt + 1})
            except (OpenRouterError, httpx.HTTPError) as e:
                audit.row.update(status="error", error=str(e), output=text or None, usage=usage)
                yield sse("error", {"error": str(e)})
                return
            audit.row.update(output=text, usage=usage)
            try:
                parsed = parse_json(text)
                if "stock_trade" not in parsed or "bias" not in parsed:
                    raise ValueError("missing required fields")
                ideas = parsed
                break
            except (ValueError, json.JSONDecodeError) as e:
                last_err = e
                yield sse("status", {"step": "model", "message": "Model output was malformed — retrying…"})
        if ideas is None:
            audit.row.update(status="error", error=f"Could not parse model output ({last_err})")
            yield sse("error", {"error": f"Could not parse model output ({last_err}). Try again or pick another model."})
            return
        yield sse("status", {"step": "validate", "message": "Validating contracts and computing payoffs…"})
        ideas = await run_in_threadpool(enrich_ideas, ideas, ctx)
        ideas["risk_profile"] = risk
        ideas["usage"] = usage
        audit.row.update(status="ok", result=ideas)
        yield sse("result", ideas)
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- my positions


class Position(BaseModel):
    kind: str  # stock | option
    side: str = "long"  # long | short
    qty: float
    cost: float
    type: str | None = None  # call | put
    strike: float | None = None
    expiration: str | None = None


class PositionsRequest(BaseModel):
    symbol: str
    positions: list[Position]
    model: str | None = None
    question: str | None = None
    deep: bool = False
    lang: str | None = None  # UI language, e.g. "zh-Hant"


@app.get("/api/chain-meta/{symbol}")
def chain_meta(symbol: str):
    """Expirations, strikes and mids so the UI can offer real contracts."""
    symbol = symbol.upper()
    spot = get_quote(symbol)["last_price"]
    try:
        raw = get_chain_raw(symbol)
        priced = get_chain(symbol, spot)
    except HTTPException:
        return {"spot": spot, "expirations": []}
    prices = {(r.expiration, r.option_type, float(r.strike)): (round(float(r.mid), 2), bool(r.quoted))
              for r in priced.itertuples()}
    raw = raw.assign(expiration=pd.to_datetime(raw["expiration"]).dt.date)
    out = []
    for exp, g in raw.groupby("expiration"):
        # All listed strikes, so any contract a user holds can be entered — not just liquid ones.
        strikes = sorted({f"{k:g}" for k in g["strike"]}, key=float)
        mids: dict[str, dict] = {}
        live: dict[str, dict] = {}
        for r in g.itertuples():
            p = prices.get((exp, r.option_type, float(r.strike)))
            if p:
                mids.setdefault(f"{r.strike:g}", {})[r.option_type] = p[0]
                live.setdefault(f"{r.strike:g}", {})[r.option_type] = p[1]
        out.append({"expiration": exp.isoformat(), "dte": int(g["dte"].iloc[0]),
                    "strikes": strikes, "mids": mids, "live": live})
    return {"spot": spot, "expirations": out}


@app.get("/api/options/{symbol}")
def options_info(symbol: str, expiration: str | None = None, strikes: int = 25):
    """Chain overview for one expiration: totals, max pain, and calls/puts side by side near the money."""
    symbol = symbol.upper()
    spot = get_quote(symbol)["last_price"]
    chain = get_chain(symbol, spot)  # Yahoo failures surface as errors so the UI can retry
    if chain.empty:
        return {"spot": spot, "expirations": [], "rows": []}
    exps = sorted(chain["expiration"].unique())
    exp_list = [{"expiration": e.isoformat(), "dte": (e - date.today()).days} for e in exps]
    if expiration:
        exp = next((e for e in exps if e.isoformat() == expiration), None)
        if exp is None:
            raise HTTPException(404, f"No {symbol} options expiring {expiration}")
    else:  # default to the first expiration about a month out, like the signals tiles
        exp = next((e for e in exps if (e - date.today()).days >= 20), exps[-1])
    sub = chain[chain["expiration"] == exp]
    calls, puts = sub[sub["option_type"] == "call"], sub[sub["option_type"] == "put"]

    oi = lambda df: int(df["open_interest"].fillna(0).sum())
    vol = lambda df: int(df["volume"].fillna(0).sum())
    # Max pain: the settlement price that minimizes total intrinsic value paid out to holders.
    ks = sorted(sub["strike"].unique())
    c_oi, p_oi = calls["open_interest"].fillna(0), puts["open_interest"].fillna(0)
    pain = {k: float(((k - calls["strike"]).clip(lower=0) * c_oi).sum() + ((puts["strike"] - k).clip(lower=0) * p_oi).sum())
            for k in ks}
    max_pain = min(pain, key=pain.get) if pain and (c_oi.sum() + p_oi.sum()) > 0 else None
    c, p = trading.atm_row(chain, exp, spot, "call"), trading.atm_row(chain, exp, spot, "put")
    straddle = c["mid"] + p["mid"] if c is not None and p is not None else None
    atm_ivs = [v for v in ((c["iv"] if c is not None else None), (p["iv"] if p is not None else None)) if v == v and v is not None]

    def leg(r):
        if r is None:
            return None
        return {"bid": trading.r2(r.bid), "ask": trading.r2(r.ask), "mid": trading.r2(r.mid), "last": trading.r2(r.last_trade_price),
                "quoted": bool(r.quoted), "iv": trading.r2(r.iv * 100, 1) if r.iv == r.iv else None,
                "delta": trading.r2(r.delta) if r.delta is not None else None,
                "oi": int(r.open_interest) if r.open_interest == r.open_interest else 0,
                "volume": int(r.volume) if r.volume == r.volume else 0}

    by_c = {float(r.strike): r for r in calls.itertuples()}
    by_p = {float(r.strike): r for r in puts.itertuples()}
    atm_i = min(range(len(ks)), key=lambda i: abs(ks[i] - spot))
    n = len(ks) if strikes <= 0 else max(2, strikes)  # strikes <= 0 → every listed strike
    near = ks[max(0, atm_i - n):atm_i + n + 1]
    rows = [{"strike": trading.r2(k), "call": leg(by_c.get(float(k))), "put": leg(by_p.get(float(k)))} for k in near]
    return {
        "spot": trading.r2(spot),
        "expirations": exp_list,
        "expiration": exp.isoformat(),
        "dte": (exp - date.today()).days,
        "summary": {
            "atm_iv": trading.r2(sum(atm_ivs) / len(atm_ivs) * 100, 1) if atm_ivs else None,
            "expected_move": trading.r2(straddle),
            "expected_move_pct": trading.r2(straddle / spot * 100) if straddle else None,
            "max_pain": trading.r2(max_pain),
            "call_oi": oi(calls), "put_oi": oi(puts), "call_volume": vol(calls), "put_volume": vol(puts),
            "put_call_oi": trading.r2(oi(puts) / oi(calls)) if oi(calls) else None,
            "put_call_volume": trading.r2(vol(puts) / vol(calls)) if vol(calls) else None,
            "quoted": bool(sub["quoted"].any()),
        },
        "rows": rows,
        "flow": options_flow(chain, spot),
    }


def options_flow(chain: pd.DataFrame, spot: float, n: int = 4) -> dict:
    """Largest call / put contracts across every expiration, ranked by premium traded (volume × price × 100).

    Strikes are limited to ±30% of spot: deep in-the-money contracts carry huge premiums from stock-replacement
    trades and spread legs (often stale last-trade prices) and would crowd out the directional bets."""
    df = chain.assign(volume=chain["volume"].fillna(0), open_interest=chain["open_interest"].fillna(0))
    df = df[(df["volume"] > 0) & df["strike"].between(spot * 0.7, spot * 1.3)].assign(premium=lambda d: d["volume"] * d["mid"] * 100)

    def top(kind):
        out = []
        for r in df[df["option_type"] == kind].nlargest(n, "premium").itertuples():
            itm = r.strike < spot if kind == "call" else r.strike > spot
            out.append({"expiration": r.expiration.isoformat(), "dte": (r.expiration - date.today()).days,
                        "strike": trading.r2(r.strike), "mid": trading.r2(r.mid), "volume": int(r.volume),
                        "oi": int(r.open_interest), "premium": round(float(r.premium)), "itm": bool(itm),
                        "otm_pct": trading.r2((r.strike / spot - 1) * 100, 1),
                        # Volume above open interest means mostly new positions opened today.
                        "unusual": bool(r.open_interest and r.volume > r.open_interest)})
        return out

    return {"calls": top("call"), "puts": top("put")}


def evaluate(symbol: str, positions: list[Position]) -> dict:
    spot = get_quote(symbol)["last_price"]
    sig = get_signals(symbol)
    chain = None
    if any(p.kind == "option" for p in positions):
        try:
            chain = get_chain(symbol, spot)
        except HTTPException:
            chain = None
    iv30 = (sig.get("options") or {}).get("iv30")
    ev = trading.evaluate_positions([p.model_dump() for p in positions], chain, spot, iv30)
    ev["signals"] = sig
    return ev


@app.post("/api/positions/evaluate")
def positions_evaluate(req: PositionsRequest):
    ev = evaluate(req.symbol.upper(), req.positions)
    ev.pop("signals", None)
    return ev


REVIEW_PROMPT = """You are an experienced portfolio manager and options risk specialist reviewing a trader's EXISTING
position in one stock. Using ONLY the data provided (live marks, P/L, greeks, technicals, option-implied move, news),
give a candid, practical review. Consider: is the original thesis still intact vs. trend / levels / momentum?
position risk (delta exposure, theta decay, days to expiration, short-option assignment risk, concentration of payoff),
where to take profit or cut loss (use support/resistance, ATR and the expected move), and whether to hold, trim, close,
roll (later expiration / different strike), or hedge (e.g. collar, protective put, covered call, converting a long option
into a spread). Adjustment legs MUST use contracts from the CONTRACTS table. If the trader asked a question, answer it
directly and specifically in "answer". Be concise; numbers over adjectives. This is an educational review, not advice.

Return ONLY a JSON object:
{
  "verdict": "hold" | "add" | "trim" | "close" | "roll" | "hedge",
  "health": 0-100,
  "summary": "2-3 sentence assessment of the whole position",
  "positions": [{"index": number, "action": "hold" | "add" | "take_profit" | "trim" | "cut_loss" | "close" | "roll" | "hedge", "reason": "..."}],
  "stop_loss": number | null,
  "take_profit": number | null,
  "watch_levels": [{"price": number, "why": "..."}],
  "risk_flags": ["..."],
  "adjustments": [
    {"name": "e.g. Roll 230C to Nov 240C", "outlook": "...", "legs": [{"action": "buy" | "sell", "type": "call" | "put" | "stock", "strike": number, "expiration": "YYYY-MM-DD", "qty": number}],
     "rationale": "...", "management": "...", "risks": "..."}
  ],
  "answer": "direct answer to the trader's question, or null"
}
For "adjustments", list ONLY the NEW trades to place (e.g. for a roll: sell-to-close the old contract and buy the new one)."""


def build_review_context(symbol: str, positions: list[Position], question: str | None) -> tuple[str, dict]:
    ev = evaluate(symbol, positions)
    sig = ev.pop("signals")
    spot = ev["spot"]
    q = get_quote(symbol)
    rows = [{k: r.get(k) for k in ("index", "label", "qty", "cost", "mark", "pnl", "pnl_pct", "delta", "theta", "dte",
                                    "moneyness", "iv", "strike", "expiration", "type", "side")} for r in ev["rows"]]
    payoff = {k: v for k, v in (ev["payoff"] or {}).items() if k != "curve"} or None
    parts = [
        f"## Quote\nprice {spot}, change {q.get('change_percent') and round(q['change_percent'], 2)}%",
        f"## Positions (marked to market; delta in share-equivalents, theta in $/day)\n{json.dumps(rows)}",
        f"## Totals\n{json.dumps(ev['total'])}",
        f"## Combined payoff at first expiration\n{json.dumps(payoff)}" if payoff else "",
        f"## Technicals\n{json.dumps(sig['technicals'])}",
    ]
    chain = None
    if sig.get("options"):
        parts.append(f"## Options summary\n{json.dumps(sig['options'])}")
        chain = get_chain(symbol, spot)
        held = {date.fromisoformat(r["expiration"]) for r in ev["rows"] if r.get("expiration")}
        exps = sorted(held | {date.fromisoformat(e["expiration"]) for e in sig["options"]["expirations"]})[:5]
        parts.append(f"## CONTRACTS (the only contracts you may use in adjustments)\n"
                     f"{trading.contracts_table(trading.candidate_contracts(chain, spot, exps))}")
    try:
        parts.append("## Headlines\n" + "\n".join(f"- [{(n.get('date') or '')[:10]}] {n['title']}" for n in get_news(symbol, 10)))
    except HTTPException:
        pass
    if cal := calendar_context(symbol):
        parts.append(cal)
    if question:
        parts.append(f"## Trader's question\n{question.strip()[:1000]}")
    return "\n\n".join(p for p in parts if p), {"spot": spot, "chain": chain, "signals": sig, "evaluation": ev}


@app.post("/api/positions/review")
async def positions_review(req: PositionsRequest, request: Request):
    api_key, user_id = await require_ai_key(request)
    symbol = req.symbol.upper()
    model = req.model or DEFAULT_MODEL
    if not req.positions:
        raise HTTPException(400, "Add at least one position first.")
    audit = AiAudit("position_review", symbol, user_id, model, req.lang,
                    {"question": req.question, "deep": req.deep, "positions": [p.model_dump() for p in req.positions]})

    async def gen():
        try:
            async for event in run():
                yield event
        finally:
            audit.finish()

    async def run():
        yield sse("status", {"step": "data", "message": "Marking positions to market…"})
        try:
            context, ctx = await run_in_threadpool(build_review_context, symbol, req.positions, req.question)
        except HTTPException as e:
            audit.row.update(status="error", error=str(e.detail))
            yield sse("error", {"error": e.detail})
            return
        yield sse("status", {"step": "model", "message": f"Asking {model} to review…"})
        messages = [{"role": "system", "content": REVIEW_PROMPT + lang_note(req.lang, json_mode=True)},
                    {"role": "user", "content": f"Symbol: {symbol}. Today: {datetime.now(NY):%Y-%m-%d}.\n\n{context}"}]
        audit.row["messages"] = messages
        review, usage, last_err = None, None, None
        for attempt in range(2):
            text = ""
            try:
                thinking = 0
                async for kind, value in openrouter_stream(api_key, messages, model, **reasoning_opts(req.deep)):
                    if kind == "usage":
                        usage = value
                    elif kind == "reasoning":
                        thinking += len(value)
                        yield sse("progress", {"thinking": thinking, "chars": len(text)})
                    else:
                        text += value
                        yield sse("progress", {"thinking": thinking, "chars": len(text)})
            except (OpenRouterError, httpx.HTTPError) as e:
                audit.row.update(status="error", error=str(e), output=text or None, usage=usage)
                yield sse("error", {"error": str(e)})
                return
            audit.row.update(output=text, usage=usage)
            try:
                review = parse_json(text)
                if "verdict" not in review:
                    raise ValueError("missing verdict")
                break
            except (ValueError, json.JSONDecodeError) as e:
                review, last_err = None, e
                yield sse("status", {"step": "model", "message": "Model output was malformed — retrying…"})
        if review is None:
            audit.row.update(status="error", error=f"Could not parse model output ({last_err})")
            yield sse("error", {"error": f"Could not parse model output ({last_err}). Try again or pick another model."})
            return
        yield sse("status", {"step": "validate", "message": "Pricing suggested adjustments…"})
        chain, spot = ctx["chain"], ctx["spot"]
        iv30 = (ctx["signals"].get("options") or {}).get("iv30")
        adj = []
        for a in review.get("adjustments") or []:
            if chain is None:
                break
            legs, notes = await run_in_threadpool(trading.resolve_legs, a.get("legs") or [], chain, spot)
            if legs:
                a.update(legs=legs, notes=notes, metrics=trading.strategy_metrics(legs, spot, iv30))
                adj.append(a)
        review["adjustments"] = adj
        review.update(spot=spot, usage=usage, question=req.question, generated_at=datetime.now(NY).isoformat())
        audit.row.update(status="ok", result=review)
        yield sse("result", review)
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- market calendar

# The Nasdaq feed has no importance field, so rank US releases by what moves markets.
CRITICAL_EVENTS = [
    r"interest rate decision", r"fed funds rate", r"^fomc (statement|press conference|economic projections|meeting minutes|minutes)",
    r"^(core )?cpi\b", r"consumer price index", r"^nonfarm payrolls", r"^unemployment rate", r"^core pce price index",
    r"^gdp( \(qoq\)| growth rate| annualized)?$",
]
MAJOR_EVENTS = [
    r"^(core )?ppi\b", r"producer price index", r"^(core )?retail sales", r"^ism (manufacturing|non-manufacturing|services) pmi$",
    r"^jolts job openings", r"^adp nonfarm", r"^initial jobless claims", r"^cb consumer confidence",
    r"michigan consumer sentiment$", r"^(core )?durable goods orders", r"^average hourly earnings", r"^pce price index",
    r"^core pce prices", r"^gdp price index", r"^building permits$", r"^housing starts$", r"^new home sales$",
    r"^existing home sales$", r"^industrial production", r"^crude oil inventories", r"beige book", r"^trade balance$",
]
EARNINGS_MAJOR_CAP = 50e9


def event_tier(name: str) -> str | None:
    n = name.lower().strip()
    if "speaks" in n or "testifies" in n:  # only the Fed Chair moves markets reliably
        return "critical" if re.search(r"\bfed chair\b", n) and "vice" not in n else None
    if any(re.search(p, n) for p in CRITICAL_EVENTS):
        return "critical"
    if any(re.search(p, n) for p in MAJOR_EVENTS):
        return "major"
    return None


def economic_releases(start: date, end: date) -> list[dict]:
    """Critical / major US releases between two New York dates (inclusive), merged by release."""
    def load():
        df = obb_call(obb.economy.calendar, provider="nasdaq", start_date=start, end_date=end)
        df = df[df["country"] == "United States"]
        grouped: dict[tuple, dict] = {}
        for r in df.itertuples():
            tier = event_tier(str(r.event))
            if not tier:
                continue
            d = r.date.to_pydatetime() if hasattr(r.date, "to_pydatetime") else r.date
            key = (d, r.event.strip().lower())  # same release is sometimes listed with different casing
            g = grouped.setdefault(key, {"datetime": d.isoformat(), "date": d.date().isoformat(),
                                         "time": d.strftime("%H:%M"), "event": r.event.strip(), "tier": tier,
                                         "description": r.description[:400] if isinstance(r.description, str) and r.description else None,
                                         "values": []})
            vals = {k: (str(getattr(r, k)).strip() if getattr(r, k) not in (None, "") else None)
                    for k in ("consensus", "previous", "actual")}
            vals = {k: (None if v in ("-", "", "nan", "None") else v) for k, v in vals.items()}
            if any(vals.values()) and vals not in g["values"]:
                g["values"].append(vals)
        return sorted(grouped.values(), key=lambda x: (x["datetime"], x["tier"] != "critical", x["event"]))

    return cached(f"econcal:{start}:{end}", 900, load)


def economic_calendar(days: int) -> list[dict]:
    start = datetime.now(NY).date()
    return economic_releases(start, start + timedelta(days=days))


def surprise(vals: dict) -> str | None:
    """'above' / 'below' / 'inline' when actual and consensus are both numeric (e.g. "0.4%", "254K")."""
    def num(x):
        m = re.search(r"-?\d+(?:\.\d+)?", (x or "").replace(",", ""))
        return float(m.group()) if m else None
    unit = lambda x: re.sub(r"[-\d.,\s]", "", x or "")
    a, c = num(vals.get("actual")), num(vals.get("consensus"))
    if a is None or c is None or unit(vals.get("actual")) != unit(vals.get("consensus")):  # e.g. 1.2M vs 950K
        return None
    return "inline" if abs(a - c) < 1e-9 else "above" if a > c else "below"


def recent_economic(days: int) -> list[dict]:
    """Releases already out in the last `days` days (including earlier today), newest first, with surprise vs consensus."""
    now = datetime.now(NY)
    out = []
    for ev in economic_releases(now.date() - timedelta(days=days), now.date()):
        if datetime.fromisoformat(ev["datetime"]).replace(tzinfo=None) > now.replace(tzinfo=None):
            continue
        ev = dict(ev, values=[dict(v, surprise=surprise(v)) for v in ev["values"]])
        out.append(ev)
    return sorted(out, key=lambda x: (x["datetime"], x["tier"] == "critical"), reverse=True)


def earnings_calendar(days: int) -> list[dict]:
    def load():
        start = datetime.now(NY).date()
        df = obb_call(obb.equity.calendar.earnings, provider="nasdaq", start_date=start, end_date=start + timedelta(days=days))
        out = []
        for r in records(df):
            sym = str(r.get("symbol") or "")
            if not sym or "." in sym:  # skip duplicate share-class listings like MKC.V
                continue
            out.append({"date": str(r.get("report_date"))[:10], "symbol": sym, "name": r.get("name"),
                        "market_cap": r.get("market_cap"), "time": r.get("reporting_time"),
                        "eps_consensus": r.get("eps_consensus"), "eps_previous": r.get("eps_previous"),
                        "num_estimates": r.get("num_estimates")})
        return sorted(out, key=lambda x: (x["date"], -(x["market_cap"] or 0)))

    return cached(f"earncal:{days}", 1800, load)


def next_earnings(symbol: str, days: int = 21) -> dict | None:
    try:
        return next((e for e in earnings_calendar(days) if e["symbol"] == symbol), None)
    except HTTPException:
        return None


@app.get("/api/calendar")
def calendar(days: int = 7, symbols: str = ""):
    """Critical / major US economic releases (upcoming and the last 7 days) and major earnings (plus any `symbols`, e.g. the watchlist)."""
    days = max(1, min(days, 14))
    watch = {x.strip().upper() for x in symbols.split(",") if x.strip()}
    out = {"days": days, "economic": [], "recent": [], "earnings": [], "errors": []}
    try:
        out["economic"] = economic_calendar(days)
    except HTTPException as e:
        out["errors"].append(f"economic: {e.detail}")
    try:
        out["recent"] = recent_economic(7)
    except HTTPException as e:
        out["errors"].append(f"recent: {e.detail}")
    try:
        out["earnings"] = [dict(e, watch=e["symbol"] in watch) for e in earnings_calendar(days)
                           if (e["market_cap"] or 0) >= EARNINGS_MAJOR_CAP or e["symbol"] in watch]
    except HTTPException as e:
        out["errors"].append(f"earnings: {e.detail}")
    return out


# SEC forms worth surfacing next to news; insider (3/4/5, 144) and fund filings are noise here.
KEY_FORMS = {"10-K": "Annual report", "10-Q": "Quarterly report", "8-K": "Current report", "20-F": "Annual report",
             "6-K": "Current report", "10-K/A": "Annual report (amended)", "10-Q/A": "Quarterly report (amended)",
             "DEF 14A": "Proxy statement", "S-1": "Registration", "S-3": "Shelf registration"}
# 8-K item codes → what happened.
EIGHT_K_ITEMS = {"2.02": "Earnings release", "1.01": "Material agreement", "2.01": "Acquisition / disposal",
                 "5.02": "Executive / board change", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure",
                 "8.01": "Other event", "1.02": "Agreement terminated", "2.03": "New debt obligation", "3.02": "Unregistered equity sale"}


def get_events(symbol: str) -> dict:
    """Corporate events for one stock: next/past earnings, dividends, splits and key SEC filings."""
    def load():
        import yfinance as yf
        t = yf.Ticker(symbol)
        out = {"symbol": symbol, "earnings": None, "history": [], "dividends": None, "split": None, "filings": []}
        today = datetime.now(NY).date()
        try:
            ed = t.get_earnings_dates(limit=12)
            if ed is not None and not ed.empty:
                ed = ed.sort_index()
                for ts, r in ed.iterrows():
                    eps_est, eps = clean(r.get("EPS Estimate")), clean(r.get("Reported EPS"))
                    when = ts.tz_convert(NY) if ts.tzinfo else ts
                    if eps is None and when.date() >= today and out["earnings"] is None:
                        mins = when.hour * 60 + when.minute
                        out["earnings"] = {"date": when.date().isoformat(), "days": (when.date() - today).days,
                                           "time": "After close" if mins >= 960 else "Before open" if 0 < mins <= 570 else None,
                                           "eps_estimate": eps_est}
                    elif eps is not None:
                        out["history"].append({"date": when.date().isoformat(), "eps_estimate": eps_est, "eps": eps,
                                               "surprise_pct": clean(r.get("Surprise(%)")),
                                               "before_open": 0 < when.hour * 60 + when.minute <= 570})
                out["history"] = out["history"][-4:][::-1]
        except Exception:
            pass
        try:  # how the stock actually reacted: first regular-session close that could price in the report
            closes = {b["time"]: b["close"] for b in get_history(symbol, "1Y")["bars"] if b["close"]}
            days = sorted(closes)
            chg = lambda a, b: round((closes[days[b]] / closes[days[a]] - 1) * 100, 2) if a >= 0 and b < len(days) else None
            for h in out["history"]:
                before_open = h.pop("before_open")
                h["timing"] = "before_open" if before_open else "after_close"
                i = next((k for k, d in enumerate(days) if d >= h["date"]), None)
                if i is None:
                    continue
                if days[i] == h["date"]:
                    h["day_pct"] = chg(i - 1, i)        # the report date's own session
                    h["next_day_pct"] = chg(i, i + 1)   # the session after it
                if days[i] != h["date"] or before_open:  # report before the open (or on a non-trading day): that day vs prior close
                    h["reaction_pct"] = chg(i - 1, i)
                else:  # after the close: next day vs report-day close
                    h["reaction_pct"] = chg(i, i + 1)
        except Exception:
            for h in out["history"]:
                h.pop("before_open", None)
        try:
            cal = t.calendar or {}
            if out["earnings"] and cal:
                out["earnings"].update({"eps_low": clean(cal.get("Earnings Low")), "eps_high": clean(cal.get("Earnings High")),
                                        "revenue_estimate": clean(cal.get("Revenue Average"))})
            if cal.get("Ex-Dividend Date"):
                out["dividends"] = {"ex_date": str(cal["Ex-Dividend Date"]), "pay_date": str(cal.get("Dividend Date") or "") or None}
        except Exception:
            pass
        try:
            div = t.dividends
            if div is not None and not div.empty:
                last = div.index[-1]
                d = out["dividends"] or {}
                gaps = pd.Series(div.index[-6:]).diff().dt.days.dropna()
                per_year = min(12, max(1, round(365 / gaps.median()))) if len(gaps) else 1  # 4 = quarterly, 12 = monthly
                d.update({"amount": round(float(div.iloc[-1]), 4), "last_ex_date": last.date().isoformat(),
                          "per_year": per_year, "annual": round(float(div.iloc[-1]) * per_year, 4),
                          "raised": bool(len(div) > 1 and div.iloc[-1] > div.iloc[-2])})
                out["dividends"] = d
        except Exception:
            pass
        try:
            sp = t.splits
            if sp is not None and not sp.empty:
                ratio = float(sp.iloc[-1])
                out["split"] = {"date": sp.index[-1].date().isoformat(),
                                "ratio": f"{ratio:g}-for-1" if ratio >= 1 else f"1-for-{1 / ratio:g}"}
        except Exception:
            pass
        try:
            fl = records(obb_call(obb.equity.fundamental.filings, symbol=symbol, provider="sec", limit=150))
            for f in fl:
                form = f.get("report_type")
                if form not in KEY_FORMS:
                    continue
                items = [i.strip() for i in str(f.get("items") or "").split(",") if i.strip()]
                what = next((EIGHT_K_ITEMS[i] for i in items if i in EIGHT_K_ITEMS), None) if form in ("8-K", "6-K") else None
                out["filings"].append({"date": str(f.get("filing_date"))[:10], "form": form, "title": what or KEY_FORMS[form],
                                       "url": f.get("report_url") or f.get("filing_detail_url")})
                if len(out["filings"]) >= 6:
                    break
        except Exception:
            pass
        return out

    return cached(f"events:{symbol}", 3600, load)


@app.get("/api/events/{symbol}")
def events(symbol: str):
    return get_events(symbol.upper())


@app.get("/api/next-earnings/{symbol}")
def next_earnings_route(symbol: str):
    return next_earnings(symbol.upper()) or {}


def calendar_context(symbol: str) -> str:
    """Catalysts for AI prompts: the symbol's earnings date, upcoming critical US macro releases and recent macro data."""
    lines = []
    e = next_earnings(symbol)
    if e:
        lines.append(f"- {symbol} EARNINGS {e['date']} ({e.get('time') or 'time n/a'}), EPS consensus {e.get('eps_consensus')}")
    try:
        for ev in economic_calendar(10):
            if ev["tier"] == "critical":
                v = ev["values"][0] if ev["values"] else {}
                lines.append(f"- {ev['date']} {ev['time']} ET {ev['event']} (consensus {v.get('consensus')}, prev {v.get('previous')})")
    except HTTPException:
        pass
    out = "## Upcoming catalysts\n" + "\n".join(lines[:12]) if lines else ""
    if recent := macro_recap_context():
        out = f"{out}\n\n{recent}" if out else recent
    return out


def macro_recap_context(days: int = 7) -> str:
    """Recently released US macro data (actual vs consensus) for AI prompts."""
    try:
        evs = recent_economic(days)
    except HTTPException:
        return ""
    lines = []
    for ev in evs:
        for v in ev["values"][:1] or [{}]:
            if not v.get("actual"):
                continue
            s = {"above": ", ABOVE consensus", "below": ", BELOW consensus", "inline": ", in line"}.get(v.get("surprise"), "")
            lines.append(f"- {ev['date']} {ev['time']} ET [{ev['tier']}] {ev['event']}: actual {v['actual']} "
                         f"vs consensus {v.get('consensus')}, prev {v.get('previous')}{s}")
    if not lines:
        return ""
    return (f"## Recent US macro releases (last {days} days, newest first)\n" + "\n".join(lines[:15])
            + "\n(Consider how these surprises shaped rates, sector rotation and this stock's recent moves.)")


# ---------------------------------------------------------------- company logos

LOGO_DIR = ROOT / ".cache" / "logos"
LOGO_SOURCES = (
    "https://financialmodelingprep.com/image-stock/{symbol}.png",
    "https://assets.parqet.com/logos/symbol/{symbol}?format=png",
)
LOGO_MISS_TTL = 86400  # re-check tickers without a logo once a day


@app.get("/api/logo/{symbol}")
async def logo(symbol: str):
    """Company logo by ticker, fetched once from keyless public sources and cached on disk."""
    symbol = symbol.upper()
    if not re.fullmatch(r"[A-Z0-9.\-]{1,10}", symbol):  # indices like ^VIX have no logo
        raise HTTPException(404)
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    path, miss = LOGO_DIR / f"{symbol}.png", LOGO_DIR / f"{symbol}.none"
    headers = {"Cache-Control": "public, max-age=604800"}
    if path.exists():
        return Response(path.read_bytes(), media_type="image/png", headers=headers)
    if miss.exists() and time.time() - miss.stat().st_mtime < LOGO_MISS_TTL:
        raise HTTPException(404)
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        for url in LOGO_SOURCES:
            try:
                r = await client.get(url.format(symbol=symbol))
            except httpx.HTTPError:
                continue
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/") and len(r.content) > 200:
                path.write_bytes(r.content)
                return Response(r.content, media_type="image/png", headers=headers)
    miss.touch()
    raise HTTPException(404)


# ---------------------------------------------------------------- static frontend

app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    """Serve the page with CSS/JS URLs versioned by file mtime so browsers never run stale assets."""
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    for name in ("style.css", "i18n.js", "app.js"):
        v = int((ROOT / "static" / name).stat().st_mtime)
        html = html.replace(f"/static/{name}", f"/static/{name}?v={v}")
    return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache"})
