/* ================================================================ i18n
 * English UI strings are the keys; anything without a translation falls back to English.
 *  - t("in {n} days", { n: 3 }) for strings built in code.
 *  - Text nodes and title / placeholder / aria-label attributes whose whole (trimmed) text is a key are
 *    translated automatically, including content rendered later (a MutationObserver watches the page).
 * Market data (company names, news, filings text) and AI output are left alone; the AI is asked to
 * write in the chosen language instead (see `lang` in the AI requests).
 */
const LANGS = { en: "English", "zh-Hant": "繁體中文" };
const LANG = (() => {
  try { const s = localStorage.getItem("mp.lang"); if (s && LANGS[JSON.parse(s)]) return JSON.parse(s); } catch {}
  return /^zh/i.test(navigator.language || "") ? "zh-Hant" : "en";
})();
const LOCALE = LANG === "zh-Hant" ? "zh-TW" : "en-US";
document.documentElement.lang = LANG === "zh-Hant" ? "zh-Hant" : "en";

function setLang(lang) {
  try { localStorage.setItem("mp.lang", JSON.stringify(lang)); } catch {}
  location.reload(); // every view re-renders in the new language
}

const I18N = {
  "zh-Hant": {
    // ---- shell / top bar
    "Watchlist": "自選清單", "Recently viewed": "最近瀏覽", "Search stocks, ETFs…": "搜尋股票、ETF…",
    "Sign in": "登入", "Toggle theme": "切換主題", "Back to top": "回到頂部", "Language": "語言",
    "Drag to reorder": "拖曳以排序", "⇅ drag to reorder": "⇅ 拖曳排序",
    "Collapse watchlist": "收合自選清單", "Expand watchlist": "展開自選清單",
    "Data via OpenBB Platform · yfinance & SEC. Quotes may be delayed. Not investment advice.":
      "資料來源：OpenBB Platform · yfinance 與 SEC。報價可能延遲，非投資建議。",
    "Market closed": "已收盤", "Pre-market": "盤前", "After hours": "盤後", "Market open · closes in {h}h {m}m": "開盤中 · {h} 小時 {m} 分後收盤",
    "Your watchlist is empty. Open a stock and tap": "自選清單是空的。打開一檔股票並點擊", "☆ Watch": "☆ 加入自選",
    "to track it here.": "即可在此追蹤。", "Remove": "移除", "Nothing yet": "尚無紀錄",
    "{sym} added to watchlist": "已將 {sym} 加入自選", "{sym} removed from watchlist": "已將 {sym} 移出自選",
    "Up next": "即將發布", "Calendar →": "行事曆 →", "{sym} earnings": "{sym} 財報",
    "before open": "開盤前", "after close": "收盤後", "time TBA": "時間未定",
    "PM": "盤前", "AH": "盤後",

    // ---- home
    "Markets": "市場", "← Markets": "← 市場", "Market Calendar": "市場行事曆",
    "US releases & earnings · next 7 days · times ET": "美國經濟數據與財報 · 未來 7 天 · 美東時間",
    "Critical": "關鍵", "Major + critical": "重要＋關鍵", "Economy": "經濟", "Earnings": "財報", "Recent": "近期",
    "Released US data · last 7 days · times ET": "已公布美國經濟數據 · 過去 7 天 · 美東時間",
    "Above consensus": "高於預期", "Below consensus": "低於預期", "In line": "符合預期",
    "No critical US releases in the last 7 days.": "過去 7 天沒有關鍵的美國經濟數據。",
    "No major US releases in the last 7 days.": "過去 7 天沒有重要的美國經濟數據。",
    "Top Stories": "頭條新聞", "All": "全部", "S&P 500": "標普 500", "Nasdaq": "那斯達克", "Dow": "道瓊", "Russell": "羅素",
    "Nasdaq 100": "那斯達克 100", "Dow Jones": "道瓊工業", "Russell 2000": "羅素 2000", "Volatility": "波動率指數",
    "Movers": "熱門異動", "Gainers": "漲幅榜", "Losers": "跌幅榜", "Active": "成交熱門", "No data.": "無資料。",
    "No recent news.": "近期沒有新聞。", "Try again": "再試一次", "Retry": "重試",
    "Couldn't load news right now — the data source is busy.": "目前無法載入新聞——資料來源忙碌中。",
    "Calendar unavailable right now.": "行事曆暫時無法使用。",
    "Today": "今天", "Tomorrow": "明天", "now": "現在",
    "{d}d {h}h": "{d}天 {h}小時", "{h}h {m}m": "{h}小時 {m}分", "{m}m": "{m}分",
    "{n}m ago": "{n} 分鐘前", "{n}h ago": "{n} 小時前", "{n}d ago": "{n} 天前",
    "Next critical: {ev}": "下一個關鍵數據：{ev}", "to release": "後公布", "Consensus {v}": "預期 {v}", "Prev {v}": "前值 {v}",
    "{n} event": "{n} 項", "{n} events": "{n} 項", "{n} report": "{n} 家", "{n} reports": "{n} 家",
    "CRITICAL": "關鍵", "MAJOR": "重要", "Actual": "實際", "Cons.": "預期", "Prev.": "前值",
    "No critical US releases in the next 7 days.": "未來 7 天沒有關鍵的美國經濟數據。",
    "No major US releases in the next 7 days.": "未來 7 天沒有重要的美國經濟數據。",
    "☀ Before open": "☀ 開盤前", "☾ After close": "☾ 收盤後", "Time TBA": "時間未定",
    "On your watchlist": "在你的自選清單中", "EPS est.": "EPS 預估", "Mkt cap": "市值",
    "No major earnings (≥ $50B) or watchlist reports in the next 7 days.": "未來 7 天沒有大型（市值 ≥ 500 億美元）或自選股的財報。",

    // ---- quote card
    "Watch": "加入自選", "Watching": "已自選", "Connecting": "連線中", "Live": "即時", "Streaming": "串流中",
    "Reconnecting": "重新連線中", "At last close": "以最後收盤價", "Updated {time}": "更新於 {time}",
    "Earnings {when} · {date}": "財報 {when} · {date}", "today": "今天", "tomorrow": "明天", "in {n} days": "{n} 天後",
    "before the open": "開盤前", "after the close": "收盤後", "EPS est. {v}": "EPS 預估 {v}",
    "Couldn't load a quote for “{sym}” — the data source may be busy, or the ticker may not exist.":
      "無法載入「{sym}」的報價——資料來源可能忙碌中，或代號不存在。",

    // ---- chart
    "Bar interval": "K 線週期", "Ext hrs": "盤前盤後", "Levels": "價位線",
    "Include pre-market (4:00–9:30) and after-hours (16:00–20:00 ET) trading on 1D / 5D": "在 1D / 5D 圖表中包含盤前（4:00–9:30）與盤後（16:00–20:00 美東）交易",
    "Show support / resistance and trade plan levels": "顯示支撐／壓力與交易計畫價位",
    "Line": "折線", "Candles": "K 線", "Hollow candles": "空心 K 線",
    "Expand chart to the full page": "將圖表展開至整頁", "Exit expanded chart (Esc)": "離開展開圖表（Esc）",
    "past 5 days": "近 5 天", "past month": "近 1 個月", "past 6 months": "近 6 個月", "past year": "近 1 年", "past 5 years": "近 5 年",
    "No chart data": "沒有圖表資料", "Prev close": "前收盤", "Avg cost": "平均成本", "My stop": "我的停損", "My target": "我的目標",
    "Entry": "進場", "Stop": "停損", "Vol": "量",

    // ---- trade opportunities / signals
    "Trade Opportunities": "交易機會", "AI stock setups & option strategies, priced from the real chain": "AI 股票操作與選擇權策略，依實際報價計算",
    "AI model — change in Settings": "AI 模型——可在設定中變更", "AI model": "AI 模型", "Generate ideas": "產生建議", "Generating…": "產生中…",
    "Regenerate": "重新產生", "Risk profile": "風險偏好", "Conservative": "保守", "Moderate": "穩健", "Aggressive": "積極",
    "Defined-risk only — credit/debit spreads, covered calls, cash-secured puts. Higher win-rate, smaller payoff.":
      "僅限有限風險——信用／借方價差、掩護性買權、現金擔保賣權。勝率較高，報酬較小。",
    "Balanced reward/risk — debit spreads and long options around 0.30–0.60 delta, sensible stops.":
      "報酬與風險平衡——借方價差與 Delta 約 0.30–0.60 的買進選擇權，設定合理停損。",
    "Directional conviction — lower-delta long options, shorter expirations. Bigger payoff, lower win-rate.":
      "方向性押注——較低 Delta 的買進選擇權、較短到期日。報酬較大，勝率較低。",
    "Live signals": "即時訊號", "computed locally · no AI": "本地計算 · 非 AI",
    "⚠︎ AI-generated for education and research — not investment advice or a recommendation to buy or sell. Options carry substantial risk and can lose 100% of premium (or more for short options). Prices are delayed mid-quotes; verify with your broker before trading.":
      "⚠︎ 由 AI 產生，僅供教育與研究——並非投資建議或買賣推薦。選擇權風險高，可能損失 100% 權利金（賣方甚至更多）。價格為延遲中間價，交易前請向券商確認。",
    "The live signals below are computed locally and always available.": "下方即時訊號於本地計算，隨時可用。",
    "No {risk} ideas for {sym} yet — click {btn} (~1 min, under $0.01).": "{sym} 尚無{risk}建議——點擊{btn}（約 1 分鐘，費用低於 $0.01）。",
    "Saved:": "已儲存：", "{risk} ideas for {sym} are ready": "{sym} 的{risk}建議已完成", "Trade ideas failed: {msg}": "交易建議失敗：{msg}",
    "Pull quote, technicals & option chain (OpenBB)": "取得報價、技術指標與選擇權鏈（OpenBB）",
    "AI drafts stock setup & option strategies": "AI 擬定股票操作與選擇權策略",
    "Validate contracts against live chain · compute payoffs & POP": "以即時選擇權鏈驗證合約 · 計算損益與獲利機率",
    "Signals unavailable for {sym} ({msg}).": "{sym} 的訊號暫時無法取得（{msg}）。",
    "Trend": "趨勢", "Strong uptrend": "強勢上升", "Uptrend": "上升趨勢", "Strong downtrend": "強勢下跌", "Downtrend": "下跌趨勢", "Mixed / range": "盤整／區間",
    "Overbought": "超買", "Oversold": "超賣", "Bullish momentum": "多方動能", "Bearish momentum": "空方動能", "Neutral": "中性",
    "bullish": "多方", "bearish": "空方", "MACD {m} · signal {s}": "MACD {m} · 訊號線 {s}",
    "{atr}% daily range · vol {v}× avg": "日波動 {atr}% · 成交量為均量 {v} 倍",
    "Key levels": "關鍵價位", "20-day {a} – {b} · 52-week {c} – {d}": "20 日 {a} – {b} · 52 週 {c} – {d}",
    "Expected move (options)": "預期波動（選擇權）", "No listed options": "無上市選擇權",
    "By {date} · range {lo} – {hi}": "至 {date} · 區間 {lo} – {hi}", "Options-implied 1σ range vs 52-week range": "選擇權隱含 1σ 區間 vs 52 週區間",
    "IV vs HV": "隱含 vs 歷史波動率", "30d implied / 20d realized": "30 日隱含 / 20 日實現",
    "Options expensive vs realized": "選擇權相對實現波動偏貴", "Options cheap vs realized": "選擇權相對實現波動偏便宜", "Options fairly priced vs realized": "選擇權定價合理",
    "Put / Call OI": "賣權／買權未平倉比", "Put-heavy (hedging)": "賣權偏多（避險）", "Call-heavy": "買權偏多", "vol P/C {v}": "成交量 P/C {v}",
    "Largest open interest": "最大未平倉", "Big OI strikes often act as magnets / walls near expiration.": "大量未平倉的履約價在到期前常形成磁吸或壓力牆。",
    "Momentum": "動能", "Close vs 20D high: {v}": "收盤價 vs 20 日高點：{v}",

    // ---- options chain
    "Options": "選擇權", "Chain by expiration · delayed quotes": "依到期日的選擇權鏈 · 延遲報價",
    "Chain by expiration · {src}": "依到期日的選擇權鏈 · {src}", "delayed mid-quotes": "延遲中間價", "last trade prices (market closed)": "最後成交價（已收盤）",
    "Expiration": "到期日", "Strikes around spot": "現價附近履約價", "Strikes shown above / below the current price": "顯示現價上下的履約價數量",
    "±10 strikes": "±10 檔履約價", "±25 strikes": "±25 檔履約價", "±50 strikes": "±50 檔履約價", "All strikes": "全部履約價",
    "Both": "全部", "Calls": "買權", "Puts": "賣權", "Call": "買權", "Put": "賣權",
    "ATM IV": "價平 IV", "Expected move": "預期波動", "Max pain": "最大痛點", "Days to exp.": "距到期天數",
    "Call OI": "買權未平倉", "Put OI": "賣權未平倉", "P/C OI": "P/C 未平倉", "P/C volume": "P/C 成交量",
    "Bid": "買價", "Ask": "賣價", "Mid": "中間價", "OI": "未平倉", "Strike": "履約價", "Spot {px}": "現價 {px}",
    "Last trade (no live quote)": "最後成交價（無即時報價）",
    "Shaded cells are in the money.": "陰影格為價內。", "* priced from last trade — no live bid/ask outside market hours.": "* 以最後成交價計——非交易時段沒有即時買賣價。",
    "Δ is Black-Scholes delta from the contract's IV.": "Δ 為依合約 IV 以 Black-Scholes 計算的 Delta。",
    "Options unavailable for {sym} ({msg}).": "{sym} 的選擇權暫時無法取得（{msg}）。", "No listed options for {sym}.": "{sym} 沒有上市選擇權。",
    "Biggest flow": "最大資金流向", "all expirations · strikes within ±30% · by premium traded (vol × price × 100)": "全部到期日 · 現價 ±30% 內履約價 · 依成交權利金（量 × 價 × 100）",
    "last session": "上一交易時段", "unusual": "異常", "{v} vol": "量 {v}",

    // ---- positions
    "My Position": "我的持倉", "Track your shares & options with live P/L and greeks, then ask AI to review · saved only in this browser":
      "追蹤股票與選擇權的即時損益與 Greeks，並請 AI 檢視 · 僅儲存在此瀏覽器",
    "+ Add position": "+ 新增持倉", "Close": "關閉", "Shares": "股數", "Option": "選擇權", "Side": "方向", "Long": "做多", "Short": "做空",
    "Type": "類型", "Contracts": "口數", "Avg cost / share": "每股平均成本", "Premium / share": "每股權利金", "Use current": "使用現價",
    "Cancel": "取消", "Add": "新增", "Loading…": "載入中…", "Options unavailable": "選擇權暫時無法取得",
    "Current price: {px}": "現價：{px}", "Current mid": "目前中間價", "{src}: {px} ({c} per contract)": "{src}：{px}（每口 {c}）",
    "No trades yet for this contract — enter your cost": "此合約尚無成交——請輸入你的成本",
    "Enter a quantity and cost.": "請輸入數量與成本。", "Pick an expiration and strike.": "請選擇到期日與履約價。", "Position added": "已新增持倉",
    "No position in {sym}": "沒有 {sym} 的持倉",
    "Use {btn} to enter the shares or option contracts you hold — you'll see live P/L, greeks and a combined payoff, and can ask AI to review it.":
      "使用{btn}輸入你持有的股票或選擇權——即可看到即時損益、Greeks 與組合損益圖，並可請 AI 檢視。",
    "price unavailable": "無法取得價格", "now {px}": "現價 {px}", "per share": "每股", "{c}/contract": "{c}/口",
    "LONG": "做多", "SHORT": "做空", "Market value": "市值", "cost {c}": "成本 {c}", "Unrealized P/L": "未實現損益",
    "Net delta": "淨 Delta", "sh": "股", "Theta / day": "每日 Theta", "Position": "持倉", "Unit cost": "單位成本", "Value": "價值", "P/L": "損益", "Θ/day": "Θ/日",
    "Share-equivalent exposure: P/L change per $1 move in the stock": "等值股數曝險：股價每變動 $1 的損益變化",
    "Estimated P/L from one day of time decay": "一天時間價值遞減的預估損益",
    "Average cost per share (options: premium per share, ×100 per contract)": "每股平均成本（選擇權：每股權利金，每口 ×100）",
    "Combined payoff at {date}": "{date} 的組合損益",
    "Breakeven {be} · Max profit {mp} · Max loss {ml} · P(profit) {pop}%": "損益兩平 {be} · 最大獲利 {mp} · 最大虧損 {ml} · 獲利機率 {pop}%",
    "unlimited": "無上限", "AI position review": "AI 持倉檢視", "Review my position": "檢視我的持倉", "Review again": "重新檢視", "Reviewing…": "檢視中…",
    "Optional question — e.g. “Should I roll my calls out to November?” or “Earnings are next week, how do I protect gains?”":
      "選填問題——例如「我應該把買權展延到 11 月嗎？」或「下週公布財報，怎麼保護獲利？」",
    "Mark positions to market & pull signals": "以市價評估持倉並取得訊號", "AI reviews thesis, risk & exits": "AI 檢視論點、風險與出場",
    "Price suggested adjustments on the live chain": "以即時選擇權鏈為建議調整定價",
    "⚠︎ Your positions changed since this review — run it again for an up-to-date view.": "⚠︎ 你的持倉在這次檢視後有變動——請重新檢視以取得最新結果。",
    "Exit plan": "出場計畫", "Stop loss": "停損", "Take profit": "停利", "Watch levels": "觀察價位", "Risk flags": "風險提示", "Suggested adjustments": "建議調整",
    "{p} from ref": "距參考價 {p}", "Review failed: {msg}": "檢視失敗：{msg}", "health": "健康度", "confidence": "信心度",
    "hold": "續抱", "add": "加碼", "take profit": "停利", "trim": "減碼", "roll": "展延", "hedge": "避險", "cut loss": "停損", "close": "平倉",
    "Couldn't price positions — {msg}": "無法評估持倉價格——{msg}",

    // ---- trade idea cards
    "Stock setup": "股票操作", "Option strategies": "選擇權策略", "Catalysts & risks": "催化劑與風險", "CATALYSTS": "催化劑", "RISKS": "風險",
    "▲ LONG": "▲ 做多", "▼ SHORT": "▼ 做空", "NO TRADE": "不交易", "No clean stock setup right now": "目前沒有明確的股票操作機會",
    "Limit entry · wait for zone": "限價進場 · 等待進場區", "Entry zone": "進場區", "Target {n}": "目標 {n}", "{p} vs now": "相對現價 {p}",
    "risk {r}/sh": "每股風險 {r}", "Rationale": "理由", "Invalidation": "失效條件",
    "⚠︎ Levels look inconsistent with the direction — double-check before using.": "⚠︎ 價位與方向似乎不一致——使用前請再次確認。",
    "{r} risk": "{r}風險", "conservative": "保守", "moderate": "穩健", "aggressive": "積極",
    "Net debit": "淨支出", "Net credit": "淨收入", "Max profit": "最大獲利", "Max loss": "最大虧損", "Breakeven": "損益兩平",
    "Prob. profit": "獲利機率", "Reward / risk": "報酬／風險", "Unlimited": "無上限", "Open": "開盤",
    "Qty": "數量", "Contract": "合約", "BUY": "買進", "SELL": "賣出", "Why this trade · management · risks": "交易理由 · 管理方式 · 風險",
    "Why:": "理由：", "Manage:": "管理：", "Risk:": "風險：", "At expiry · spot {px}": "到期時 · 現價 {px}",
    "thinking… {n}k chars": "思考中… {n}k 字", "writing {n} chars": "撰寫中 {n} 字",

    // ---- AI analysis
    "AI Analysis": "AI 分析", "News, technicals & fundamentals synthesized by an LLM via OpenRouter": "透過 OpenRouter 由大型語言模型綜合新聞、技術面與基本面",
    "Analyze": "分析", "Ask a follow-up question…": "繼續追問…（Enter 送出，Shift+Enter 換行）", "Ask": "提問", "Thinking…": "思考中…", "Analyzing…": "分析中…", "Answering…": "回答中…", "Copy": "複製", "Analysis copied": "已複製分析",
    "Optional question — e.g. “Earnings beat big but the stock didn’t rise after hours — why?” or “財報開很好，但盤後沒有漲，為什麼？”":
      "選填問題——例如「財報開很好，但盤後沒有漲，為什麼？」",
    "Live quote": "即時報價", "Price, volume, moving averages, 52-week range": "價格、成交量、均線、52 週區間",
    "Fundamentals": "基本面", "Valuation multiples, growth, margins, leverage": "估值倍數、成長、利潤率、槓桿",
    "Performance": "績效", "1W · 1M · 3M · 6M · 1Y returns": "1 週 · 1 月 · 3 月 · 6 月 · 1 年報酬",
    "Headlines": "新聞標題", "{n} latest news stories on {sym}": "{sym} 最新 {n} 則新聞",
    "Click {btn} for a structured research note on {sym} — typically under $0.001 per run.": "點擊{btn}取得 {sym} 的結構化研究報告——每次通常低於 $0.001。",
    "Gathering OpenBB data and analyzing…": "正在蒐集 OpenBB 資料並分析…", "AI analysis failed: {msg}": "AI 分析失敗：{msg}",
    "Bullish": "看多", "Bearish": "看空",
    "AI {what} needs the server's Supabase settings (see README).": "AI {what}需要伺服器的 Supabase 設定（請見 README）。",
    "Sign in and add your own OpenRouter API key to use AI {what}.": "登入並加入你自己的 OpenRouter API 金鑰即可使用 AI {what}。",
    "Add your OpenRouter API key to use AI {what}.": "加入你的 OpenRouter API 金鑰即可使用 AI {what}。", "Add API key": "加入 API 金鑰",
    "analysis": "分析", "trade ideas": "交易建議", "market brief": "市場摘要",
    "AI Market Brief": "AI 市場摘要", "Today's highlights from indexes, movers, the calendar, earnings and headlines": "綜合指數、異動股、行事曆、財報與新聞的今日重點",
    "Generate brief": "產生摘要", "Refresh": "重新整理", "As of {time}": "截至 {time}", "Reading today's market…": "正在讀取今日市場…",
    "Click {btn} for a summary of today's market — indexes, movers, economic data, earnings and headlines, plus your watchlist.":
      "點擊{btn}取得今日市場摘要——指數、異動股、經濟數據、財報與新聞，以及你的自選股。",
    "Market brief failed: {msg}": "市場摘要失敗：{msg}", "Add your OpenRouter API key to use AI features.": "請加入你的 OpenRouter API 金鑰以使用 AI 功能。",

    // ---- key stats / about
    "Key Statistics": "關鍵數據", "Day range": "當日區間", "52-week range": "52 週區間",
    "Volume": "成交量", "Avg volume": "平均成交量", "50-day MA": "50 日均線", "200-day MA": "200 日均線",
    "Market cap": "市值", "P/E (TTM)": "本益比 (TTM)", "Forward P/E": "預估本益比", "Price / book": "股價淨值比",
    "Revenue growth": "營收成長", "Earnings growth": "盈餘成長", "Gross margin": "毛利率", "Operating margin": "營業利益率", "Net margin": "淨利率",
    "Debt / equity": "負債權益比", "Dividend yield": "殖利率", "1Y return": "1 年報酬",
    // Yahoo's 11 sectors (industries are too many to list; they stay in English)
    "Technology": "科技", "Communication Services": "通訊服務", "Consumer Cyclical": "非必需消費品", "Consumer Defensive": "必需消費品",
    "Financial Services": "金融服務", "Healthcare": "醫療保健", "Industrials": "工業", "Energy": "能源", "Utilities": "公用事業",
    "Real Estate": "房地產", "Basic Materials": "原物料",
    "About": "公司簡介", "Sector": "產業", "Industry": "行業", "Employees": "員工人數", "Headquarters": "總部", "Show more": "顯示更多", "Show less": "收起",

    // ---- events
    "Events": "事件", "Earnings · dividends · filings": "財報 · 股利 · 申報文件", "Next earnings": "下次財報",
    "After close": "收盤後", "Before open": "開盤前", "EPS est": "EPS 預估", "Rev est": "營收預估",
    "Earnings history": "歷史財報", "EPS vs est": "EPS vs 預估", "EPS / est": "EPS / 預估", "Reported EPS / estimate": "實際 EPS / 預估", "Surprise": "驚喜", "Day": "當日", "Next": "隔日",
    "reaction to the report": "財報反應", "Stock move on the report date": "財報公布當日的股價變動",
    "Stock move on the session after the report date": "財報公布隔日的股價變動",
    "☾ after close · ☀ before open · bold = the session that reacted to the report": "☾ 收盤後公布 · ☀ 開盤前公布 · 粗體＝反應財報的交易時段", "EPS vs est · surprise · next day": "EPS vs 預估 · 驚喜 · 隔日", "vs": "vs",
    "Beat the EPS estimate": "優於 EPS 預估", "Missed the EPS estimate": "低於 EPS 預估", "Beat": "優於", "Miss": "低於",
    "Stock move on the first session after the report": "財報公布後第一個交易時段的股價變動",
    "Dividend": "股利", "annual": "年配", "semi-annual": "半年配", "quarterly": "季配", "monthly": "月配", "Raised": "已調升",
    "{a}/yr": "每年 {a}", "{y}% yield": "殖利率 {y}%", "Upcoming ex-div": "即將除息", "Last ex-div": "最近除息", "paid {date}": "{date} 發放",
    "SEC filings": "SEC 申報", "Last split:": "最近分割：", "on {date}": "於 {date}",
    "Annual report": "年報", "Quarterly report": "季報", "Current report": "重大事件報告", "Annual report (amended)": "年報（修正）",
    "Quarterly report (amended)": "季報（修正）", "Proxy statement": "股東會委託書", "Registration": "註冊申報", "Shelf registration": "擱置註冊",
    "Earnings release": "財報發布", "Material agreement": "重大協議", "Acquisition / disposal": "收購／處分", "Executive / board change": "高層／董事會異動",
    "Shareholder vote": "股東投票", "Reg FD disclosure": "Reg FD 揭露", "Other event": "其他事件", "Agreement terminated": "協議終止",
    "New debt obligation": "新增債務", "Unregistered equity sale": "未註冊股權出售",

    // ---- news / search
    "News": "新聞", "{sym} News": "{sym} 新聞", "No news found for {sym}.": "找不到 {sym} 的新聞。",
    "Search": "搜尋", "Search by company or ticker…": "輸入公司名稱或代號…", "Recent": "最近", "Popular": "熱門", "Results": "結果",
    "Open ticker directly": "直接開啟代號", "No matches for “{q}”.": "找不到「{q}」。", "Searching “{q}”…": "搜尋「{q}」中…",
    "navigate": "移動", "open": "開啟", "or": "或", "to search": "搜尋",

    // ---- account / settings
    "Sign in to Maru Pulse": "登入 Maru Pulse",
    "Sync your watchlist, positions and settings across devices, and use AI with your own OpenRouter key.": "在不同裝置同步自選清單、持倉與設定，並以你自己的 OpenRouter 金鑰使用 AI。",
    "Continue with Google": "使用 Google 繼續", "We only receive your name, email and profile picture from Google.": "我們只會從 Google 取得你的姓名、電子郵件與大頭貼。",
    "Settings": "設定", "Account": "帳號", "Sign out": "登出", "OpenRouter API key": "OpenRouter API 金鑰", "Get a key ↗": "取得金鑰 ↗",
    "Verify & save": "驗證並儲存", "Verifying…": "驗證中…", "Saving…": "儲存中…",
    "Your key is checked with OpenRouter, then stored encrypted in Supabase Vault. It is never shown again or sent back to the browser — only this app's server decrypts it to run your AI requests, billed to your OpenRouter account.":
      "你的金鑰會先經 OpenRouter 驗證，再加密存放於 Supabase Vault。之後不會再顯示或傳回瀏覽器——只有本服務的伺服器會解密以執行你的 AI 請求，費用計入你的 OpenRouter 帳戶。",
    "Preferences": "偏好設定", "Default AI model": "預設 AI 模型", "Theme": "主題", "Dark": "深色", "Light": "淺色",
    "Deep think by default": "預設啟用深度思考", "Show extended-hours trading on charts": "在圖表顯示盤前盤後交易",
    "Show support / resistance levels on charts": "在圖表顯示支撐／壓力價位", "USD per 1M tokens (input / output)": "每百萬 token 美元價格（輸入／輸出）",
    "✓ Key saved": "✓ 金鑰已儲存", "updated {ago}": "更新於 {ago}", "No key saved": "尚未儲存金鑰",
    "AI analysis, trade ideas and position reviews are off until you add one.": "加入金鑰前，AI 分析、交易建議與持倉檢視皆無法使用。",
    "Paste a new key to replace it": "貼上新金鑰以取代", "OpenRouter key verified and saved": "OpenRouter 金鑰已驗證並儲存", "Key removed": "金鑰已移除",
    "Signed out": "已登出", "Signed in as {name}": "已登入：{name}", "Couldn't sync": "同步失敗", "Synced to your account": "已同步至你的帳號",
    "Sign in with Google": "使用 Google 登入", "{name} — Settings": "{name}——設定",
    "{email} · Google account · data syncs across devices": "{email} · Google 帳號 · 資料跨裝置同步",
    "Remove your saved OpenRouter key? AI features will be off until you add one again.": "要移除已儲存的 OpenRouter 金鑰嗎？移除後 AI 功能將無法使用，直到再次加入。",
    "Sign-in isn't configured on this server.": "此伺服器未設定登入功能。",
  },
};
const DICT = I18N[LANG] || {};

