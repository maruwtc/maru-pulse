"""Technical signals, options analytics and strategy math for trade ideas.

Everything here is deterministic: the LLM proposes trades, but prices, greeks,
payoffs and probabilities are always computed from real market data.
"""

import math
from datetime import date

import numpy as np
import pandas as pd

RISK_FREE = 0.04


# ---------------------------------------------------------------- math helpers


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(S, K, T, sigma, kind, r=RISK_FREE):
    if T <= 0 or sigma <= 0:
        return max(S - K, 0) if kind == "call" else max(K - S, 0)
    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if kind == "call":
        return S * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)
    return K * math.exp(-r * T) * norm_cdf(-d2) - S * norm_cdf(-d1)


def bs_delta(S, K, T, sigma, kind, r=RISK_FREE):
    if T <= 0 or sigma <= 0:
        return (1.0 if S > K else 0.0) if kind == "call" else (-1.0 if S < K else 0.0)
    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    return norm_cdf(d1) if kind == "call" else norm_cdf(d1) - 1


def bs_theta(S, K, T, sigma, kind, r=RISK_FREE):
    """Theta per calendar day (per share)."""
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    pdf = math.exp(-d1**2 / 2) / math.sqrt(2 * math.pi)
    decay = -S * pdf * sigma / (2 * math.sqrt(T))
    if kind == "call":
        return (decay - r * K * math.exp(-r * T) * norm_cdf(d2)) / 365
    return (decay + r * K * math.exp(-r * T) * norm_cdf(-d2)) / 365


def r2(x, n=2):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


# ---------------------------------------------------------------- technicals


def technicals(bars: list[dict], price: float) -> dict:
    """Indicators from ~1 year of daily bars."""
    df = pd.DataFrame(bars)
    c, h, l = df["close"].astype(float), df["high"].astype(float), df["low"].astype(float)

    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()

    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean()

    logret = np.log(c / c.shift())
    hv20 = logret.tail(20).std() * math.sqrt(252)

    sma = {n: c.tail(n).mean() if len(c) >= n else None for n in (20, 50, 200)}
    above = [n for n, v in sma.items() if v and price > v]
    trend = ("Strong uptrend" if len(above) == 3 else "Uptrend" if price > (sma[50] or price) and (sma[50] or 0) > (sma[200] or 0)
             else "Strong downtrend" if not above else "Downtrend" if price < (sma[50] or price) and (sma[50] or 0) < (sma[200] or 0)
             else "Mixed / range")

    # Swing pivots (5 bars either side) over the last ~6 months → support / resistance.
    w = 5
    recent = df.tail(130).reset_index(drop=True)
    highs, lows = [], []
    for i in range(w, len(recent) - w):
        win = recent.iloc[i - w:i + w + 1]
        if recent.at[i, "high"] == win["high"].max():
            highs.append(float(recent.at[i, "high"]))
        if recent.at[i, "low"] == win["low"].min():
            lows.append(float(recent.at[i, "low"]))
    highs.append(float(h.tail(20).max()))
    lows.append(float(l.tail(20).min()))

    def levels(vals, above_price):
        vals = sorted((v for v in vals if (v > price * 1.003 if above_price else v < price * 0.997)), reverse=not above_price)
        out = []
        for v in vals:  # cluster levels within 1.5%
            if not out or abs(v / out[-1] - 1) > 0.015:
                out.append(v)
        return [r2(v) for v in out[:3]]

    def ret(n):
        return r2((c.iloc[-1] / c.iloc[-n - 1] - 1) * 100) if len(c) > n else None

    return {
        "price": r2(price),
        "rsi14": r2(rsi.iloc[-1], 1),
        "macd": r2(macd.iloc[-1], 3),
        "macd_signal": r2(signal.iloc[-1], 3),
        "macd_hist": r2(macd.iloc[-1] - signal.iloc[-1], 3),
        "macd_cross": "bullish" if macd.iloc[-1] > signal.iloc[-1] else "bearish",
        "atr14": r2(atr.iloc[-1]),
        "atr_pct": r2(atr.iloc[-1] / price * 100),
        "hv20": r2(hv20 * 100, 1),
        "sma20": r2(sma[20]), "sma50": r2(sma[50]), "sma200": r2(sma[200]),
        "trend": trend,
        "high_20d": r2(h.tail(20).max()), "low_20d": r2(l.tail(20).min()),
        "high_52w": r2(h.max()), "low_52w": r2(l.min()),
        "resistance": levels(highs, True),
        "support": levels(lows, False),
        "ret_1w": ret(5), "ret_1m": ret(21), "ret_3m": ret(63),
        "vol_ratio": r2(df["volume"].tail(5).mean() / df["volume"].tail(50).mean()) if df["volume"].tail(50).mean() else None,
    }


