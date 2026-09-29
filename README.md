# Maru Pulse — OpenBB market news, live charts & AI trade analysis

A FastAPI + vanilla-JS webapp built on the [OpenBB Platform](https://github.com/OpenBB-finance/OpenBB).

- **Markets home**: index cards with intraday sparklines, top stories (filter by index), gainers / losers / most active
- **Watchlist sidebar** with live prices + sparklines, and recently viewed tickers (saved in the browser)
- **Command-palette search** (`⌘K` or `/`) by company name or ticker (OpenBB SEC symbol search)
- **Stock page**: live quote header, day / 52-week range bars, 24 key stats & fundamentals, company profile
- Light / dark theme, responsive down to phone width
- **Live price chart** (TradingView Lightweight Charts): 1D/5D/1M/6M/1Y/5Y, line or candles, volume.
  Quotes stream over Server-Sent Events every 5 s and update the chart during market hours
- **Extended hours**: pre-market / after-hours price on the quote header, watchlist and index cards (from Yahoo via
  `yfinance`, which OpenBB's quote model doesn't expose); 1D / 5D charts include 4:00–20:00 ET trading in a muted color
  (toggle **Ext hrs**), with live pre/post ticks. My Position shows what your shares' P/L would be at the extended price.
- **Company logos** everywhere a ticker appears (header, watchlist, movers, search) via `/api/logo/{symbol}`, which
  fetches from keyless public sources (Financial Modeling Prep, then Parqet), caches to `.cache/logos/`, and falls back
  to a colored monogram. White-on-transparent logos are detected and shown on a dark tile.
- **Company news** for the selected ticker
- **Trade Opportunities**
  - Live signals computed locally (no AI): trend vs 20/50/200-day MAs, RSI, MACD, ATR, support/resistance,
    IV vs realized vol, options-implied expected move, put/call OI, largest OI strikes
  - AI trade ideas by risk profile (conservative / moderate / aggressive): a stock setup (entry zone, stop, targets, R-multiples)
    and 2-3 option strategies. Every option leg is validated against the real yfinance chain, and net debit/credit,
    max profit/loss, breakevens, probability of profit and the payoff curve are computed server-side (Black-Scholes /
    lognormal) — never taken from the model. Entry/stop/targets are drawn on the chart.
  - Educational only, not investment advice.
- **My Position** — enter the shares / option contracts you hold (saved only in your browser). Contracts are picked
  from the live chain; each position is marked to market with P/L, delta and theta, plus a combined payoff at expiry.
  **AI position review** (optionally with your own question) returns a verdict and health score, an action per position
  (hold / take profit / trim / cut / roll / hedge), stop / take-profit / watch levels (drawn on the chart), risk flags,
  and adjustment trades priced on the real chain.
- **Deep think** toggle: reasoning models are run in fast mode by default (~15-30 s); enable it for a slower,
  more thorough answer.
- **AI analysis** via OpenRouter, streamed. Default model `deepseek/deepseek-v4-flash` ($0.14/$0.28 per 1M tokens);
  a single analysis costs a fraction of a cent. Token usage + cost shown after each run.

All market data comes from OpenBB's keyless providers (`yfinance`, `sec`).

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then add OPENROUTER_API_KEY
.venv/bin/uvicorn app.main:app --port 8000 --reload --timeout-graceful-shutdown 3
```

Open http://localhost:8000

## API

| Endpoint | Description |
|---|---|
| `GET /api/search?q=` | Symbol search |
| `GET /api/quote/{symbol}` | Latest quote |
| `GET /api/history/{symbol}?range=1D` | OHLCV bars |
| `GET /api/stream/{symbol}` | SSE live quote stream |
| `GET /api/news/{symbol}` / `GET /api/market-news` | News |
| `GET /api/indices`, `GET /api/movers` | Market overview |
| `GET /api/quotes?symbols=`, `GET /api/sparklines?symbols=` | Batch quotes / intraday sparklines |
| `GET /api/overview/{symbol}` | Profile + fundamentals |
| `GET /api/logo/{symbol}` | Company logo (PNG, cached) |
| `POST /api/analyze` `{symbol, model}` | Streamed AI analysis (SSE) |
| `GET /api/signals/{symbol}` | Technical + options signals |
| `POST /api/trade-ideas` `{symbol, model, risk, deep}` | AI trade ideas, validated & priced (SSE) |
| `GET /api/chain-meta/{symbol}` | Expirations, strikes, mids |
| `POST /api/positions/evaluate` | Mark positions to market (P/L, greeks, payoff) |
| `POST /api/positions/review` `{symbol, positions, question, model, deep}` | AI position review (SSE) |