function t(s, vars) {
  let out = DICT[s] ?? s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

// Translate whole-text matches under `root`. Leading/trailing whitespace is kept so inline text still spaces correctly.
const I18N_ATTRS = ["title", "placeholder", "aria-label"];
const I18N_SKIP = "script, style, .ai-output, .news, .news-feature, .ev-title-raw, [data-no-i18n]";
function localizeText(node) {
  const raw = node.nodeValue, key = raw.trim();
  if (!key || !(key in DICT)) return;
  const p = node.parentElement;
  if (p && p.closest(I18N_SKIP)) return;
  node.nodeValue = raw.replace(key, DICT[key]);
}
function localizeEl(el) {
  for (const a of I18N_ATTRS) {
    const v = el.getAttribute(a);
    if (v && v.trim() in DICT) el.setAttribute(a, DICT[v.trim()]);
  }
}
function localize(root) {
  if (LANG === "en" || !root) return;
  if (root.nodeType === Node.TEXT_NODE) return localizeText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.closest(I18N_SKIP)) return;
  localizeEl(root);
  root.querySelectorAll("[title], [placeholder], [aria-label]").forEach(localizeEl);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) localizeText(n);
}

if (LANG !== "en") {
  const start = () => {
    localize(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "attributes") localizeEl(m.target);
        else if (m.type === "characterData") localizeText(m.target);
        else m.addedNodes.forEach(localize);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
}