# ---------------------------------------------------------------- options


def clean_chain(df: pd.DataFrame, spot: float) -> pd.DataFrame:
    df = df.copy()
    df["expiration"] = pd.to_datetime(df["expiration"]).dt.date
    df = df[(df["bid"] > 0) & (df["ask"] >= df["bid"])]
    df["mid"] = (df["bid"] + df["ask"]) / 2
    df["spread_pct"] = (df["ask"] - df["bid"]) / df["mid"]
    df["iv"] = df["implied_volatility"].where((df["implied_volatility"] > 0.03) & (df["implied_volatility"] < 3))
    df["T"] = df["dte"].clip(lower=0.5) / 365
    df["delta"] = [
        bs_delta(spot, k, t, iv, kind) if iv == iv else None
        for k, t, iv, kind in zip(df["strike"], df["T"], df["iv"], df["option_type"])
    ]
    return df


def pick_expirations(chain: pd.DataFrame) -> list[date]:
    """Near-term (~1-2 wk), ~30d and ~45-60d expirations."""
    exps = sorted(chain["expiration"].unique())
    dte = {e: (e - date.today()).days for e in exps}
    picks = []
    for target in (10, 30, 50):
        cands = [e for e in exps if 5 <= dte[e] <= 90 and e not in picks]
        if cands:
            picks.append(min(cands, key=lambda e: abs(dte[e] - target)))
    return sorted(picks)


def atm_row(chain, exp, spot, kind):
    s = chain[(chain["expiration"] == exp) & (chain["option_type"] == kind)]
    if s.empty:
        return None
    return s.iloc[(s["strike"] - spot).abs().argsort().iloc[0]]


def options_summary(chain: pd.DataFrame, spot: float, hv20: float | None) -> dict:
    exps = pick_expirations(chain)
    rows = []
    for e in exps:
        c, p = atm_row(chain, e, spot, "call"), atm_row(chain, e, spot, "put")
        if c is None or p is None:
            continue
        ivs = [v for v in (c["iv"], p["iv"]) if v == v]
        straddle = c["mid"] + p["mid"]
        sub = chain[chain["expiration"] == e]
        calls, puts = sub[sub["option_type"] == "call"], sub[sub["option_type"] == "put"]
        rows.append({
            "expiration": e.isoformat(),
            "dte": int((e - date.today()).days),
            "atm_strike": r2(c["strike"]),
            "atm_iv": r2(np.mean(ivs) * 100, 1) if ivs else None,
            "expected_move": r2(straddle),
            "expected_move_pct": r2(straddle / spot * 100),
            "put_call_oi": r2(puts["open_interest"].sum() / max(calls["open_interest"].sum(), 1)),
            "put_call_volume": r2(puts["volume"].sum() / max(calls["volume"].sum(), 1)),
            "top_call_oi": [r2(x) for x in calls.nlargest(3, "open_interest")["strike"]],
            "top_put_oi": [r2(x) for x in puts.nlargest(3, "open_interest")["strike"]],
        })
    ref = next((r for r in rows if r["dte"] >= 20), rows[-1] if rows else None)
    iv30 = ref["atm_iv"] if ref else None
    return {
        "expirations": rows,
        "iv30": iv30,
        "hv20": hv20,
        "iv_hv_ratio": r2(iv30 / hv20) if iv30 and hv20 else None,
        "vol_regime": None if not (iv30 and hv20) else
            "Options expensive vs realized (favor selling premium / spreads)" if iv30 / hv20 > 1.25 else
            "Options cheap vs realized (favor buying premium)" if iv30 / hv20 < 0.85 else "Options fairly priced vs realized",
    }


