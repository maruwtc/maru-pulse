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
- **Market calendar** (home page, above Top Stories): critical / major US economic releases for the next 7 days
  (Fed decisions, CPI, payrolls, core PCE, GDP, plus PPI, retail sales, ISM, JOLTS, claims, …) with consensus /
  previous / actual, a countdown to the next critical release, and major earnings (≥ $50B or on your watchlist).
  Stock pages show an upcoming-earnings chip, and AI trade ideas / position reviews are told about these catalysts.
  Data: OpenBB `nasdaq` provider (keyless); importance tiers are assigned by the app.
- **Accounts (Supabase)** — Sign in with Google (the only sign-in method; OAuth PKCE flow). Watchlist, My Position entries and preferences (theme, AI model,
  risk profile, Deep think, chart toggles, calendar view) sync to your account; the first sign-in imports what this
  browser already had. Signed-out use still works, stored locally.
- **BYOK AI** — each user saves their own OpenRouter key in Settings. It's verified with OpenRouter, stored encrypted in
  Supabase Vault, and never returned to the browser (only the last 4 characters are shown). The server decrypts it with
  the secret key only after verifying the user's session, and AI usage is billed to that user's OpenRouter account.
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
- **Maru AI chat** — a floating assistant (bottom-right button; can be maximized) for free-form questions such as
  "what's your suggestion on the electricity sector?" or "compare NVDA and AMD". The server spots the sectors (English or
  Chinese keywords) and tickers asked about and gives the model fresh data: all SPDR sector ETFs' 1W / 1M / 3M / YTD returns,
  the sector's bellwethers (price vs 50/200-day averages, distance from the 52-week high, returns), quotes for named
  tickers, headlines and the macro calendar. Conversation history is kept in the browser.
- **Deep think** toggle: reasoning models are run in fast mode by default (~15-30 s); enable it for a slower,
  more thorough answer.
- **AI analysis** via OpenRouter, streamed. Default model `deepseek/deepseek-v4-flash` ($0.14/$0.28 per 1M tokens);
  a single analysis costs a fraction of a cent. Token usage + cost shown after each run.

All market data comes from OpenBB's keyless providers (`yfinance`, `sec`).

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then add SUPABASE_SECRET_KEY (see Supabase setup)
.venv/bin/uvicorn app.main:app --port 8000 --reload --timeout-graceful-shutdown 3
```

Open http://localhost:8000

### Supabase setup

1. Apply the schema in [`supabase/migrations`](supabase/migrations) (tables with row-level security, plus Vault-backed key functions).
2. `.env`: set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (public), and `SUPABASE_SECRET_KEY`
   (Dashboard → Project Settings → API Keys → Secret keys; server-only, never ship it to the browser).
3. Dashboard → Authentication → Sign In / Providers: enable **Google** (OAuth client ID + secret from Google Cloud,
   authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`) and disable **Email**.
4. Dashboard → Authentication → URL Configuration: Site URL `http://localhost:8000`, and add `http://localhost:8000/**`
   to Redirect URLs so Google sign-in returns to the app.
5. Click **Sign in → Continue with Google**, then Settings → OpenRouter API key.

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
| `GET /api/calendar?days=7&symbols=` | Critical/major economic events + earnings |
| `GET /api/next-earnings/{symbol}` | Next earnings date within 3 weeks |
| `POST /api/analyze` `{symbol, model}` | Streamed AI analysis (SSE) |
| `GET /api/signals/{symbol}` | Technical + options signals |
| `POST /api/trade-ideas` `{symbol, model, risk, deep}` | AI trade ideas, validated & priced (SSE) |
| `GET /api/chain-meta/{symbol}` | Expirations, strikes, mids |
| `POST /api/positions/evaluate` | Mark positions to market (P/L, greeks, payoff) |
| `POST /api/positions/review` `{symbol, positions, question, model, deep}` | AI position review (SSE) |
| `POST /api/chat` `{message, history, symbol, watchlist, model, deep}` | AI chat assistant with live sector / ticker data (SSE) |
| `POST /api/byok/refresh` | Drop the server's cached copy of the caller's key |

AI endpoints require `Authorization: Bearer <Supabase access token>` from a user who has saved an OpenRouter key.
