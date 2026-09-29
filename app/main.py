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

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
NY = ZoneInfo("America/New_York")
PROVIDER = "yfinance"
STREAM_LIFETIME = 60  # seconds per SSE connection

# Cheap-but-capable OpenRouter models (USD per 1M tokens, input/output).
MODELS = [
    {"id": "deepseek/deepseek-v4-flash", "label": "DeepSeek V4 Flash", "price": "$0.14 / $0.28"},
    {"id": "google/gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash Lite", "price": "$0.10 / $0.40"},
    {"id": "qwen/qwen3.7-flash", "label": "Qwen 3.7 Flash", "price": "$0.03 / $0.13"},
    {"id": "z-ai/glm-5.3-flash", "label": "GLM 5.3 Flash", "price": "$0.15 / $0.50"},
    {"id": "openai/gpt-5-nano", "label": "GPT-5 Nano", "price": "$0.05 / $0.40"},
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


def get_news(symbols: str, limit: int) -> list[dict]:
    def load():
        df = obb_call(obb.news.company, symbols, provider=PROVIDER, limit=limit)
        df = df.sort_values("date", ascending=False).drop_duplicates("title")
        cols = [c for c in ("date", "title", "url", "source", "symbol", "summary") if c in df]
        return records(df[cols])

    return cached(f"news:{symbols}:{limit}", 120, load)


# ---------------------------------------------------------------- API routes


@app.get("/api/config")
def config():
    return {"models": MODELS, "default_model": DEFAULT_MODEL, "ai_enabled": bool(OPENROUTER_API_KEY)}


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


class AnalyzeRequest(BaseModel):
    symbol: str
    model: str | None = None


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
        news = get_news(symbol, 15)
        lines = [f"- [{(n.get('date') or '')[:10]}] {n['title']} ({n.get('source')}): {(n.get('summary') or '')[:300]}"
                 for n in news]
        parts.append("## Recent news\n" + "\n".join(lines))
    except HTTPException:
        pass

    return "\n\n".join(parts)


SYSTEM_PROMPT = """You are a sharp, balanced equity research analyst. Using ONLY the data provided, write a concise
analysis in Markdown with these sections:
### TL;DR  (2-3 sentences, include an overall stance: Bullish / Neutral / Bearish and a confidence level)
### News & Sentiment  (key themes from the headlines, sentiment per theme, what matters most)
### Price Action & Technicals  (trend vs 50/200-day averages, momentum, position in 52-week range)
### Fundamentals & Valuation  (valuation multiples, growth, margins, balance sheet)
### Bull Case / Bear Case  (bullets)
### Key Risks & Catalysts to Watch
Be specific with numbers. Say when data is missing. End with a one-line reminder that this is not investment advice."""


class OpenRouterError(Exception):
    pass


async def openrouter_stream(messages: list[dict], model: str, **extra):
    """Yield ("text", str) chunks then ("usage", dict) from an OpenRouter streaming completion."""
    body = {"model": model, "stream": True, "usage": {"include": True}, "messages": messages, **extra}
    headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}", "X-Title": "Maru Pulse",
               "HTTP-Referer": "http://localhost:8000"}
    async with httpx.AsyncClient(timeout=180) as client:
        async with client.stream("POST", "https://openrouter.ai/api/v1/chat/completions", json=body, headers=headers) as r:
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


def require_key():
    if not OPENROUTER_API_KEY:
        raise HTTPException(400, "OPENROUTER_API_KEY is not set. Add it to .env and restart.")


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    require_key()
    symbol = req.symbol.upper()
    model = req.model or DEFAULT_MODEL
    context = await run_in_threadpool(build_context, symbol)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Analyze {symbol}. Today is {datetime.now(NY):%Y-%m-%d}.\n\n{context}"},
    ]

    async def gen():
        try:
            async for kind, value in openrouter_stream(messages, model):
                if kind == "usage":
                    yield sse("usage", value)
                elif kind == "text":
                    yield sse(None, {"text": value})
        except (OpenRouterError, httpx.HTTPError) as e:
            yield sse("error", {"error": str(e)})
            return
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- signals & trade ideas