def candidate_contracts(chain: pd.DataFrame, spot: float, exps: list[date]) -> pd.DataFrame:
    """Liquid contracts near the money that the LLM may use as legs."""
    out = []
    for e in exps:
        for kind in ("call", "put"):
            s = chain[(chain["expiration"] == e) & (chain["option_type"] == kind)
                      & (chain["strike"].between(spot * 0.8, spot * 1.2)) & (chain["spread_pct"] < 0.35)]
            s = s.iloc[(s["strike"] - spot).abs().argsort()].head(12).sort_values("strike")
            out.append(s)
    return pd.concat(out) if out else chain.head(0)


def contracts_table(df: pd.DataFrame) -> str:
    lines = ["expiration,type,strike,bid,ask,mid,iv%,delta,open_interest,volume"]
    for r in df.itertuples():
        lines.append(f"{r.expiration},{r.option_type},{r.strike:g},{r.bid:.2f},{r.ask:.2f},{r.mid:.2f},"
                     f"{(r.iv * 100 if r.iv == r.iv else 0):.0f},{(r.delta if r.delta is not None else 0):.2f},{r.open_interest},{r.volume}")
    return "\n".join(lines)


# ---------------------------------------------------------------- strategy math


def resolve_legs(legs: list[dict], chain: pd.DataFrame, spot: float) -> tuple[list[dict], list[str]]:
    """Snap LLM legs onto real contracts and attach live prices."""
    out, notes = [], []
    exps = sorted(chain["expiration"].unique())
    for leg in legs:
        kind = str(leg.get("type", "")).lower()
        action = str(leg.get("action", "")).lower()
        qty = max(1, int(leg.get("qty") or 1))
        if action not in ("buy", "sell"):
            continue
        if kind == "stock":
            out.append({"action": action, "type": "stock", "qty": qty, "price": r2(spot), "label": f"{qty * 100} shares"})
            continue
        if kind not in ("call", "put"):
            continue
        try:
            want = date.fromisoformat(str(leg.get("expiration"))[:10])
        except ValueError:
            want = exps[0]
        exp = min(exps, key=lambda e: abs((e - want).days))
        s = chain[(chain["expiration"] == exp) & (chain["option_type"] == kind)]
        if s.empty:
            continue
        strike = float(leg.get("strike") or spot)
        row = s.iloc[(s["strike"] - strike).abs().argsort().iloc[0]]
        if abs(row["strike"] - strike) > 0.01 or exp != want:
            notes.append(f"Adjusted {kind} {strike:g} {want} → {row['strike']:g} {exp} (nearest listed contract)")
        out.append({
            "action": action, "type": kind, "qty": qty, "strike": r2(row["strike"]), "expiration": exp.isoformat(),
            "dte": int(row["dte"]), "bid": r2(row["bid"]), "ask": r2(row["ask"]), "mid": r2(row["mid"]),
            "iv": r2(row["iv"] * 100, 1) if row["iv"] == row["iv"] else None,
            "delta": r2(row["delta"]) if row["delta"] is not None else None,
            "open_interest": int(row["open_interest"] or 0), "contract": row["contract_symbol"],
        })
    return out, notes


def strategy_metrics(legs: list[dict], spot: float, fallback_iv: float | None) -> dict | None:
    opts = [l for l in legs if l["type"] != "stock"]
    if not legs:
        return None
    first = min((date.fromisoformat(l["expiration"]) for l in opts), default=None)
    T0 = max((first - date.today()).days, 0.5) / 365 if first else 30 / 365
    sigma = (np.mean([l["iv"] for l in opts if l.get("iv")]) / 100) if any(l.get("iv") for l in opts) else (fallback_iv or 40) / 100

    def leg_value(l, S):
        if l["type"] == "stock":
            return S
        exp = date.fromisoformat(l["expiration"])
        T_left = max((exp - first).days, 0) / 365 if first else 0
        if T_left <= 0:
            return max(S - l["strike"], 0) if l["type"] == "call" else max(l["strike"] - S, 0)
        return bs_price(S, l["strike"], T_left, (l.get("iv") or sigma * 100) / 100, l["type"])

    def entry(l):  # user cost basis when reviewing a held position, else current mid
        if l.get("entry") is not None:
            return l["entry"]
        return l["price"] if l["type"] == "stock" else l["mid"]

    cost = sum((1 if l["action"] == "buy" else -1) * l["qty"] * 100 * entry(l) for l in legs)
    grid = np.unique(np.concatenate([np.linspace(0.01, spot * 3, 1500), np.linspace(spot * 0.6, spot * 1.4, 800)]))
    pnl = np.array([sum((1 if l["action"] == "buy" else -1) * l["qty"] * 100 * leg_value(l, S) for l in legs) for S in grid]) - cost

    up_slope = pnl[-1] - pnl[-2]
    max_profit = None if up_slope > 1e-6 else float(pnl.max())
    max_loss = None if up_slope < -1e-6 else float(pnl.min())
    breakevens = [float(grid[i] + (grid[i + 1] - grid[i]) * (-pnl[i]) / (pnl[i + 1] - pnl[i]))
                  for i in range(len(grid) - 1) if pnl[i] == 0 or (pnl[i] < 0) != (pnl[i + 1] < 0)]

    # Probability of profit under a lognormal terminal distribution.
    sd = sigma * math.sqrt(T0)
    mu = math.log(spot) + (RISK_FREE - sigma**2 / 2) * T0
    cdf = np.array([norm_cdf((math.log(S) - mu) / sd) for S in grid])
    mids = (pnl[:-1] + pnl[1:]) / 2
    pop = float(np.sum(np.diff(cdf)[mids > 0]))

    lo, hi = spot * math.exp(-2.5 * sd), spot * math.exp(2.5 * sd)
    pts = np.linspace(lo, hi, 80)
    curve = [[r2(S), r2(float(np.interp(S, grid, pnl)))] for S in pts]
    return {
        "net": r2(-cost), "net_type": "credit" if cost < 0 else "debit",
        "max_profit": r2(max_profit), "max_loss": r2(max_loss),
        "breakevens": [r2(b) for b in breakevens[:3]],
        "pop": r2(pop * 100, 1),
        "reward_risk": r2(max_profit / abs(max_loss)) if max_profit and max_loss and max_loss < 0 else None,
        "capital": r2(abs(max_loss) if max_loss is not None else None),
        "horizon": first.isoformat() if first else None,
        "curve": curve,
    }


def stock_metrics(t: dict, spot: float) -> dict:
    try:
        lo, hi, stop = float(t["entry_low"]), float(t["entry_high"]), float(t["stop"])
        targets = [float(x) for x in t.get("targets", []) if x]
    except (KeyError, TypeError, ValueError):
        return {}
    entry = (lo + hi) / 2
    risk = abs(entry - stop)
    long = t.get("direction") == "long"
    ok = (stop < entry and all(x > entry for x in targets)) if long else (stop > entry and all(x < entry for x in targets))
    return {
        "entry": r2(entry),
        "risk_per_share": r2(risk),
        "stop_pct": r2((stop / entry - 1) * 100),
        "targets_pct": [r2((x / entry - 1) * 100) for x in targets],
        "reward_risk": [r2(abs(x - entry) / risk) if risk else None for x in targets],
        "entry_vs_spot_pct": r2((entry / spot - 1) * 100),
        "consistent": ok,
    }


# ---------------------------------------------------------------- held positions