def get_chain(symbol: str, spot: float):
    def load():
        try:
            df = obb_call(obb.derivatives.options.chains, symbol, provider=PROVIDER)
        except HTTPException:  # Yahoo's options endpoint fails intermittently; one retry fixes most
            time.sleep(1)
            df = obb_call(obb.derivatives.options.chains, symbol, provider=PROVIDER)
        return trading.clean_chain(df, spot)

    return cached(f"chain:{symbol}", 300, load)


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
async def trade_ideas(req: TradeRequest):
    require_key()
    symbol = req.symbol.upper()
    model = req.model or DEFAULT_MODEL
    risk = req.risk if req.risk in ("conservative", "moderate", "aggressive") else "moderate"

    async def gen():
        yield sse("status", {"step": "data", "message": "Pulling quote, technicals and option chain from OpenBB…"})
        try:
            context, ctx = await run_in_threadpool(build_trade_context, symbol)
        except HTTPException as e:
            yield sse("error", {"error": e.detail})
            return
        yield sse("status", {"step": "model", "message": f"Asking {model} for trade setups…"})
        messages = [
            {"role": "system", "content": TRADE_PROMPT},
            {"role": "user", "content": f"Symbol: {symbol}. Today: {datetime.now(NY):%Y-%m-%d}. Risk profile: {risk}.\n\n{context}"},
        ]
        ideas, usage, last_err = None, None, None
        for attempt in range(2):  # retry once if the model returns malformed / incomplete JSON
            text = ""
            try:
                thinking = 0
                async for kind, value in openrouter_stream(messages, model, **reasoning_opts(req.deep)):
                    if kind == "usage":
                        usage = value
                    elif kind == "reasoning":
                        thinking += len(value)
                        yield sse("progress", {"thinking": thinking, "chars": len(text)})
                    else:
                        text += value
                        yield sse("progress", {"thinking": thinking, "chars": len(text), "attempt": attempt + 1})
            except (OpenRouterError, httpx.HTTPError) as e:
                yield sse("error", {"error": str(e)})
                return
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
            yield sse("error", {"error": f"Could not parse model output ({last_err}). Try again or pick another model."})
            return
        yield sse("status", {"step": "validate", "message": "Validating contracts and computing payoffs…"})
        ideas = await run_in_threadpool(enrich_ideas, ideas, ctx)
        ideas["risk_profile"] = risk
        ideas["usage"] = usage
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


@app.get("/api/chain-meta/{symbol}")
def chain_meta(symbol: str):
    """Expirations, strikes and mids so the UI can offer real contracts."""
    symbol = symbol.upper()
    spot = get_quote(symbol)["last_price"]
    try:
        chain = get_chain(symbol, spot)
    except HTTPException:
        return {"spot": spot, "expirations": []}
    out = []
    for exp, g in chain.groupby("expiration"):
        contracts = {}
        for r in g.itertuples():
            contracts.setdefault(f"{r.strike:g}", {})[r.option_type] = round(float(r.mid), 2)
        out.append({"expiration": exp.isoformat(), "dte": int(g["dte"].iloc[0]),
                    "strikes": sorted(contracts, key=float), "mids": contracts})
    return {"spot": spot, "expirations": out}


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
    if question:
        parts.append(f"## Trader's question\n{question.strip()[:1000]}")
    return "\n\n".join(p for p in parts if p), {"spot": spot, "chain": chain, "signals": sig, "evaluation": ev}


@app.post("/api/positions/review")
async def positions_review(req: PositionsRequest):
    require_key()
    symbol = req.symbol.upper()
    model = req.model or DEFAULT_MODEL
    if not req.positions:
        raise HTTPException(400, "Add at least one position first.")

    async def gen():
        yield sse("status", {"step": "data", "message": "Marking positions to market…"})
        try:
            context, ctx = await run_in_threadpool(build_review_context, symbol, req.positions, req.question)
        except HTTPException as e:
            yield sse("error", {"error": e.detail})
            return
        yield sse("status", {"step": "model", "message": f"Asking {model} to review…"})
        messages = [{"role": "system", "content": REVIEW_PROMPT},
                    {"role": "user", "content": f"Symbol: {symbol}. Today: {datetime.now(NY):%Y-%m-%d}.\n\n{context}"}]
        review, usage, last_err = None, None, None
        for attempt in range(2):
            text = ""
            try:
                thinking = 0
                async for kind, value in openrouter_stream(messages, model, **reasoning_opts(req.deep)):
                    if kind == "usage":
                        usage = value
                    elif kind == "reasoning":
                        thinking += len(value)
                        yield sse("progress", {"thinking": thinking, "chars": len(text)})
                    else:
                        text += value
                        yield sse("progress", {"thinking": thinking, "chars": len(text)})
            except (OpenRouterError, httpx.HTTPError) as e:
                yield sse("error", {"error": str(e)})
                return
            try:
                review = parse_json(text)
                if "verdict" not in review:
                    raise ValueError("missing verdict")
                break
            except (ValueError, json.JSONDecodeError) as e:
                review, last_err = None, e
                yield sse("status", {"step": "model", "message": "Model output was malformed — retrying…"})
        if review is None:
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
        yield sse("result", review)
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


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
    return FileResponse(ROOT / "static" / "index.html")