def evaluate_positions(positions: list[dict], chain: pd.DataFrame | None, spot: float, fallback_iv: float | None) -> dict:
    """Mark user positions to market and aggregate P/L and greeks.

    Stock qty is in shares; option qty is in contracts (x100)."""
    rows, legs, notes = [], [], []
    for i, p in enumerate(positions):
        side = "buy" if str(p.get("side", "long")).lower() in ("long", "buy") else "sell"
        sign = 1 if side == "buy" else -1
        qty = abs(float(p.get("qty") or 0))
        cost = float(p.get("cost") or 0)
        if qty <= 0:
            continue
        if p.get("kind") == "stock":
            mv = sign * qty * spot
            basis = sign * qty * cost
            rows.append({"index": i, "kind": "stock", "side": side, "qty": qty, "cost": r2(cost), "mark": r2(spot),
                         "market_value": r2(mv), "cost_basis": r2(basis), "pnl": r2(mv - basis),
                         "pnl_pct": r2((spot / cost - 1) * 100 * sign) if cost else None,
                         "delta": r2(sign * qty), "theta": 0.0, "label": f"{'Long' if sign > 0 else 'Short'} {qty:g} shares"})
            # Stock payoff legs are in 100-share lots.
            legs.append({"action": side, "type": "stock", "qty": qty / 100, "price": spot, "entry": cost})
            continue
        kind = str(p.get("type", "call")).lower()
        resolved, n = ([], []) if chain is None or chain.empty else resolve_legs(
            [{"action": side, "type": kind, "strike": p.get("strike"), "expiration": p.get("expiration"), "qty": 1}], chain, spot)
        if not resolved:
            # Keep the row visible at cost so the position never silently disappears.
            basis = sign * qty * 100 * cost
            try:
                exp_short = date.fromisoformat(str(p.get("expiration"))[:10]).strftime("%b %d '%y")
            except ValueError:
                exp_short = str(p.get("expiration"))
            rows.append({"index": i, "kind": "option", "side": side, "qty": qty, "type": kind, "strike": p.get("strike"),
                         "expiration": p.get("expiration"), "dte": None, "cost": r2(cost), "mark": None, "unpriced": True,
                         "market_value": r2(basis), "cost_basis": r2(basis), "pnl": 0.0, "pnl_pct": None, "delta": 0.0, "theta": 0.0,
                         "label": f"{'Long' if sign > 0 else 'Short'} {qty:g} × {exp_short} {float(p.get('strike') or 0):g} {kind.title()}"})
            notes.append(f"Live price unavailable for position #{i + 1} — shown at cost; retrying shortly")
            continue
        notes += n
        c = resolved[0]
        mark = c["mid"]
        iv = (c.get("iv") or fallback_iv or 40) / 100
        T = max(c["dte"], 0.5) / 365
        delta = bs_delta(spot, c["strike"], T, iv, kind)
        theta = bs_theta(spot, c["strike"], T, iv, kind)
        mv = sign * qty * 100 * mark
        basis = sign * qty * 100 * cost
        exp_short = date.fromisoformat(c["expiration"]).strftime("%b %d '%y")
        rows.append({
            "index": i, "kind": "option", "side": side, "qty": qty, "type": kind, "strike": c["strike"],
            "expiration": c["expiration"], "dte": c["dte"], "cost": r2(cost), "mark": r2(mark), "bid": c["bid"], "ask": c["ask"],
            "iv": c.get("iv"), "market_value": r2(mv), "cost_basis": r2(basis), "pnl": r2(mv - basis),
            "pnl_pct": r2((mark / cost - 1) * 100 * sign) if cost else None,
            "delta": r2(sign * qty * 100 * delta), "theta": r2(sign * qty * 100 * theta),
            "moneyness": ("ITM" if (spot > c["strike"]) == (kind == "call") else "OTM") if abs(spot / c["strike"] - 1) > 0.005 else "ATM",
            "label": f"{'Long' if sign > 0 else 'Short'} {qty:g} × {exp_short} {c['strike']:g} {kind.title()}",
        })
        legs.append({**c, "qty": qty, "entry": cost})

    total = {k: r2(sum(r[k] for r in rows)) for k in ("market_value", "cost_basis", "pnl", "delta", "theta")}
    total["pnl_pct"] = r2(total["pnl"] / abs(total["cost_basis"]) * 100) if total["cost_basis"] else None
    payoff = strategy_metrics(legs, spot, fallback_iv) if any(l["type"] != "stock" for l in legs) else None
    return {"spot": r2(spot), "rows": rows, "total": total, "payoff": payoff, "notes": notes}
