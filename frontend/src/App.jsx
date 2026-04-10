import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─────────────────────────────────────────────
// VIBRATION UTILITY
// ─────────────────────────────────────────────
const vibrate = (pattern) => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};
const vibrateShort = () => vibrate(50);
const vibrateMedium = () => vibrate([80, 30, 80]);
const vibrateAlert = () => vibrate([200, 100, 200, 100, 400]);
const vibrateSuccess = () => vibrate([30, 20, 30, 20, 120]);
const vibrateError = () => vibrate([300, 100, 300]);

// ─────────────────────────────────────────────
// MARKET ENGINE
// ─────────────────────────────────────────────
class MarketEngine {
  constructor() {
    this.subscribers = {};
    this.intervalId = null;
    this.epoch = 0;
  }
  subscribe(event, cb) {
    if (!this.subscribers[event]) this.subscribers[event] = [];
    this.subscribers[event].push(cb);
    return () => { this.subscribers[event] = this.subscribers[event].filter(x => x !== cb); };
  }
  emit(event, data) { (this.subscribers[event] || []).forEach(cb => cb(data)); }
  start(stocks, setStocks, onTick) {
    this.intervalId = setInterval(() => {
      this.epoch++;
      const updated = stocks.map(s => this._tick(s));
      setStocks(updated);
      if (onTick) onTick(updated, this.epoch);
    }, 1200);
  }
  stop() { clearInterval(this.intervalId); }
  _tick(s) {
    const vol = s.volatility || 0.015;
    const r = (Math.random() - 0.48) * vol * s.price + (s.drift || 0);
    const newPrice = Math.max(1, parseFloat((s.price + r).toFixed(2)));
    const newHistory = [...s.history.slice(1), newPrice];
    const rsi = this._rsi(newHistory);
    const { macd, signal } = this._macd(newHistory);
    const bb = this._bollinger(newHistory);
    const atr = this._atr(newHistory);
    const vwap = this._vwap(newHistory, s.volumeHistory || []);
    const momentum = this._momentum(newHistory, 10);
    const stochK = this._stochastic(newHistory);
    const vol24h = Math.floor(500000 + Math.random() * 5000000);
    const newVolumeHistory = [...(s.volumeHistory || []).slice(1), vol24h];
    const aiSignal = this._aiSignal({ rsi, macd, signal, bb, momentum, stochK, price: newPrice });
    return {
      ...s, prev: s.price, price: newPrice, history: newHistory, volumeHistory: newVolumeHistory,
      rsi: parseFloat(rsi.toFixed(1)), macd: parseFloat(macd.toFixed(3)), macdSignal: parseFloat(signal.toFixed(3)),
      macdHist: parseFloat((macd - signal).toFixed(3)), bb, atr: parseFloat(atr.toFixed(2)),
      vwap: parseFloat(vwap.toFixed(2)), momentum: parseFloat(momentum.toFixed(2)), stochK: parseFloat(stochK.toFixed(1)),
      aiAction: aiSignal.action, aiConfidence: aiSignal.confidence, aiReason: aiSignal.reason, aiScore: aiSignal.score,
      dayHigh: Math.max(s.dayHigh || s.price, newPrice), dayLow: Math.min(s.dayLow || s.price, newPrice),
      volume24h: vol24h, marketCap: parseFloat(((newPrice * (s.shares || 1e9)) / 1e9).toFixed(1)),
    };
  }
  _rsi(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    return 100 - 100 / (1 + gains / (losses || 0.001));
  }
  _macd(prices) {
    const ema = (arr, n) => { const k = 2 / (n + 1); return arr.reduce((p, c) => c * k + p * (1 - k), arr[0]); };
    if (prices.length < 26) return { macd: 0, signal: 0 };
    const macd = ema(prices.slice(-12), 12) - ema(prices.slice(-26), 26);
    return { macd, signal: ema([macd], 9) };
  }
  _bollinger(prices, period = 20) {
    if (prices.length < period) return { upper: prices[prices.length - 1], lower: prices[prices.length - 1], mid: prices[prices.length - 1] };
    const slice = prices.slice(-period);
    const mid = slice.reduce((a, b) => a + b) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
    return { upper: parseFloat((mid + 2 * std).toFixed(2)), lower: parseFloat((mid - 2 * std).toFixed(2)), mid: parseFloat(mid.toFixed(2)) };
  }
  _atr(prices, period = 14) {
    if (prices.length < 2) return 0;
    const trs = prices.slice(-period).map((p, i, arr) => i === 0 ? 0 : Math.abs(p - arr[i - 1]));
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }
  _vwap(prices, volumes) {
    if (!volumes.length) return prices[prices.length - 1];
    const n = Math.min(prices.length, volumes.length, 10);
    const pv = prices.slice(-n).reduce((acc, p, i) => acc + p * (volumes.slice(-n)[i] || 1), 0);
    return pv / (volumes.slice(-n).reduce((a, b) => a + b, 0) || 1);
  }
  _momentum(prices, n) { return prices.length < n + 1 ? 0 : prices[prices.length - 1] - prices[prices.length - 1 - n]; }
  _stochastic(prices, period = 14) {
    if (prices.length < period) return 50;
    const slice = prices.slice(-period);
    const low = Math.min(...slice), high = Math.max(...slice);
    return high === low ? 50 : ((prices[prices.length - 1] - low) / (high - low)) * 100;
  }
  _aiSignal({ rsi, macd, signal, bb, momentum, stochK, price }) {
    let score = 0; const reasons = [];
    if (rsi < 30) { score += 25; reasons.push("RSI oversold"); } else if (rsi > 70) { score -= 25; reasons.push("RSI overbought"); }
    if (macd > signal) { score += 20; reasons.push("MACD bullish"); } else { score -= 15; reasons.push("MACD bearish"); }
    if (price < bb.lower) { score += 20; reasons.push("BB lower touch"); } else if (price > bb.upper) { score -= 20; reasons.push("BB upper breach"); }
    if (momentum > 0) { score += 10; reasons.push("Positive momentum"); } else { score -= 10; reasons.push("Negative momentum"); }
    if (stochK < 20) { score += 15; reasons.push("Stoch oversold"); } else if (stochK > 80) { score -= 15; reasons.push("Stoch overbought"); }
    score += (Math.random() - 0.5) * 10;
    let action, confidence;
    if (score > 25) { action = "BUY"; confidence = Math.min(99, Math.floor(60 + score)); }
    else if (score < -15) { action = "SELL"; confidence = Math.min(99, Math.floor(55 + Math.abs(score))); }
    else { action = "HOLD"; confidence = Math.floor(55 + Math.abs(score) * 2); }
    return { action, confidence: Math.max(51, Math.min(99, confidence)), reason: reasons.slice(0, 2).join(" + "), score: parseFloat(score.toFixed(1)) };
  }
}
const engine = new MarketEngine();

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const STOCK_UNIVERSE = [
  { symbol: "NVDA", name: "NVIDIA Corp.", base: 875.6, sector: "Semis", drift: 0.04, volatility: 0.022, shares: 2.46e9, beta: 1.72 },
  { symbol: "AAPL", name: "Apple Inc.", base: 189.5, sector: "Tech", drift: 0.01, volatility: 0.012, shares: 15.4e9, beta: 1.21 },
  { symbol: "TSLA", name: "Tesla Inc.", base: 242.3, sector: "EV", drift: 0.02, volatility: 0.03, shares: 3.17e9, beta: 2.05 },
  { symbol: "META", name: "Meta Platforms", base: 505.3, sector: "Social", drift: 0.03, volatility: 0.018, shares: 2.56e9, beta: 1.44 },
  { symbol: "MSFT", name: "Microsoft Corp.", base: 415.8, sector: "Tech", drift: 0.015, volatility: 0.011, shares: 7.43e9, beta: 0.89 },
  { symbol: "GOOGL", name: "Alphabet Inc.", base: 165.2, sector: "Tech", drift: 0.01, volatility: 0.014, shares: 12.7e9, beta: 1.05 },
  { symbol: "AMZN", name: "Amazon.com Inc.", base: 185.4, sector: "E-comm", drift: 0.02, volatility: 0.016, shares: 10.2e9, beta: 1.15 },
  { symbol: "SPY", name: "S&P 500 ETF", base: 510.2, sector: "ETF", drift: 0.008, volatility: 0.009, shares: 0.9e9, beta: 1.0 },
  { symbol: "AMD", name: "Advanced Micro Devices", base: 168.4, sector: "Semis", drift: 0.025, volatility: 0.025, shares: 1.62e9, beta: 1.88 },
  { symbol: "PLTR", name: "Palantir Technologies", base: 22.8, sector: "AI/Data", drift: 0.03, volatility: 0.032, shares: 2.1e9, beta: 2.12 },
];

const LIVE_NEWS = [
  { text: "Fed signals pause in rate hikes as inflation cools to 2.3%", sentiment: "bullish", impact: "macro" },
  { text: "NVDA smashes Q4 earnings — EPS $5.98 vs $4.64 est; raises FY guidance 40%", sentiment: "bullish", impact: "NVDA" },
  { text: "Treasury yields spike to 16-year high at 5.02%", sentiment: "bearish", impact: "macro" },
  { text: "Apple Vision Pro 2 leaks: M4 chip, 60% thinner, pre-orders surge", sentiment: "bullish", impact: "AAPL" },
  { text: "SEC probes crypto exchanges for undisclosed market-maker conflicts", sentiment: "bearish", impact: "macro" },
  { text: "Meta Llama 4 achieves SOTA on MMLU — AI ad revenue +28% YoY", sentiment: "bullish", impact: "META" },
  { text: "Tesla Cybertruck recall for accelerator pedal defect (11,688 units)", sentiment: "bearish", impact: "TSLA" },
  { text: "Jobs report: +187K nonfarm payrolls, unemployment 3.9%", sentiment: "neutral", impact: "macro" },
  { text: "Microsoft Azure growth re-accelerates to 29% as Copilot adoption surges", sentiment: "bullish", impact: "MSFT" },
  { text: "Goldman Sachs: Semis sector stretched — initiates underweight on NVDA", sentiment: "bearish", impact: "NVDA" },
  { text: "Amazon AWS inks $4B federal cloud contract with DoD", sentiment: "bullish", impact: "AMZN" },
  { text: "Palantir wins $480M Army AI contract extension through 2026", sentiment: "bullish", impact: "PLTR" },
  { text: "VIX spikes to 28 as geopolitical tensions escalate — risk-off mood", sentiment: "bearish", impact: "macro" },
];

const MACRO_METRICS = [
  { label: "VIX", value: () => (14 + Math.random() * 18).toFixed(2), color: "#f59e0b" },
  { label: "10Y", value: () => (4.2 + (Math.random() - 0.5) * 0.3).toFixed(3) + "%", color: "#38bdf8" },
  { label: "DXY", value: () => (103 + (Math.random() - 0.5) * 2).toFixed(2), color: "#a78bfa" },
  { label: "GOLD", value: () => "$" + (2350 + (Math.random() - 0.5) * 30).toFixed(0), color: "#fbbf24" },
  { label: "BTC", value: () => "$" + (67000 + (Math.random() - 0.5) * 2000).toFixed(0), color: "#f97316" },
  { label: "OIL", value: () => "$" + (82 + (Math.random() - 0.5) * 4).toFixed(2), color: "#6ee7b7" },
];

const SMART_TIPS = [
  { icon: "💡", category: "RSI Strategy", tip: "RSI below 30 signals oversold — potential reversal zone. RSI above 70 signals overbought. Best combined with MACD confirmation." },
  { icon: "📊", category: "MACD Cross", tip: "When MACD line crosses above Signal line, it's a bullish momentum signal. Below is bearish. The histogram width shows momentum strength." },
  { icon: "🎯", category: "Bollinger Bands", tip: "Price touching lower BB in uptrend = buy opportunity. Touching upper BB in downtrend = sell signal. BB squeeze = volatility explosion incoming." },
  { icon: "⚡", category: "ATR Sizing", tip: "ATR tells you average daily range. Set stop-loss at 1.5x ATR below entry. Higher ATR = wider stops, lower position size." },
  { icon: "🔄", category: "VWAP Trading", tip: "Price above VWAP = bullish intraday bias. Below VWAP = bearish. Institutional traders use VWAP for large order execution." },
  { icon: "📈", category: "Momentum Play", tip: "Positive momentum > 0 means the stock is trending up over 10 periods. Stack momentum + RSI < 60 for high-probability continuation trades." },
  { icon: "🛡️", category: "Risk Management", tip: "Never risk more than 1-2% of portfolio on a single trade. Use ATR for dynamic stop-losses. Sharpe Ratio > 1.5 is excellent for a strategy." },
  { icon: "🧠", category: "Stochastic", tip: "Stoch %K below 20 = oversold. Above 80 = overbought. Best signal: %K crosses above 20 after being oversold — strong buy trigger." },
  { icon: "📰", category: "News Catalyst", tip: "Earnings beats often see 5-15% gap-ups. Wait for the first 30 minutes of volatility to settle, then trade the direction of the gap fill." },
  { icon: "🔢", category: "Position Sizing", tip: "Kelly Criterion: f = (bp - q) / b. With 65% win rate and 2:1 reward/risk, optimal bet = 32.5% of capital. Consider half-Kelly for safer sizing." },
  { icon: "🌊", category: "Volume Analysis", tip: "Volume spike with price rise = strong breakout. Volume drop with price rise = weak move, likely reversal. Always confirm price with volume." },
  { icon: "⚖️", category: "Beta & Volatility", tip: "High-beta stocks (>1.5) amplify market moves. In bull market, overweight high-beta. In uncertainty, rotate to low-beta defensive names like SPY." },
];

const LEARNING_MODULES = [
  { id: 1, title: "RSI Mastery", duration: "5 min", level: "Beginner", emoji: "📊", done: false },
  { id: 2, title: "MACD Strategy", duration: "8 min", level: "Intermediate", emoji: "⚡", done: false },
  { id: 3, title: "Bollinger Breakouts", duration: "6 min", level: "Intermediate", emoji: "🎯", done: false },
  { id: 4, title: "Risk Management", duration: "10 min", level: "Advanced", emoji: "🛡️", done: false },
  { id: 5, title: "Momentum Trading", duration: "7 min", level: "Advanced", emoji: "🚀", done: false },
];

function rnd(min, max) { return Math.random() * (max - min) + min; }
function initHistory(base, n = 60) {
  let p = base;
  return Array.from({ length: n }, () => { p = Math.max(1, p + (Math.random() - 0.48) * p * 0.015); return parseFloat(p.toFixed(2)); });
}
function generateCandles(base, count = 60) {
  let price = base;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    const change = (Math.random() - 0.48) * open * 0.02;
    const close = parseFloat((open + change).toFixed(2));
    const high = parseFloat((Math.max(open, close) * (1 + rnd(0, 0.008))).toFixed(2));
    const low = parseFloat((Math.min(open, close) * (1 - rnd(0, 0.008))).toFixed(2));
    const volume = Math.floor(rnd(300000, 2500000));
    price = close;
    return { open, close, high, low, volume, time: i };
  });
}

// ─── CHART COMPONENTS ───
function MiniSparkline({ data, color = "#00e5a0", width = 80, height = 28 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`).join(" ");
  const fill = `${points} ${width},${height} 0,${height}`;
  const gradId = `sg_${color.replace("#", "")}_${Math.round(width)}`;
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function AdvancedCandleChart({ candles, bb, vwap, height = 200 }) {
  const w = 600;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const eMin = min - range * 0.05, eMax = max + range * 0.05, eRange = eMax - eMin;
  const cw = (w / candles.length) * 0.6, gap = w / candles.length;
  const toY = v => height - ((v - eMin) / eRange) * (height - 4) - 2;
  const bbUpper = candles.map((_, i) => `${i * gap + gap / 2},${toY(bb?.upper || max)}`).join(" ");
  const bbLower = candles.map((_, i) => `${i * gap + gap / 2},${toY(bb?.lower || min)}`).join(" ");
  const vwapPoints = candles.map((c, i) => `${i * gap + gap / 2},${toY(vwap || c.close)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="bbBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <polygon points={`${bbUpper} ${candles.map((_, i) => `${i * gap + gap / 2},${toY(bb?.lower || min)}`).reverse().join(" ")}`} fill="url(#bbBg)" />
      <polyline points={bbUpper} fill="none" stroke="#38bdf822" strokeWidth="0.8" strokeDasharray="3,3" />
      <polyline points={bbLower} fill="none" stroke="#38bdf822" strokeWidth="0.8" strokeDasharray="3,3" />
      <polyline points={vwapPoints} fill="none" stroke="#f59e0b66" strokeWidth="1" strokeDasharray="4,2" />
      {candles.map((c, i) => {
        const x = i * gap + gap / 2, isUp = c.close >= c.open, color = isUp ? "#00e5a0" : "#ff4d6d";
        return (
          <g key={i}>
            <line x1={x} y1={toY(c.high)} x2={x} y2={toY(c.low)} stroke={color} strokeWidth="0.8" opacity="0.7" />
            <rect x={x - cw / 2} y={toY(Math.max(c.open, c.close))} width={cw} height={Math.max(1.5, Math.abs(toY(c.open) - toY(c.close)))} fill={color} opacity={0.88} rx="0.5" />
          </g>
        );
      })}
    </svg>
  );
}

function GaugeChart({ value, label, color }) {
  const clamp = Math.min(100, Math.max(0, value));
  const angle = (clamp / 100) * 180 - 90;
  const r = 38, cx = 50, cy = 52;
  const toXY = (deg) => ({ x: cx + r * Math.cos((deg * Math.PI) / 180), y: cy + r * Math.sin((deg * Math.PI) / 180) });
  const start = toXY(-90), end = toXY(angle);
  const large = clamp > 50 ? 1 : 0;
  return (
    <svg width="100" height="60" viewBox="0 0 100 60">
      <path d={`M ${toXY(-90).x} ${toXY(-90).y} A ${r} ${r} 0 1 1 ${toXY(90).x} ${toXY(90).y}`} fill="none" stroke="#1e3a5f" strokeWidth="6" strokeLinecap="round" />
      <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize="13" fontWeight="700">{Math.round(clamp)}</text>
      <text x={cx} y={cy + 6} textAnchor="middle" fill="#314e6a" fontSize="6" letterSpacing="1">{label}</text>
    </svg>
  );
}

// ─────────────────────────────────────────────
// OTP MODAL
// ─────────────────────────────────────────────
function OTPModal({ onVerified, onCancel, action, symbol, amount }) {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [generatedOTP] = useState(() => Math.floor(100000 + Math.random() * 900000).toString());
  const [timer, setTimer] = useState(30);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const [shaking, setShaking] = useState(false);
  const refs = useRef([]);

  useEffect(() => {
    vibrateMedium();
    const iv = setInterval(() => setTimer(t => t > 0 ? t - 1 : 0), 1000);
    return () => clearInterval(iv);
  }, []);

  const handleChange = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const n = [...otp]; n[i] = v; setOtp(n); setError("");
    if (v && i < 5) refs.current[i + 1]?.focus();
    if (n.every(d => d !== "") && n.join("") === generatedOTP) {
      setVerified(true); vibrateSuccess(); setTimeout(() => onVerified(), 800);
    } else if (n.every(d => d !== "") && n.join("") !== generatedOTP) {
      setError("Wrong OTP. Try again."); vibrateError(); setShaking(true);
      setTimeout(() => { setShaking(false); setOtp(["", "", "", "", "", ""]); refs.current[0]?.focus(); }, 600);
    }
  };

  const handleKeyDown = (i, e) => { if (e.key === "Backspace" && !otp[i] && i > 0) refs.current[i - 1]?.focus(); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
      <div style={{ background: "linear-gradient(135deg,#0d1929 0%,#0a1322 100%)", border: "1px solid #1e3a5f", borderRadius: 16, padding: 32, width: 340, boxShadow: "0 0 60px #00e5a015" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 14, color: "#00e5a0", letterSpacing: 2, marginBottom: 4 }}>2FA VERIFICATION</div>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 12 }}>Confirm your {action} order</div>
          <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 16px", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: action === "BUY" ? "#00e5a0" : "#ff4d6d", fontWeight: 700 }}>{action} {symbol}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>for ${amount?.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 9, color: "#314e6a", marginTop: 8 }}>
            Demo OTP: <span style={{ color: "#f59e0b", fontWeight: 700, letterSpacing: 3 }}>{generatedOTP}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 20, animation: shaking ? "shake 0.5s ease" : "none" }}>
          {otp.map((d, i) => (
            <input key={i} ref={el => refs.current[i] = el} value={d} maxLength={1} inputMode="numeric"
              onChange={e => handleChange(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)} autoFocus={i === 0}
              style={{ width: 42, height: 50, textAlign: "center", fontSize: 20, fontWeight: 700, background: d ? "#0d2a44" : "#080f1a", border: `2px solid ${error ? "#ff4d6d" : d ? "#00e5a0" : "#1e3a5f"}`, borderRadius: 8, color: "#e2e8f0", fontFamily: "inherit", transition: "all 0.2s", outline: "none" }} />
          ))}
        </div>
        {error && <div style={{ textAlign: "center", color: "#ff4d6d", fontSize: 10, marginBottom: 12 }}>⚠️ {error}</div>}
        {verified && <div style={{ textAlign: "center", color: "#00e5a0", fontSize: 11, marginBottom: 12 }}>✅ Verified! Executing trade...</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid #1e3a5f", borderRadius: 8, color: "#475569", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <div style={{ flex: 1, textAlign: "center", padding: "10px", background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 8, fontSize: 10, color: timer > 0 ? "#475569" : "#00e5a0" }}>
            {timer > 0 ? `Resend in ${timer}s` : <span style={{ cursor: "pointer" }} onClick={() => setTimer(30)}>Resend OTP</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SMART ASSISTANT
// ─────────────────────────────────────────────
function SmartAssistant({ stocks, portfolio, pnl, pnlPct, sel }) {
  const [tipIdx, setTipIdx] = useState(0);
  const [modules, setModules] = useState(LEARNING_MODULES);
  const [watchlistInput, setWatchlistInput] = useState("");
  const [watchlist, setWatchlist] = useState(["NVDA", "AAPL", "TSLA"]);
  const [sipAmount, setSipAmount] = useState(1000);
  const [sipStock, setSipStock] = useState("NVDA");
  const [sipFreq, setSipFreq] = useState("Monthly");
  const [sipResult, setSipResult] = useState(null);
  const [activeAssist, setActiveAssist] = useState("tips");
  const [nudge, setNudge] = useState(null);

  useEffect(() => {
    const iv = setInterval(() => setTipIdx(i => (i + 1) % SMART_TIPS.length), 8000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (pnl < -5000) setNudge({ type: "danger", msg: "⚠️ Portfolio down $" + Math.abs(pnl).toFixed(0) + ". Consider reducing risk exposure." });
    else if (pnl > 10000) setNudge({ type: "success", msg: "🎉 Great run! P&L +" + pnl.toFixed(0) + ". Consider booking partial profits." });
    else if (sel?.rsi < 30) setNudge({ type: "info", msg: "💡 " + sel.symbol + " RSI oversold at " + sel.rsi + ". Potential reversal opportunity." });
    else if (sel?.rsi > 75) setNudge({ type: "warn", msg: "🔥 " + sel.symbol + " RSI overbought at " + sel.rsi + ". Watch for pullback." });
    else setNudge(null);
  }, [pnl, sel]);

  const calcSIP = () => {
    const periods = sipFreq === "Monthly" ? 12 : sipFreq === "Weekly" ? 52 : 365;
    const r = 0.15 / periods;
    const fv = sipAmount * ((Math.pow(1 + r, periods) - 1) / r) * (1 + r);
    setSipResult({ invested: sipAmount * periods, returns: fv - sipAmount * periods, total: fv, periods, stock: sipStock });
    vibrateShort();
  };

  const nudgeColors = { danger: "#ff4d6d", success: "#00e5a0", info: "#38bdf8", warn: "#f59e0b" };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[["tips", "💡 Tips"], ["sip", "📅 SIP Calc"], ["watchlist", "⭐ Watchlist"], ["learn", "🎓 Learn"]].map(([k, l]) => (
          <button key={k} onClick={() => { setActiveAssist(k); vibrateShort(); }}
            style={{ padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, background: activeAssist === k ? "#00e5a0" : "#0a0d16", color: activeAssist === k ? "#060a12" : "#475569", border: `1px solid ${activeAssist === k ? "#00e5a0" : "#1e3a5f"}` }}>{l}</button>
        ))}
      </div>

      {nudge && (
        <div style={{ background: nudgeColors[nudge.type] + "12", border: `1px solid ${nudgeColors[nudge.type]}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 10, color: nudgeColors[nudge.type], animation: "slideIn 0.4s ease" }}>
          {nudge.msg}
        </div>
      )}

      {activeAssist === "tips" && (
        <div>
          <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20, marginBottom: 14, animation: "fadeIn 0.5s ease" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>{SMART_TIPS[tipIdx].icon}</div>
            <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2, marginBottom: 6 }}>{SMART_TIPS[tipIdx].category.toUpperCase()}</div>
            <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.8 }}>{SMART_TIPS[tipIdx].tip}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 14, justifyContent: "center" }}>
              {SMART_TIPS.map((_, i) => (
                <div key={i} onClick={() => setTipIdx(i)} style={{ width: i === tipIdx ? 20 : 6, height: 6, borderRadius: 3, background: i === tipIdx ? "#00e5a0" : "#1e3a5f", cursor: "pointer", transition: "all 0.3s" }} />
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {SMART_TIPS.map((t, i) => (
              <div key={i} onClick={() => setTipIdx(i)} style={{ background: i === tipIdx ? "#0d2a44" : "#0a0d16", border: `1px solid ${i === tipIdx ? "#00e5a044" : "#111d2e"}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer", transition: "all 0.2s" }}>
                <div style={{ fontSize: 16, marginBottom: 4 }}>{t.icon}</div>
                <div style={{ fontSize: 9, color: i === tipIdx ? "#00e5a0" : "#475569", fontWeight: 600 }}>{t.category}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeAssist === "sip" && (
        <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 10, color: "#00e5a0", letterSpacing: 2, marginBottom: 16 }}>📅 SIP / RECURRING INVESTMENT CALCULATOR</div>
          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>STOCK / ETF</div>
              <select value={sipStock} onChange={e => setSipStock(e.target.value)} style={{ width: "100%", background: "#080f1a", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }}>
                {STOCK_UNIVERSE.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>INVESTMENT AMOUNT ($)</div>
              <input type="number" value={sipAmount} onChange={e => setSipAmount(Number(e.target.value))} style={{ width: "100%", background: "#080f1a", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>FREQUENCY</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Daily", "Weekly", "Monthly"].map(f => (
                  <button key={f} onClick={() => setSipFreq(f)} style={{ flex: 1, padding: "7px", borderRadius: 6, border: `1px solid ${sipFreq === f ? "#00e5a044" : "#1e3a5f"}`, background: sipFreq === f ? "#00e5a015" : "transparent", color: sipFreq === f ? "#00e5a0" : "#475569", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>{f}</button>
                ))}
              </div>
            </div>
            <button onClick={calcSIP} style={{ padding: "10px", background: "linear-gradient(135deg,#00e5a0,#00b37d)", border: "none", borderRadius: 8, color: "#060a12", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", letterSpacing: 1 }}>
              CALCULATE 1-YEAR PROJECTION
            </button>
          </div>
          {sipResult && (
            <div style={{ background: "#060a12", border: "1px solid #00e5a033", borderRadius: 10, padding: 16, animation: "slideIn 0.3s ease" }}>
              <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 12 }}>1-YEAR SIP PROJECTION FOR {sipResult.stock}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[["Invested", "$" + sipResult.invested.toFixed(0), "#38bdf8"], ["Returns", "$" + sipResult.returns.toFixed(0), "#00e5a0"], ["Total Value", "$" + sipResult.total.toFixed(0), "#f59e0b"]].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 8, color: "#314e6a", marginBottom: 4 }}>{l}</div>
                    <div style={{ fontSize: 14, color: c, fontWeight: 700 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 9, color: "#475569", textAlign: "center" }}>Based on {sipResult.periods} {sipFreq.toLowerCase()} installments · 15% annualized return</div>
            </div>
          )}
        </div>
      )}

      {activeAssist === "watchlist" && (
        <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 10, color: "#00e5a0", letterSpacing: 2, marginBottom: 14 }}>⭐ MY WATCHLIST</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={watchlistInput} onChange={e => setWatchlistInput(e.target.value.toUpperCase())} placeholder="Add symbol (e.g. NVDA)" maxLength={6}
              style={{ flex: 1, background: "#080f1a", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }} />
            <button onClick={() => { if (watchlistInput && !watchlist.includes(watchlistInput)) { setWatchlist(w => [...w, watchlistInput]); setWatchlistInput(""); vibrateShort(); } }}
              style={{ padding: "8px 14px", background: "#00e5a015", border: "1px solid #00e5a044", borderRadius: 6, color: "#00e5a0", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>ADD</button>
          </div>
          {watchlist.map(sym => {
            const s = stocks?.find(x => x.symbol === sym);
            const ch = s ? parseFloat((s.price - s.prev).toFixed(2)) : 0;
            return (
              <div key={sym} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #111d2e" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{sym}</div>
                  {s && <div style={{ fontSize: 9, color: "#475569" }}>{s.name}</div>}
                </div>
                {s && <MiniSparkline data={s.history.slice(-14)} color={ch >= 0 ? "#00e5a0" : "#ff4d6d"} width={50} height={18} />}
                {s && <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: ch >= 0 ? "#00e5a0" : "#ff4d6d", fontWeight: 700 }}>${s.price}</div>
                  <div style={{ fontSize: 9, color: ch >= 0 ? "#00e5a066" : "#ff4d6d66" }}>{ch >= 0 ? "▲" : "▼"}{Math.abs(((ch / s.prev) * 100)).toFixed(2)}%</div>
                </div>}
                <button onClick={() => { setWatchlist(w => w.filter(x => x !== sym)); vibrateShort(); }} style={{ background: "none", border: "none", color: "#ff4d6d44", cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            );
          })}
          {watchlist.length === 0 && <div style={{ fontSize: 10, color: "#314e6a", textAlign: "center", padding: "20px 0" }}>No stocks in watchlist.</div>}
        </div>
      )}

      {activeAssist === "learn" && (
        <div>
          <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#00e5a0", letterSpacing: 2, marginBottom: 4 }}>🎓 LEARNING CENTER</div>
            <div style={{ fontSize: 9, color: "#475569", marginBottom: 12 }}>Master trading concepts with bite-sized lessons</div>
            <div style={{ display: "flex", gap: 16, marginBottom: 4 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, color: "#00e5a0", fontWeight: 700 }}>{modules.filter(m => m.done).length}/{modules.length}</div>
                <div style={{ fontSize: 8, color: "#314e6a" }}>Completed</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ height: 6, background: "#1e3a5f", borderRadius: 3 }}>
                  <div style={{ height: "100%", width: `${(modules.filter(m => m.done).length / modules.length) * 100}%`, background: "#00e5a0", borderRadius: 3, transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: 8, color: "#314e6a", marginTop: 4 }}>{Math.round((modules.filter(m => m.done).length / modules.length) * 100)}% progress</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {modules.map(m => (
              <div key={m.id} style={{ background: m.done ? "#00e5a008" : "#0a0d16", border: `1px solid ${m.done ? "#00e5a033" : "#111d2e"}`, borderRadius: 10, padding: "12px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ fontSize: 24 }}>{m.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: m.done ? "#00e5a0" : "#e2e8f0", fontWeight: 600 }}>{m.title}</div>
                  <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>{m.duration} · {m.level}</div>
                </div>
                <button onClick={() => { setModules(prev => prev.map(x => x.id === m.id ? { ...x, done: !x.done } : x)); vibrateSuccess(); }}
                  style={{ padding: "6px 14px", borderRadius: 16, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 9, fontWeight: 700, background: m.done ? "#00e5a022" : "#0d2a44", color: m.done ? "#00e5a0" : "#38bdf8" }}>
                  {m.done ? "✓ Done" : "Start →"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [stocks, setStocks] = useState(() =>
    STOCK_UNIVERSE.map(s => {
      const history = initHistory(s.base, 60);
      const volumeHistory = Array.from({ length: 60 }, () => Math.floor(rnd(400000, 3000000)));
      return {
        ...s, price: parseFloat(history[history.length - 1].toFixed(2)), prev: s.base, history, volumeHistory,
        candles: generateCandles(s.base, 60), rsi: parseFloat(rnd(28, 72).toFixed(1)),
        macd: parseFloat(rnd(-3, 3).toFixed(3)), macdSignal: parseFloat(rnd(-2, 2).toFixed(3)),
        macdHist: parseFloat(rnd(-1, 1).toFixed(3)), bb: { upper: s.base * 1.05, lower: s.base * 0.95, mid: s.base },
        atr: parseFloat(rnd(1, 8).toFixed(2)), vwap: parseFloat((s.base * rnd(0.98, 1.02)).toFixed(2)),
        momentum: parseFloat(rnd(-5, 5).toFixed(2)), stochK: parseFloat(rnd(10, 90).toFixed(1)),
        aiAction: ["BUY", "SELL", "HOLD"][Math.floor(Math.random() * 3)], aiConfidence: Math.floor(rnd(55, 97)),
        aiReason: "Initializing signals...", aiScore: parseFloat(rnd(-30, 50).toFixed(1)),
        dayHigh: s.base * 1.02, dayLow: s.base * 0.98, volume24h: Math.floor(rnd(500000, 5000000)),
        marketCap: parseFloat(((s.base * (s.shares || 1e9)) / 1e9).toFixed(1)),
      };
    })
  );

  const [selected, setSelected] = useState(0);
  const [portfolio, setPortfolio] = useState({ cash: 250000, holdings: {}, costBasis: {} });
  const [trades, setTrades] = useState([]);
  const [activeTab, setActiveTab] = useState("terminal");
  const [newsItems, setNewsItems] = useState([LIVE_NEWS[0], LIVE_NEWS[1]]);
  const [riskLevel, setRiskLevel] = useState(38);
  const [activeUsers, setActiveUsers] = useState(31);
  const [isAtCapacity, setIsAtCapacity] = useState(false);
  const [manualQty, setManualQty] = useState(1);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [filterSector, setFilterSector] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [priceAlerts, setPriceAlerts] = useState({});
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);
  const [alertPrice, setAlertPrice] = useState("");
  const [chartTab, setChartTab] = useState("candles");
  const [macroData, setMacroData] = useState(() => MACRO_METRICS.map(m => ({ ...m, current: m.value() })));
  const [orderFlow, setOrderFlow] = useState([]);
  const [agentLog, setAgentLog] = useState([]);
  const [systemStatus, setSystemStatus] = useState({ latency: 12, uptime: 99.97, dataFeed: "LIVE" });
  const [pnlHistory, setPnlHistory] = useState(Array.from({ length: 30 }, () => 0));
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [rewards, setRewards] = useState(Array.from({ length: 30 }, () => rnd(-5, 60)));
  const [totalReward, setTotalReward] = useState(0);
  const [sharpeRatio, setSharpeRatio] = useState(1.42);
  const [agentEpisode, setAgentEpisode] = useState(1);
  const [sortBy, setSortBy] = useState("default");
  const [userPoints, setUserPoints] = useState(2450);
  const [rewardHistory, setRewardHistory] = useState([
    { type: "trade", desc: "Completed 10 trades", pts: 150, time: "2h ago" },
    { type: "streak", desc: "7-day login streak", pts: 200, time: "1d ago" },
    { type: "profit", desc: "First profitable week", pts: 500, time: "3d ago" },
    { type: "learn", desc: "Completed RSI module", pts: 100, time: "5d ago" },
    { type: "refer", desc: "Referral bonus", pts: 300, time: "1w ago" },
  ]);
  const [redeemedRewards, setRedeemedRewards] = useState([]);
  const [payTab, setPayTab] = useState("deposit");
  const [savedCards, setSavedCards] = useState([
    { id: 1, type: "Visa", last4: "4242", expiry: "12/26", name: "John Trader" },
    { id: 2, type: "Mastercard", last4: "5555", expiry: "09/25", name: "John Trader" },
  ]);
  const [depositAmount, setDepositAmount] = useState("1000");
  const [depositLoading, setDepositLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState(1);
  const [upiId, setUpiId] = useState("");
  const [payMode, setPayMode] = useState("card");
  const [withdrawAmount, setWithdrawAmount] = useState("500");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawTo, setWithdrawTo] = useState("bank");
  const [withdrawHistory, setWithdrawHistory] = useState([
    { id: 1, amount: 2500, to: "Bank", status: "success", time: "2d ago" },
    { id: 2, amount: 1000, to: "UPI", status: "success", time: "5d ago" },
    { id: 3, amount: 5000, to: "Bank", status: "pending", time: "1h ago" },
  ]);
  const [galleryFilter, setGalleryFilter] = useState("All");
  const [galleryView, setGalleryView] = useState(null);
  const [agentPersonality, setAgentPersonality] = useState("aggressive");
  const [agentChatHistory, setAgentChatHistory] = useState([]);
  const [agentChatInput, setAgentChatInput] = useState("");
  const [agentChatLoading, setAgentChatLoading] = useState(false);
  const [otpPending, setOtpPending] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const stocksRef = useRef(stocks);
  stocksRef.current = stocks;

  // Market engine
  useEffect(() => {
    engine.start(stocksRef.current, (updated) => {
      setStocks(updated);
      setRiskLevel(prev => Math.min(100, Math.max(5, prev + (Math.random() - 0.5) * 6)));
    }, (updated, epoch) => {
      updated.forEach(s => {
        if (priceAlerts[s.symbol]) {
          const target = priceAlerts[s.symbol];
          const prev = stocksRef.current.find(x => x.symbol === s.symbol)?.price;
          if (prev && ((prev < target && s.price >= target) || (prev > target && s.price <= target))) {
            setTriggeredAlerts(p => [`🔔 ${s.symbol} HIT $${target} → now $${s.price}`, ...p.slice(0, 4)]);
            vibrateAlert();
            showToast(`🔔 ${s.symbol} price alert triggered!`, "alert");
          }
        }
      });
    });
    return () => engine.stop();
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setActiveUsers(p => { const n = Math.min(50, Math.max(14, p + Math.floor((Math.random() > 0.5 ? 1 : -1) * rnd(1, 4)))); setIsAtCapacity(n >= 50); return n; });
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch('/state');
        if (res.ok) {
          const data = await res.json();
          if (data.episode_history && data.episode_history.length > 0) {
            setAgentEpisode(data.step_count);
            setTotalReward(data.cumulative_reward);
            setSharpeRatio(data.best_reward); // Using best reward as a proxy for sharpe metric

            const newLog = data.episode_history.slice(-25).reverse().map((h, i) => ({
              ep: data.step_count - i,
              symbol: data.current_task_id || "RL_TASK",
              action: h.action.toUpperCase(),
              reward: h.score.toFixed(2),
              time: new Date((h.timestamp || Date.now() / 1000) * 1000).toLocaleTimeString()
            }));
            setAgentLog(newLog);
            
            // Push into rewards list for chart
            const lastReward = data.episode_history[data.episode_history.length - 1].score;
            setRewards(p => [...p.slice(1), parseFloat(lastReward.toFixed(2))]);
          }
        }
      } catch (e) {
        // Fallback or silence if backend unreachable yet
      }
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      const s = stocksRef.current[Math.floor(Math.random() * stocksRef.current.length)];
      if (s.aiAction === "BUY" && portfolio.cash >= s.price) {
        const qty = Math.floor(rnd(1, 6));
        const cost = parseFloat((qty * s.price).toFixed(2));
        if (portfolio.cash >= cost) {
          setPortfolio(p => ({ ...p, cash: parseFloat((p.cash - cost).toFixed(2)), holdings: { ...p.holdings, [s.symbol]: (p.holdings[s.symbol] || 0) + qty }, costBasis: { ...p.costBasis, [s.symbol]: s.price } }));
          setTrades(p => [{ id: Date.now(), time: new Date().toLocaleTimeString(), symbol: s.symbol, action: "BUY", qty, price: s.price, total: cost, type: "AI", confidence: s.aiConfidence }, ...p.slice(0, 49)]);
          setOrderFlow(p => [{ side: "BUY", symbol: s.symbol, qty, price: s.price, time: new Date().toLocaleTimeString(), type: "AI" }, ...p.slice(0, 19)]);
        }
      } else if (s.aiAction === "SELL" && (portfolio.holdings[s.symbol] || 0) > 0) {
        const qty = Math.min(portfolio.holdings[s.symbol], Math.floor(rnd(1, 4)));
        const gain = parseFloat((qty * s.price).toFixed(2));
        setPortfolio(p => ({ ...p, cash: parseFloat((p.cash + gain).toFixed(2)), holdings: { ...p.holdings, [s.symbol]: p.holdings[s.symbol] - qty } }));
        setTrades(p => [{ id: Date.now(), time: new Date().toLocaleTimeString(), symbol: s.symbol, action: "SELL", qty, price: s.price, total: gain, type: "AI", confidence: s.aiConfidence }, ...p.slice(0, 49)]);
        setOrderFlow(p => [{ side: "SELL", symbol: s.symbol, qty, price: s.price, time: new Date().toLocaleTimeString(), type: "AI" }, ...p.slice(0, 19)]);
      }
    }, 3500);
    return () => clearInterval(iv);
  }, [portfolio]);

  useEffect(() => {
    const iv = setInterval(() => { const idx = Math.floor(Math.random() * LIVE_NEWS.length); setNewsItems(p => [LIVE_NEWS[idx], ...p.slice(0, 2)]); }, 7000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => { setMacroData(MACRO_METRICS.map(m => ({ ...m, current: m.value() }))); }, 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => { setSystemStatus(p => ({ ...p, latency: Math.floor(rnd(8, 28)) })); }, 3000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      const val = portfolio.cash + Object.entries(portfolio.holdings).reduce((acc, [sym, qty]) => { const s = stocksRef.current.find(x => x.symbol === sym); return acc + (s ? s.price * qty : 0); }, 0);
      setPnlHistory(p => [...p.slice(1), val - 250000]);
    }, 5000);
    return () => clearInterval(iv);
  }, [portfolio]);

  const sel = stocks[selected];
  const change = sel ? parseFloat((sel.price - sel.prev).toFixed(2)) : 0;
  const changePct = sel ? parseFloat(((change / Math.max(0.01, sel.prev)) * 100).toFixed(2)) : 0;
  const portfolioValue = useMemo(() => portfolio.cash + Object.entries(portfolio.holdings).reduce((acc, [sym, qty]) => { const s = stocks.find(x => x.symbol === sym); return acc + (s ? s.price * qty : 0); }, 0), [portfolio, stocks]);
  const pnl = parseFloat((portfolioValue - 250000).toFixed(2));
  const pnlPct = parseFloat(((pnl / 250000) * 100).toFixed(2));
  const ac = (a) => a === "BUY" ? "#00e5a0" : a === "SELL" ? "#ff4d6d" : "#f59e0b";
  const sectors = ["ALL", ...new Set(STOCK_UNIVERSE.map(s => s.sector))];

  let displayStocks = stocks.filter(s => {
    if (filterSector !== "ALL" && s.sector !== filterSector) return false;
    if (searchQuery && !s.symbol.includes(searchQuery.toUpperCase()) && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
  if (sortBy === "price_desc") displayStocks = [...displayStocks].sort((a, b) => b.price - a.price);
  if (sortBy === "price_asc") displayStocks = [...displayStocks].sort((a, b) => a.price - b.price);
  if (sortBy === "rsi") displayStocks = [...displayStocks].sort((a, b) => b.rsi - a.rsi);
  if (sortBy === "confidence") displayStocks = [...displayStocks].sort((a, b) => b.aiConfidence - a.aiConfidence);
  if (sortBy === "change") displayStocks = [...displayStocks].sort((a, b) => Math.abs(b.price - b.prev) - Math.abs(a.price - a.prev));
  if (sortBy === "gainers") displayStocks = [...displayStocks].sort((a, b) => (b.price - b.prev) - (a.price - a.prev));
  if (sortBy === "losers") displayStocks = [...displayStocks].sort((a, b) => (a.price - a.prev) - (b.price - b.prev));

  const handleManualTrade = (action) => {
    if (!sel) return;
    const cost = action === "BUY" ? parseFloat((manualQty * sel.price).toFixed(2)) : parseFloat((Math.min(portfolio.holdings[sel.symbol] || 0, manualQty) * sel.price).toFixed(2));
    if (action === "BUY" && portfolio.cash < cost) { showToast("Insufficient cash!", "error"); vibrateError(); return; }
    if (action === "SELL" && (portfolio.holdings[sel.symbol] || 0) < 1) { showToast("No shares to sell!", "error"); vibrateError(); return; }
    vibrateShort();
    setOtpPending({ action, symbol: sel.symbol, amount: cost });
  };

  const executeVerifiedTrade = useCallback(() => {
    if (!otpPending || !sel) return;
    const { action } = otpPending;
    if (action === "BUY") {
      const cost = parseFloat((manualQty * sel.price).toFixed(2));
      setPortfolio(p => ({ ...p, cash: parseFloat((p.cash - cost).toFixed(2)), holdings: { ...p.holdings, [sel.symbol]: (p.holdings[sel.symbol] || 0) + manualQty }, costBasis: { ...p.costBasis, [sel.symbol]: sel.price } }));
      setTrades(p => [{ id: Date.now(), time: new Date().toLocaleTimeString(), symbol: sel.symbol, action: "BUY", qty: manualQty, price: sel.price, total: cost, type: "MANUAL", confidence: sel.aiConfidence }, ...p.slice(0, 49)]);
      setOrderFlow(p => [{ side: "BUY", symbol: sel.symbol, qty: manualQty, price: sel.price, time: new Date().toLocaleTimeString(), type: "MANUAL" }, ...p.slice(0, 19)]);
      showToast(`✅ Bought ${manualQty} ${sel.symbol} @ $${sel.price}`, "success");
      vibrateSuccess();
      setUserPoints(p => p + 15);
      setRewardHistory(h => [{ type: "trade", desc: "Bought " + manualQty + " " + sel.symbol, pts: 15, time: "just now" }, ...h.slice(0, 19)]);
    } else {
      const qty = Math.min(portfolio.holdings[sel.symbol] || 0, manualQty);
      const gain = parseFloat((qty * sel.price).toFixed(2));
      setPortfolio(p => ({ ...p, cash: parseFloat((p.cash + gain).toFixed(2)), holdings: { ...p.holdings, [sel.symbol]: (p.holdings[sel.symbol] || 0) - qty } }));
      setTrades(p => [{ id: Date.now(), time: new Date().toLocaleTimeString(), symbol: sel.symbol, action: "SELL", qty, price: sel.price, total: gain, type: "MANUAL", confidence: sel.aiConfidence }, ...p.slice(0, 49)]);
      showToast(`✅ Sold ${qty} ${sel.symbol} @ $${sel.price}`, "success");
      vibrateSuccess();
    }
    setOtpPending(null);
  }, [otpPending, sel, manualQty, portfolio]);

  const fetchAiAnalysis = useCallback(async () => {
    if (!sel) return;
    setAiLoading(true); setAiAnalysis("");
    try {
      const prompt = `You are QuantRL's AI analyst. Analyze ${sel.symbol} (${sel.name}):\nPrice: $${sel.price} | Change: ${change >= 0 ? "+" : ""}${change} (${changePct}%)\nRSI: ${sel.rsi} | MACD: ${sel.macd} | Signal: ${sel.macdSignal}\nBB Upper: $${sel.bb?.upper} | Lower: $${sel.bb?.lower} | ATR: ${sel.atr}\nAI Signal: ${sel.aiAction} @ ${sel.aiConfidence}% | Score: ${sel.aiScore}\nHoldings: ${portfolio.holdings[sel.symbol] || 0} shares\n\nWrite 4-5 sentences: technical setup, key levels, risk, recommendation, risk/reward ratio. Be quantitative, concise, actionable.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) });
      const data = await res.json();
      setAiAnalysis(data.content?.map(b => b.text || "").join("") || "Analysis unavailable.");
    } catch { setAiAnalysis("AI analysis error. Check API connection."); }
    setAiLoading(false);
  }, [sel, change, changePct, portfolio]);

  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const newHistory = [...chatHistory, { role: "user", content: userMsg }];
    setChatHistory(newHistory);
    setChatLoading(true);
    try {
      const sysPrompt = `You are QuantRL AI, a real-time trading assistant. Current market:\n${stocks.slice(0, 5).map(s => `${s.symbol}: $${s.price} RSI:${s.rsi} Signal:${s.aiAction}(${s.aiConfidence}%)`).join(" | ")}\nPortfolio: $${portfolioValue.toFixed(0)} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl} | Cash: $${portfolio.cash.toFixed(0)}\nBe concise, sharp, and data-driven.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sysPrompt, messages: newHistory.slice(-10) }) });
      const data = await res.json();
      setChatHistory(h => [...h, { role: "assistant", content: data.content?.map(b => b.text || "").join("") || "No response." }]);
    } catch { setChatHistory(h => [...h, { role: "assistant", content: "API error — check connection." }]); }
    setChatLoading(false);
  }, [chatInput, chatHistory, chatLoading, stocks, portfolioValue, pnl, portfolio]);

  const handleDeposit = useCallback(() => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt < 100) { showToast("Minimum deposit: $100", "error"); vibrateError(); return; }
    setDepositLoading(true); vibrateShort();
    setTimeout(() => {
      setPortfolio(p => ({ ...p, cash: parseFloat((p.cash + amt).toFixed(2)) }));
      showToast("✅ $" + amt.toLocaleString() + " deposited!", "success"); vibrateSuccess();
      setUserPoints(p => p + Math.floor(amt / 100) * 5);
      setRewardHistory(h => [{ type: "trade", desc: "Deposited $" + amt.toLocaleString(), pts: Math.floor(amt / 100) * 5, time: "just now" }, ...h.slice(0, 19)]);
      setDepositLoading(false);
    }, 1800);
  }, [depositAmount, showToast]);

  const handleWithdraw = useCallback(() => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt < 50) { showToast("Minimum withdrawal: $50", "error"); vibrateError(); return; }
    if (amt > portfolio.cash) { showToast("Insufficient cash!", "error"); vibrateError(); return; }
    setWithdrawLoading(true); vibrateShort();
    setTimeout(() => {
      setPortfolio(p => ({ ...p, cash: parseFloat((p.cash - amt).toFixed(2)) }));
      setWithdrawHistory(h => [{ id: Date.now(), amount: amt, to: withdrawTo === "bank" ? "Bank" : "UPI", status: "success", time: "just now" }, ...h.slice(0, 9)]);
      showToast("✅ $" + amt.toLocaleString() + " withdrawal initiated!", "success"); vibrateSuccess();
      setWithdrawLoading(false);
    }, 2000);
  }, [withdrawAmount, withdrawTo, portfolio.cash, showToast]);

  const sendAgentChat = useCallback(async () => {
    if (!agentChatInput.trim() || agentChatLoading) return;
    const userMsg = agentChatInput.trim();
    setAgentChatInput("");
    const newHist = [...agentChatHistory, { role: "user", content: userMsg }];
    setAgentChatHistory(newHist);
    setAgentChatLoading(true);
    try {
      const pmap = { aggressive: "You are APEX, an aggressive high-frequency trading AI. Be bold, decisive, quantitative. Use trading jargon. Keep replies concise.", conservative: "You are SHIELD, a conservative risk-management AI. Protect capital first. Be measured and cautious.", balanced: "You are ORACLE, a balanced trading AI. Balance growth and risk. Be analytical and evidence-based." };
      const sysP = pmap[agentPersonality] + " Live: " + stocks.slice(0, 4).map(s => s.symbol + ":$" + s.price + "(" + s.aiAction + ")").join(" ") + " Portfolio:$" + portfolioValue.toFixed(0) + " Cash:$" + portfolio.cash.toFixed(0);
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sysP, messages: newHist.slice(-10) }) });
      const data = await res.json();
      setAgentChatHistory(h => [...h, { role: "assistant", content: data.content?.map(b => b.text || "").join("") || "Agent offline." }]);
    } catch { setAgentChatHistory(h => [...h, { role: "assistant", content: "⚡ Connection error." }]); }
    setAgentChatLoading(false);
  }, [agentChatInput, agentChatHistory, agentChatLoading, agentPersonality, stocks, portfolioValue, portfolio.cash]);

  const GALLERY_IMAGES = [
    { id: 1, url: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&q=80", title: "Bull Market Rally", tag: "Market" },
    { id: 2, url: "https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=400&q=80", title: "Trading Dashboard", tag: "Tech" },
    { id: 3, url: "https://images.unsplash.com/photo-1559526324-593bc073d938?w=400&q=80", title: "Stock Exchange Floor", tag: "Exchange" },
    { id: 4, url: "https://images.unsplash.com/photo-1607863680198-23d4b2565df0?w=400&q=80", title: "Crypto Charts", tag: "Crypto" },
    { id: 5, url: "https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=400&q=80", title: "Market Analysis", tag: "Analysis" },
    { id: 6, url: "https://images.unsplash.com/photo-1543286386-2e659306cd6c?w=400&q=80", title: "Financial District", tag: "Finance" },
    { id: 7, url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&q=80", title: "Chart Patterns", tag: "Analysis" },
    { id: 8, url: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&q=80", title: "Global Markets", tag: "Market" },
    { id: 9, url: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&q=80&v=2", title: "Portfolio Growth", tag: "Finance" },
  ];

  const setPriceAlertFn = () => {
    if (!alertPrice || isNaN(parseFloat(alertPrice))) return;
    setPriceAlerts(p => ({ ...p, [sel.symbol]: parseFloat(alertPrice) }));
    setAlertPrice(""); vibrateShort();
    showToast(`🔔 Alert set for ${sel.symbol} @ $${alertPrice}`, "success");
  };

  const TABS = [
    { key: "terminal", label: "📊 Market" },
    { key: "portfolio", label: "💼 Portfolio" },
    { key: "heatmap", label: "🟥 Heatmap" },
    { key: "agent", label: "🤖 RL Agent" },
    { key: "analysis", label: "🧠 AI Analysis" },
    { key: "chat", label: "💬 Chat" },
    { key: "alerts", label: "🔔 Alerts" },
    { key: "assistant", label: "✨ Assistant" },
    { key: "rewards", label: "🎁 Rewards" },
    { key: "payment", label: "💳 Payment" },
    { key: "withdraw", label: "🏦 Withdraw" },
    { key: "gallery", label: "🖼 Gallery" },
  ];

  const toastColors = { success: "#00e5a0", error: "#ff4d6d", alert: "#f59e0b", info: "#38bdf8" };

  return (
    <div style={{ minHeight: "100vh", background: "#060a12", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Orbitron:wght@600;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#0a0f1e}
        ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes glow{0%,100%{box-shadow:0 0 8px #00e5a022}50%{box-shadow:0 0 20px #00e5a055}}
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
        @keyframes toastIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .blink{animation:pulse 1.6s infinite}
        .tr{animation:slideIn 0.25s ease}
        .tbtn:hover{color:#e2e8f0!important;background:#0d1f3c!important}
        .srow:hover{background:#0d2035!important}
        .abtn:hover{filter:brightness(1.2)}
        input:focus,select:focus{outline:none;border-color:#00e5a066!important}
      `}</style>

      {/* OTP Modal */}
      {otpPending && <OTPModal action={otpPending.action} symbol={otpPending.symbol} amount={otpPending.amount} onVerified={executeVerifiedTrade} onCancel={() => { setOtpPending(null); vibrateShort(); }} />}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9998, background: "#0d1929", border: `1px solid ${toastColors[toast.type]}66`, borderRadius: 10, padding: "10px 20px", fontSize: 11, color: toastColors[toast.type], animation: "toastIn 0.3s ease", boxShadow: `0 0 30px ${toastColors[toast.type]}22`, whiteSpace: "nowrap" }}>
          {toast.msg}
        </div>
      )}

      {/* Capacity banner */}
      {isAtCapacity && (
        <div style={{ background: "#ff4d6d11", borderBottom: "1px solid #ff4d6d44", padding: "4px 20px", fontSize: 10, color: "#ff4d6d", display: "flex", gap: 10 }}>
          <span className="blink">⚠</span> PLATFORM AT CAPACITY — 50/50 users. Trade execution may queue.
        </div>
      )}

      {/* Triggered alerts banner */}
      {triggeredAlerts.length > 0 && (
        <div style={{ background: "#f59e0b11", borderBottom: "1px solid #f59e0b33", padding: "4px 20px", fontSize: 10, color: "#f59e0b", display: "flex", gap: 16, alignItems: "center" }}>
          {triggeredAlerts.slice(0, 3).map((a, i) => <span key={i}>{a}</span>)}
          <button onClick={() => setTriggeredAlerts([])} style={{ background: "none", border: "none", color: "#f59e0b66", cursor: "pointer", fontSize: 11, marginLeft: "auto" }}>✕ Clear</button>
        </div>
      )}

      {/* Ticker tape */}
      <div style={{ background: "#08000e", borderBottom: "1px solid #1a2744", padding: "4px 0", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 36, animation: "ticker 35s linear infinite", whiteSpace: "nowrap" }}>
          {[...stocks, ...stocks].map((s, i) => {
            const ch = parseFloat((s.price - s.prev).toFixed(2));
            const chp = ((ch / Math.max(0.01, s.prev)) * 100).toFixed(2);
            return (
              <span key={i} style={{ fontSize: 10, color: "#475569", cursor: "pointer" }} onClick={() => { const idx = stocks.findIndex(x => x.symbol === s.symbol); if (idx >= 0) { setSelected(idx); setActiveTab("terminal"); vibrateShort(); } }}>
                <span style={{ color: "#64748b", marginRight: 4 }}>{s.symbol}</span>
                <span style={{ color: ch >= 0 ? "#00e5a0" : "#ff4d6d", marginRight: 3 }}>${s.price}</span>
                <span style={{ color: ch >= 0 ? "#00e5a066" : "#ff4d6d66", fontSize: 9 }}>{ch >= 0 ? "▲" : "▼"}{Math.abs(chp)}%</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Macro bar */}
      <div style={{ background: "#0a0d16", borderBottom: "1px solid #111d2e", padding: "4px 16px", display: "flex", gap: 20, overflowX: "auto", alignItems: "center" }}>
        {macroData.map(m => (
          <div key={m.label} style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 8, color: "#314e6a", letterSpacing: 1 }}>{m.label}</span>
            <span style={{ fontSize: 10, color: m.color, fontWeight: 600 }}>{m.current}</span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 8, color: "#1e3a5f" }}>LAT</span>
          <span style={{ fontSize: 9, color: systemStatus.latency < 15 ? "#00e5a0" : "#f59e0b" }}>{systemStatus.latency}ms</span>
          <span style={{ fontSize: 8, color: "#00e5a0", letterSpacing: 1 }}>● LIVE</span>
        </div>
      </div>

      {/* Header */}
      <div style={{ background: "linear-gradient(90deg,#0b1220 0%,#0f1e3a 50%,#0b1220 100%)", borderBottom: "1px solid #1e3a5f", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 22, fontWeight: 900, color: "#00e5a0", letterSpacing: 3 }}>⚡ QUANTRL</div>
          <div>
            <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 3 }}>AI TRADING TERMINAL</div>
            <div style={{ fontSize: 8, color: "#1e3a5f", letterSpacing: 2 }}>v5.0 PRO · OTP SECURED</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 8, color: "#314e6a" }}>USERS</span>
            <div style={{ width: 70, height: 5, background: "#1e3a5f", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${(activeUsers / 50) * 100}%`, background: activeUsers >= 45 ? "#ff4d6d" : activeUsers >= 35 ? "#f59e0b" : "#00e5a0", borderRadius: 3, transition: "width 0.6s" }} />
            </div>
            <span style={{ fontSize: 10, color: activeUsers >= 45 ? "#ff4d6d" : "#00e5a0" }}>{activeUsers}/50</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 8, color: "#314e6a" }}>RISK</span>
            <div style={{ width: 50, height: 5, background: "#1e3a5f", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${riskLevel}%`, background: riskLevel > 70 ? "#ff4d6d" : riskLevel > 45 ? "#f59e0b" : "#00e5a0", borderRadius: 3, transition: "width 0.8s" }} />
            </div>
            <span style={{ fontSize: 10, color: riskLevel > 70 ? "#ff4d6d" : riskLevel > 45 ? "#f59e0b" : "#00e5a0" }}>{riskLevel > 70 ? "HIGH" : riskLevel > 45 ? "MOD" : "LOW"}</span>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#314e6a" }}>PORTFOLIO</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: pnl >= 0 ? "#00e5a0" : "#ff4d6d", fontFamily: "'Orbitron',sans-serif" }}>${portfolioValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#314e6a" }}>P&amp;L</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: pnl >= 0 ? "#00e5a0" : "#ff4d6d" }}>{pnl >= 0 ? "+" : ""}${Math.abs(pnl).toLocaleString()} <span style={{ fontSize: 10 }}>({pnlPct >= 0 ? "+" : ""}{pnlPct}%)</span></div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#314e6a" }}>SHARPE</div>
            <div style={{ fontSize: 13, color: sharpeRatio > 1.5 ? "#00e5a0" : sharpeRatio > 1 ? "#f59e0b" : "#ff4d6d", fontWeight: 700 }}>{sharpeRatio}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }} onClick={() => setActiveTab("rewards")}>
            <span style={{ fontSize: 9, color: "#f59e0b" }}>🎁</span>
            <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}>{userPoints.toLocaleString()} pts</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e5a0" }} />
            <span style={{ fontSize: 10, color: "#00e5a0", letterSpacing: 1 }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* News bar */}
      <div style={{ background: "#07090f", borderBottom: "1px solid #0f1d30", padding: "4px 14px" }}>
        {newsItems.slice(0, 2).map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", animation: "slideIn 0.3s ease" }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: n.sentiment === "bullish" ? "#00e5a0" : n.sentiment === "bearish" ? "#ff4d6d" : "#f59e0b", minWidth: 50, letterSpacing: 1 }}>{n.sentiment.toUpperCase()}</span>
            <span style={{ fontSize: 9, color: "#475569" }}>●</span>
            <span style={{ fontSize: 9, color: "#64748b" }}>{n.text}</span>
            <span style={{ fontSize: 8, color: "#1e3a5f", marginLeft: 4 }}>[{n.impact}]</span>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e3a5f", background: "#090d1a", overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t.key} className="tbtn" onClick={() => { setActiveTab(t.key); vibrateShort(); }}
            style={{ padding: "8px 14px", background: "transparent", border: "none", borderBottom: activeTab === t.key ? "2px solid #00e5a0" : "2px solid transparent", color: activeTab === t.key ? "#00e5a0" : "#314e6a", fontSize: 9, cursor: "pointer", fontFamily: "inherit", letterSpacing: 0.5, whiteSpace: "nowrap", fontWeight: activeTab === t.key ? 700 : 400, transition: "all 0.2s" }}>{t.label}</button>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

        {/* ═══ TERMINAL TAB ═══ */}
        {activeTab === "terminal" && (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Stock list */}
            <div style={{ width: 220, borderRight: "1px solid #111d2e", overflowY: "auto", background: "#07090f" }}>
              <div style={{ padding: "8px 10px", borderBottom: "1px solid #111d2e" }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." style={{ width: "100%", background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 10, fontFamily: "inherit" }} />
                <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ flex: 1, background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 4, padding: "4px", color: "#64748b", fontSize: 9, fontFamily: "inherit" }}>
                    <option value="default">Default</option>
                    <option value="gainers">Top Gainers</option>
                    <option value="losers">Top Losers</option>
                    <option value="price_desc">Price ↓</option>
                    <option value="price_asc">Price ↑</option>
                    <option value="rsi">RSI</option>
                    <option value="confidence">AI Conf.</option>
                    <option value="change">Volatility</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 3, marginTop: 5, flexWrap: "wrap" }}>
                  {sectors.slice(0, 4).map(s => (
                    <button key={s} onClick={() => setFilterSector(s)} style={{ padding: "2px 6px", fontSize: 7, borderRadius: 3, cursor: "pointer", fontFamily: "inherit", background: filterSector === s ? "#00e5a022" : "transparent", color: filterSector === s ? "#00e5a0" : "#314e6a", border: `1px solid ${filterSector === s ? "#00e5a044" : "#111d2e"}` }}>{s}</button>
                  ))}
                </div>
              </div>
              {displayStocks.map((s) => {
                const ch = parseFloat((s.price - s.prev).toFixed(2));
                const chp = ((ch / Math.max(0.01, s.prev)) * 100).toFixed(2);
                const isSelected = stocks.indexOf(s) === selected;
                return (
                  <div key={s.symbol} className="srow" onClick={() => { setSelected(stocks.indexOf(s)); vibrateShort(); }}
                    style={{ padding: "10px", borderBottom: "1px solid #0a0f1e", cursor: "pointer", background: isSelected ? "#0d2035" : "transparent", borderLeft: isSelected ? "2px solid #00e5a0" : "2px solid transparent" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{s.symbol}</span>
                        <span style={{ fontSize: 7, color: "#314e6a", marginLeft: 4 }}>{s.sector}</span>
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: `${ac(s.aiAction)}15`, color: ac(s.aiAction) }}>{s.aiAction}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: ch >= 0 ? "#00e5a0" : "#ff4d6d" }}>${s.price}</div>
                        <div style={{ fontSize: 8, color: ch >= 0 ? "#00e5a066" : "#ff4d6d66" }}>{ch >= 0 ? "▲" : "▼"}{Math.abs(chp)}%</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 7, color: "#1e3a5f" }}>RSI {s.rsi}</div>
                        <MiniSparkline data={s.history.slice(-14)} color={ch >= 0 ? "#00e5a0" : "#ff4d6d"} width={55} height={18} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chart panel */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #111d2e" }}>
              {sel && (
                <div style={{ background: "#0a0d16", borderBottom: "1px solid #111d2e", padding: "10px 16px", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 18, fontWeight: 900, color: "#e2e8f0" }}>{sel.symbol}</div>
                    <div style={{ fontSize: 9, color: "#475569" }}>{sel.name} · {sel.sector}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: change >= 0 ? "#00e5a0" : "#ff4d6d", fontFamily: "'Orbitron',sans-serif" }}>${sel.price}</div>
                    <div style={{ fontSize: 11, color: change >= 0 ? "#00e5a0" : "#ff4d6d" }}>{change >= 0 ? "▲" : "▼"} ${Math.abs(change)} ({changePct >= 0 ? "+" : ""}{changePct}%)</div>
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {[["HIGH", `$${sel.dayHigh}`], ["LOW", `$${sel.dayLow}`], ["VWAP", `$${sel.vwap}`], ["ATR", sel.atr], ["VOL", `${(sel.volume24h / 1e6).toFixed(1)}M`], ["MCAP", `$${sel.marketCap}B`], ["BETA", sel.beta]].map(([l, v]) => (
                      <div key={l}>
                        <div style={{ fontSize: 7, color: "#314e6a", letterSpacing: 1 }}>{l}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginLeft: "auto" }}>
                    <div style={{ textAlign: "center", background: `${ac(sel.aiAction)}15`, border: `1px solid ${ac(sel.aiAction)}44`, borderRadius: 6, padding: "6px 12px" }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: ac(sel.aiAction), fontFamily: "'Orbitron',sans-serif" }}>{sel.aiAction}</div>
                      <div style={{ fontSize: 9, color: "#475569" }}>{sel.aiConfidence}% conf.</div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", background: "#07090f", borderBottom: "1px solid #111d2e", padding: "0 12px" }}>
                {["candles", "indicators"].map(t => (
                  <button key={t} onClick={() => setChartTab(t)} style={{ padding: "6px 12px", background: "transparent", border: "none", borderBottom: chartTab === t ? "2px solid #38bdf8" : "2px solid transparent", color: chartTab === t ? "#38bdf8" : "#314e6a", fontSize: 9, cursor: "pointer", fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase" }}>{t}</button>
                ))}
              </div>

              <div style={{ flex: 1, overflowY: "auto" }}>
                {chartTab === "candles" && sel && (
                  <div>
                    <div style={{ padding: "8px 12px 0", fontSize: 8, color: "#1e3a5f", display: "flex", gap: 16 }}>
                      <span style={{ color: "#38bdf8" }}>── BB Bands</span>
                      <span style={{ color: "#f59e0b" }}>- - VWAP</span>
                    </div>
                    <div style={{ padding: "4px 4px 0" }}>
                      <AdvancedCandleChart candles={sel.candles} bb={sel.bb} vwap={sel.vwap} height={180} />
                    </div>
                  </div>
                )}
                {chartTab === "indicators" && sel && (
                  <div style={{ padding: "12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
                      <GaugeChart value={sel.rsi} label="RSI(14)" color={sel.rsi < 30 ? "#00e5a0" : sel.rsi > 70 ? "#ff4d6d" : "#f59e0b"} />
                      <GaugeChart value={sel.stochK} label="STOCH%K" color={sel.stochK < 20 ? "#00e5a0" : sel.stochK > 80 ? "#ff4d6d" : "#38bdf8"} />
                      <GaugeChart value={Math.min(100, Math.max(0, sel.aiConfidence))} label="AI CONF" color="#7c3aed" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[
                        { l: "MACD", v: sel.macd, c: sel.macd > sel.macdSignal ? "#00e5a0" : "#ff4d6d" },
                        { l: "Signal", v: sel.macdSignal, c: "#f59e0b" },
                        { l: "Histogram", v: sel.macdHist, c: sel.macdHist > 0 ? "#00e5a0" : "#ff4d6d" },
                        { l: "BB Upper", v: `$${sel.bb?.upper}`, c: "#38bdf8" },
                        { l: "BB Mid", v: `$${sel.bb?.mid}`, c: "#64748b" },
                        { l: "BB Lower", v: `$${sel.bb?.lower}`, c: "#38bdf8" },
                        { l: "ATR(14)", v: sel.atr, c: "#a78bfa" },
                        { l: "Momentum", v: `${sel.momentum > 0 ? "+" : ""}${sel.momentum}`, c: sel.momentum > 0 ? "#00e5a0" : "#ff4d6d" },
                        { l: "VWAP", v: `$${sel.vwap}`, c: "#f59e0b" },
                      ].map(({ l, v, c }) => (
                        <div key={l} style={{ background: "#0a0d16", borderRadius: 5, padding: "6px 8px" }}>
                          <div style={{ fontSize: 7, color: "#314e6a", marginBottom: 2 }}>{l}</div>
                          <div style={{ fontSize: 11, color: c, fontWeight: 700 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Trade panel */}
            <div style={{ width: 240, overflowY: "auto", background: "#07090f", padding: 12 }}>
              <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2, marginBottom: 12 }}>🔐 PLACE ORDER · OTP SECURED</div>
                <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>QUANTITY</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                  <button onClick={() => setManualQty(q => Math.max(1, q - 1))} style={{ width: 28, height: 28, background: "#1e3a5f22", border: "1px solid #1e3a5f", borderRadius: 4, color: "#64748b", fontSize: 14, cursor: "pointer" }}>−</button>
                  <input type="number" value={manualQty} min={1} onChange={e => setManualQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ flex: 1, textAlign: "center", background: "#080f1a", border: "1px solid #1e3a5f", borderRadius: 4, padding: "4px", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", fontWeight: 700 }} />
                  <button onClick={() => setManualQty(q => q + 1)} style={{ width: 28, height: 28, background: "#00e5a022", border: "1px solid #00e5a044", borderRadius: 4, color: "#00e5a0", fontSize: 14, cursor: "pointer" }}>+</button>
                </div>
                <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                  {[1, 5, 10, 25].map(q => (
                    <button key={q} onClick={() => setManualQty(q)} style={{ flex: 1, padding: "4px 2px", fontSize: 9, borderRadius: 4, border: `1px solid ${manualQty === q ? "#00e5a044" : "#111d2e"}`, background: manualQty === q ? "#00e5a015" : "transparent", color: manualQty === q ? "#00e5a0" : "#314e6a", cursor: "pointer", fontFamily: "inherit" }}>{q}</button>
                  ))}
                </div>
                {sel && <div style={{ fontSize: 9, color: "#475569", marginBottom: 10, padding: "6px 8px", background: "#060a12", borderRadius: 5 }}>
                  Est. cost: <span style={{ color: "#f59e0b", fontWeight: 700 }}>${(manualQty * sel.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                </div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="abtn" onClick={() => handleManualTrade("BUY")} style={{ flex: 1, padding: "10px 0", background: "linear-gradient(135deg,#00e5a0,#00b37d)", border: "none", borderRadius: 8, color: "#060a12", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", letterSpacing: 1 }}>BUY</button>
                  <button className="abtn" onClick={() => handleManualTrade("SELL")} style={{ flex: 1, padding: "10px 0", background: "linear-gradient(135deg,#ff4d6d,#cc2244)", border: "none", borderRadius: 8, color: "#fff", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", letterSpacing: 1 }}>SELL</button>
                </div>
                <div style={{ fontSize: 8, color: "#314e6a", textAlign: "center", marginTop: 8 }}>🔐 OTP required to confirm</div>
              </div>

              <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 8 }}>LIVE ORDER FLOW</div>
                {orderFlow.slice(0, 6).map((o, i) => (
                  <div key={i} className="tr" style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #0a0f1e", fontSize: 9 }}>
                    <span style={{ color: o.side === "BUY" ? "#00e5a0" : "#ff4d6d", fontWeight: 700 }}>{o.side}</span>
                    <span style={{ color: "#64748b" }}>{o.symbol}</span>
                    <span style={{ color: "#475569" }}>{o.qty}×${o.price}</span>
                    <span style={{ color: "#1e3a5f", fontSize: 8 }}>{o.type}</span>
                  </div>
                ))}
                {orderFlow.length === 0 && <div style={{ fontSize: 9, color: "#1e3a5f" }}>Waiting for orders...</div>}
              </div>

              <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 8 }}>MY HOLDINGS</div>
                {Object.entries(portfolio.holdings).filter(([, q]) => q > 0).map(([sym, qty]) => {
                  const s = stocks.find(x => x.symbol === sym);
                  const val = s ? (s.price * qty) : 0;
                  const pl = s ? ((s.price - (portfolio.costBasis?.[sym] || s.base)) * qty) : 0;
                  return (
                    <div key={sym} style={{ padding: "6px 0", borderBottom: "1px solid #0a0f1e" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#e2e8f0", fontSize: 10, fontWeight: 700 }}>{sym}</span>
                        <span style={{ color: "#64748b", fontSize: 9 }}>{qty} sh</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                        <span style={{ color: "#94a3b8", fontSize: 9 }}>${val.toFixed(0)}</span>
                        <span style={{ color: pl >= 0 ? "#00e5a0" : "#ff4d6d", fontSize: 9 }}>{pl >= 0 ? "+" : ""}${pl.toFixed(0)}</span>
                      </div>
                    </div>
                  );
                })}
                {Object.values(portfolio.holdings).every(q => q === 0) && <div style={{ fontSize: 9, color: "#1e3a5f" }}>No holdings yet.</div>}
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #111d2e" }}>
                  <div style={{ fontSize: 8, color: "#314e6a" }}>CASH AVAILABLE</div>
                  <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: 700 }}>${portfolio.cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PORTFOLIO TAB ═══ */}
        {activeTab === "portfolio" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
              {[
                { label: "Total Value", value: `$${portfolioValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: "#e2e8f0", sub: "Portfolio + Cash" },
                { label: "Invested", value: "$250,000", color: "#38bdf8", sub: "Initial capital" },
                { label: "P&L Today", value: `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: pnl >= 0 ? "#00e5a0" : "#ff4d6d", sub: `${pnlPct >= 0 ? "+" : ""}${pnlPct}% return` },
                { label: "Sharpe Ratio", value: sharpeRatio, color: sharpeRatio > 1.5 ? "#00e5a0" : "#f59e0b", sub: "> 1.5 is excellent" },
              ].map(c => (
                <div key={c.label} style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 1, marginBottom: 8 }}>{c.label.toUpperCase()}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c.color, fontFamily: "'Orbitron',sans-serif", marginBottom: 4 }}>{c.value}</div>
                  <div style={{ fontSize: 9, color: "#475569" }}>{c.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#314e6a", letterSpacing: 2, marginBottom: 12 }}>HOLDINGS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px 80px 80px 80px", borderBottom: "1px solid #1e3a5f", paddingBottom: 6, marginBottom: 8 }}>
                {["SYMBOL", "QTY", "AVG COST", "LTP", "INVESTED", "CUR. VAL", "P&L"].map(h => (
                  <div key={h} style={{ fontSize: 8, color: "#314e6a", letterSpacing: 1, textAlign: h === "SYMBOL" ? "left" : "right" }}>{h}</div>
                ))}
              </div>
              {Object.entries(portfolio.holdings).filter(([, q]) => q > 0).map(([sym, qty]) => {
                const s = stocks.find(x => x.symbol === sym);
                const avg = portfolio.costBasis?.[sym] || s?.base || 0;
                const ltp = s?.price || 0;
                const invested = avg * qty;
                const curVal = ltp * qty;
                const pl = curVal - invested;
                const plPct = invested > 0 ? (pl / invested * 100) : 0;
                return (
                  <div key={sym} className="srow" style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px 80px 80px 80px", padding: "8px 0", borderBottom: "1px solid #0a0f1e", cursor: "pointer" }}
                    onClick={() => { setSelected(stocks.indexOf(s)); setActiveTab("terminal"); vibrateShort(); }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 700 }}>{sym}</div>
                      <div style={{ fontSize: 8, color: "#475569" }}>{s?.name?.split(" ")[0]}</div>
                    </div>
                    {[qty, `$${avg.toFixed(0)}`, `$${ltp}`, `$${invested.toFixed(0)}`, `$${curVal.toFixed(0)}`].map((v, i) => (
                      <div key={i} style={{ textAlign: "right", fontSize: 10, color: "#94a3b8", paddingTop: 2 }}>{v}</div>
                    ))}
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: pl >= 0 ? "#00e5a0" : "#ff4d6d", fontWeight: 700 }}>{pl >= 0 ? "+" : ""}${pl.toFixed(0)}</div>
                      <div style={{ fontSize: 8, color: pl >= 0 ? "#00e5a066" : "#ff4d6d66" }}>{plPct >= 0 ? "+" : ""}{plPct.toFixed(1)}%</div>
                    </div>
                  </div>
                );
              })}
              {Object.values(portfolio.holdings).every(q => q === 0) && <div style={{ fontSize: 10, color: "#314e6a", padding: "20px 0", textAlign: "center" }}>No holdings. Go to Market tab to place trades.</div>}
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 10, color: "#314e6a", letterSpacing: 2, marginBottom: 12 }}>TRADE HISTORY ({trades.length})</div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {trades.slice(0, 30).map((t, i) => (
                  <div key={i} className="tr" style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid #0a0f1e", alignItems: "center" }}>
                    <span style={{ fontSize: 8, color: "#314e6a", minWidth: 60 }}>{t.time}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: t.action === "BUY" ? "#00e5a0" : "#ff4d6d", minWidth: 32 }}>{t.action}</span>
                    <span style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 700, minWidth: 40 }}>{t.symbol}</span>
                    <span style={{ fontSize: 9, color: "#64748b" }}>{t.qty} × ${t.price}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8" }}>${t.total}</span>
                    <span style={{ fontSize: 7, color: t.type === "MANUAL" ? "#a78bfa" : "#38bdf8", padding: "1px 5px", background: t.type === "MANUAL" ? "#a78bfa11" : "#38bdf811", borderRadius: 3 }}>{t.type}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ HEATMAP TAB ═══ */}
        {activeTab === "heatmap" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ fontSize: 10, color: "#314e6a", letterSpacing: 2, marginBottom: 14 }}>MARKET HEATMAP — BY PRICE CHANGE</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {stocks.map(s => {
                const ch = parseFloat((s.price - s.prev).toFixed(2));
                const chp = ((ch / Math.max(0.01, s.prev)) * 100);
                const intensity = Math.min(1, Math.abs(chp) / 3);
                const bg = ch >= 0 ? `rgba(0,229,160,${0.08 + intensity * 0.22})` : `rgba(255,77,109,${0.08 + intensity * 0.22})`;
                const border = ch >= 0 ? `rgba(0,229,160,${0.2 + intensity * 0.4})` : `rgba(255,77,109,${0.2 + intensity * 0.4})`;
                return (
                  <div key={s.symbol} onClick={() => { setSelected(stocks.indexOf(s)); setActiveTab("terminal"); vibrateShort(); }}
                    style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "14px 12px", cursor: "pointer", transition: "transform 0.2s", minHeight: 90 }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                    <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{s.symbol}</div>
                    <div style={{ fontSize: 12, color: ch >= 0 ? "#00e5a0" : "#ff4d6d", fontWeight: 700, marginBottom: 2 }}>{chp >= 0 ? "+" : ""}{chp.toFixed(2)}%</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>${s.price}</div>
                    <div style={{ fontSize: 8, color: ch >= 0 ? "#00e5a066" : "#ff4d6d66", marginTop: 4 }}>{s.aiAction} · RSI {s.rsi}</div>
                    <MiniSparkline data={s.history.slice(-20)} color={ch >= 0 ? "#00e5a0" : "#ff4d6d"} width={120} height={25} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ RL AGENT TAB ═══ */}
        {activeTab === "agent" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[["Episodes", agentEpisode, "#38bdf8"], ["Total Reward", totalReward.toFixed(0), totalReward >= 0 ? "#00e5a0" : "#ff4d6d"], ["Sharpe", sharpeRatio, sharpeRatio > 1.5 ? "#00e5a0" : "#f59e0b"], ["Avg Reward", (totalReward / Math.max(1, agentEpisode)).toFixed(1), "#a78bfa"]].map(([l, v, c]) => (
                <div key={l} style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 6 }}>{String(l).toUpperCase()}</div>
                  <div style={{ fontSize: 18, color: c, fontWeight: 700, fontFamily: "'Orbitron',sans-serif" }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2, marginBottom: 10 }}>🧬 AGENT PERSONALITY</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["aggressive", "⚡ APEX", "Max returns", "#ff4d6d"], ["balanced", "⚖️ ORACLE", "Balanced", "#f59e0b"], ["conservative", "🛡️ SHIELD", "Capital safe", "#38bdf8"]].map(([key, name, desc, col]) => (
                  <button key={key} onClick={() => { setAgentPersonality(key); vibrateShort(); }}
                    style={{ flex: 1, padding: "10px 6px", borderRadius: 8, border: "1px solid " + (agentPersonality === key ? col + "88" : "#1e3a5f"), background: agentPersonality === key ? col + "18" : "transparent", cursor: "pointer", fontFamily: "inherit" }}>
                    <div style={{ fontSize: 11, color: agentPersonality === key ? col : "#475569", fontWeight: 700, marginBottom: 2 }}>{name}</div>
                    <div style={{ fontSize: 8, color: "#314e6a" }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #111d2e", display: "flex", alignItems: "center", gap: 8 }}>
                <div className="blink" style={{ width: 7, height: 7, borderRadius: "50%", background: "#00e5a0" }} />
                <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2 }}>TALK TO {agentPersonality === "aggressive" ? "APEX" : agentPersonality === "balanced" ? "ORACLE" : "SHIELD"}</div>
                <button onClick={() => setAgentChatHistory([])} style={{ marginLeft: "auto", background: "none", border: "none", color: "#314e6a", fontSize: 9, cursor: "pointer" }}>Clear</button>
              </div>
              <div style={{ height: 200, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {agentChatHistory.length === 0 && (
                  <div style={{ textAlign: "center", paddingTop: 20 }}>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>🤖</div>
                    <div style={{ fontSize: 10, color: "#314e6a", marginBottom: 10 }}>Ask the agent to analyze markets, size positions, or plan strategy</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                      {["Best trade now?", "Rebalance portfolio", "Top momentum picks", "Risk assessment"].map(q => (
                        <button key={q} onClick={() => setAgentChatInput(q)} style={{ padding: "4px 10px", fontSize: 9, background: "#060a12", border: "1px solid #111d2e", borderRadius: 10, color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}>{q}</button>
                      ))}
                    </div>
                  </div>
                )}
                {agentChatHistory.map((msg, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "80%", padding: "8px 12px", borderRadius: msg.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", background: msg.role === "user" ? "#0d2a44" : "#060a12", border: msg.role === "user" ? "1px solid #1e3a5f" : "1px solid #111d2e", fontSize: 10, color: msg.role === "user" ? "#94a3b8" : "#cbd5e1", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                      {msg.role === "assistant" && <div style={{ fontSize: 7, color: "#00e5a0", letterSpacing: 1, marginBottom: 3 }}>{agentPersonality.toUpperCase()} AGENT</div>}
                      {msg.content}
                    </div>
                  </div>
                ))}
                {agentChatLoading && <div style={{ padding: "8px 12px", background: "#060a12", border: "1px solid #111d2e", borderRadius: "10px 10px 10px 2px", fontSize: 10, color: "#314e6a", width: "fit-content" }}><span className="blink">⚡ Analyzing...</span></div>}
              </div>
              <div style={{ borderTop: "1px solid #111d2e", padding: "8px 12px", display: "flex", gap: 8 }}>
                <input value={agentChatInput} onChange={e => setAgentChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendAgentChat()} placeholder="Ask the trading agent..." style={{ flex: 1, background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 5, padding: "7px 10px", color: "#e2e8f0", fontSize: 10, fontFamily: "inherit" }} />
                <button onClick={sendAgentChat} disabled={agentChatLoading} style={{ padding: "7px 14px", background: "#00e5a022", border: "1px solid #00e5a044", borderRadius: 5, color: "#00e5a0", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Send</button>
              </div>
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 8 }}>EPISODE REWARDS</div>
              <svg width="100%" height="70" viewBox={"0 0 " + (rewards.length * 12) + " 70"} preserveAspectRatio="none">
                {rewards.map((r, i) => { const h = Math.max(2, Math.min(60, (r / 100) * 60)); return <rect key={i} x={i * 12} y={70 - h} width={10} height={h} fill={r >= 0 ? "#00e5a066" : "#ff4d6d66"} rx="1" />; })}
              </svg>
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 8 }}>AGENT LOG</div>
              {agentLog.slice(0, 12).map((l, i) => (
                <div key={i} className="tr" style={{ display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid #0a0f1e", fontSize: 9 }}>
                  <span style={{ color: "#314e6a", minWidth: 55 }}>{l.time}</span>
                  <span style={{ color: "#e2e8f0", minWidth: 35 }}>Ep.{l.ep}</span>
                  <span style={{ color: "#64748b", minWidth: 35 }}>{l.symbol}</span>
                  <span style={{ color: l.action === "BUY" ? "#00e5a0" : l.action === "SELL" ? "#ff4d6d" : "#f59e0b", fontWeight: 700, minWidth: 30 }}>{l.action}</span>
                  <span style={{ color: parseFloat(l.reward) >= 0 ? "#00e5a0" : "#ff4d6d", marginLeft: "auto" }}>R:{l.reward}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ AI ANALYSIS TAB ═══ */}
        {activeTab === "analysis" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 10, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#00e5a0", letterSpacing: 2 }}>🧠 AI STOCK ANALYSIS — {sel?.symbol}</div>
                <button onClick={fetchAiAnalysis} disabled={aiLoading} style={{ padding: "8px 18px", background: aiLoading ? "#0a0d16" : "#00e5a022", border: "1px solid #00e5a044", borderRadius: 6, color: "#00e5a0", fontSize: 10, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  {aiLoading ? "Analyzing..." : "Run Analysis →"}
                </button>
              </div>
              {sel && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
                  {[["Price", `$${sel.price}`], ["RSI", sel.rsi], ["Signal", sel.aiAction], ["Confidence", `${sel.aiConfidence}%`]].map(([l, v]) => (
                    <div key={l} style={{ background: "#060a12", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "#314e6a", marginBottom: 3 }}>{l}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
              {aiLoading && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, color: "#314e6a" }}><span className="blink">⚡ Claude is analyzing {sel?.symbol}...</span></div>}
              {aiAnalysis && <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.9, whiteSpace: "pre-wrap", padding: "14px", background: "#060a12", borderRadius: 8, border: "1px solid #111d2e" }}>{aiAnalysis}</div>}
              {!aiAnalysis && !aiLoading && <div style={{ fontSize: 10, color: "#1e3a5f", textAlign: "center", padding: "30px 0" }}>Click "Run Analysis" to get AI market insights for {sel?.symbol}</div>}
            </div>
          </div>
        )}

        {/* ═══ CHAT TAB ═══ */}
        {activeTab === "chat" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #111d2e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2 }}>💬 QUANTRL AI CHAT</div>
              <button onClick={() => setChatHistory([])} style={{ background: "none", border: "none", color: "#314e6a", cursor: "pointer", fontSize: 9 }}>Clear chat</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {chatHistory.length === 0 && (
                <div style={{ textAlign: "center", padding: "30px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
                  <div style={{ fontSize: 11, color: "#314e6a", marginBottom: 8 }}>Ask me anything about the market</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    {["What's the best BUY right now?", "Analyze NVDA vs AMD", "Explain MACD crossover", "Should I hold or sell TSLA?"].map(q => (
                      <button key={q} onClick={() => setChatInput(q)} style={{ padding: "5px 10px", fontSize: 9, background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 12, color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "75%", padding: "10px 14px", borderRadius: msg.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px", background: msg.role === "user" ? "#0d2a44" : "#0a0d16", border: msg.role === "user" ? "1px solid #1e3a5f" : "1px solid #111d2e", fontSize: 11, color: msg.role === "user" ? "#94a3b8" : "#cbd5e1", lineHeight: 1.8, animation: "fadeIn 0.3s ease", whiteSpace: "pre-wrap" }}>
                    {msg.role === "assistant" && <div style={{ fontSize: 8, color: "#00e5a0", letterSpacing: 1, marginBottom: 5 }}>QUANTRL AI</div>}
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && <div style={{ display: "flex" }}><div style={{ padding: "10px 14px", background: "#0a0d16", border: "1px solid #111d2e", borderRadius: "12px 12px 12px 3px", fontSize: 10, color: "#314e6a" }}><span className="blink">⚡ Analyzing market data...</span></div></div>}
            </div>
            <div style={{ borderTop: "1px solid #111d2e", padding: "10px 14px", display: "flex", gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()} placeholder="Ask about stocks, signals, strategies..." style={{ flex: 1, background: "#0a0d16", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ padding: "8px 18px", background: "#00e5a022", border: "1px solid #00e5a044", borderRadius: 6, color: "#00e5a0", fontSize: 10, fontWeight: 700, cursor: chatLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Send ↵</button>
            </div>
          </div>
        )}

        {/* ═══ ALERTS TAB ═══ */}
        {activeTab === "alerts" && (
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>SET PRICE ALERT</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  {stocks.map((s, i) => (
                    <button key={s.symbol} onClick={() => setSelected(i)} style={{ padding: "3px 7px", fontSize: 8, borderRadius: 3, cursor: "pointer", fontFamily: "inherit", background: selected === i ? "#f59e0b22" : "transparent", color: selected === i ? "#f59e0b" : "#314e6a", border: `1px solid ${selected === i ? "#f59e0b44" : "#111d2e"}` }}>{s.symbol}</button>
                  ))}
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>{sel?.symbol}: now ${sel?.price} · H ${sel?.dayHigh} · L ${sel?.dayLow}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" placeholder="Alert price $" value={alertPrice} onChange={e => setAlertPrice(e.target.value)} onKeyDown={e => e.key === "Enter" && setPriceAlertFn()} style={{ flex: 1, background: "#080b13", border: "1px solid #1e3a5f", borderRadius: 4, padding: "6px 8px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }} />
                  <button onClick={setPriceAlertFn} style={{ padding: "6px 14px", background: "#f59e0b22", border: "1px solid #f59e0b44", borderRadius: 4, color: "#f59e0b", fontSize: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>SET 🔔</button>
                </div>
              </div>
              <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>ACTIVE ALERTS ({Object.keys(priceAlerts).length})</div>
                {Object.keys(priceAlerts).length === 0 && <div style={{ fontSize: 9, color: "#1e3a5f" }}>No alerts set.</div>}
                {Object.entries(priceAlerts).map(([sym, target]) => {
                  const s = stocks.find(x => x.symbol === sym);
                  const diff = s ? ((s.price - target) / target * 100).toFixed(2) : null;
                  return (
                    <div key={sym} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #0a0f1e" }}>
                      <div>
                        <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: 11 }}>{sym}</span>
                        <span style={{ color: "#64748b", fontSize: 9, marginLeft: 8 }}>@ ${target}</span>
                        <span style={{ color: "#314e6a", fontSize: 8, marginLeft: 6 }}>now ${s?.price} ({diff}%)</span>
                      </div>
                      <button onClick={() => { setPriceAlerts(p => { const n = { ...p }; delete n[sym]; return n; }); vibrateShort(); }} style={{ background: "none", border: "none", color: "#ff4d6d66", cursor: "pointer", fontSize: 13 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>LIVE MARKET NEWS</div>
              {LIVE_NEWS.map((n, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #0a0f1e" }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: n.sentiment === "bullish" ? "#00e5a0" : n.sentiment === "bearish" ? "#ff4d6d" : "#f59e0b", minWidth: 48, letterSpacing: 1 }}>{n.sentiment.toUpperCase()}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{n.text}</div>
                    <div style={{ fontSize: 8, color: "#1e3a5f", marginTop: 2 }}>Impact: {n.impact}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ SMART ASSISTANT TAB ═══ */}
        {activeTab === "assistant" && (
          <SmartAssistant stocks={stocks} portfolio={portfolio} pnl={pnl} pnlPct={pnlPct} sel={sel} />
        )}

        {/* ═══ REWARDS TAB ═══ */}
        {activeTab === "rewards" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ background: "linear-gradient(135deg,#0d2a44,#0a1a2e)", border: "1px solid #1e3a5f", borderRadius: 14, padding: 22, marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#00e5a0", letterSpacing: 3, marginBottom: 4 }}>TOTAL POINTS</div>
              <div style={{ fontSize: 48, fontWeight: 900, color: "#00e5a0", fontFamily: "'Orbitron',sans-serif", marginBottom: 4 }}>{userPoints.toLocaleString()}</div>
              <div style={{ fontSize: 9, color: "#475569" }}>≈ ${(userPoints * 0.01).toFixed(2)} cashback value</div>
              <div style={{ marginTop: 12 }}>
                <span style={{ background: "#00e5a015", border: "1px solid #00e5a033", borderRadius: 20, padding: "4px 16px", fontSize: 10, color: "#00e5a0" }}>
                  {userPoints >= 5000 ? "🏆 Gold" : userPoints >= 2000 ? "⭐ Silver" : "🥉 Bronze"} Member
                </span>
              </div>
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2, marginBottom: 12 }}>🎯 ACTIVE CHALLENGES</div>
              {[
                { icon: "📈", title: "Place 5 Trades Today", pts: 100, prog: Math.min(trades.length, 5), total: 5 },
                { icon: "💰", title: "Achieve +2% P&L", pts: 250, prog: Math.min(Math.max(0, Math.floor(pnlPct)), 2), total: 2 },
                { icon: "⚡", title: "Use AI Agent Chat", pts: 75, prog: Math.min(agentChatHistory.length, 1), total: 1 },
                { icon: "📚", title: "Complete 2 Lessons", pts: 150, prog: 0, total: 2 },
                { icon: "🤖", title: "Execute AI Signal Trade", pts: 200, prog: Math.min(trades.filter(t => t.type === "AI").length, 1), total: 1 },
              ].map((c, i) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #0a0f1e" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 16 }}>{c.icon}</span>
                      <div>
                        <div style={{ fontSize: 10, color: "#e2e8f0" }}>{c.title}</div>
                        <div style={{ fontSize: 8, color: "#475569" }}>+{c.pts} pts</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: c.prog >= c.total ? "#00e5a0" : "#64748b", fontWeight: 700 }}>{c.prog >= c.total ? "✅" : c.prog + "/" + c.total}</div>
                  </div>
                  <div style={{ height: 3, background: "#1e3a5f", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: Math.min(100, (c.prog / c.total) * 100) + "%", background: c.prog >= c.total ? "#00e5a0" : "#38bdf8", borderRadius: 2, transition: "width 0.5s" }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#00e5a0", letterSpacing: 2, marginBottom: 12 }}>🎁 REDEEM REWARDS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { icon: "💵", title: "$5 Cashback", pts: 500, col: "#00e5a0" },
                  { icon: "📊", title: "Premium Analytics 7d", pts: 1000, col: "#38bdf8" },
                  { icon: "🚀", title: "Zero Commission 1d", pts: 1500, col: "#a78bfa" },
                  { icon: "🎓", title: "Pro Course Access", pts: 800, col: "#f59e0b" },
                  { icon: "📱", title: "Priority Support", pts: 300, col: "#00e5a0" },
                  { icon: "🏆", title: "Leaderboard Badge", pts: 200, col: "#fbbf24" },
                ].map((r, i) => (
                  <div key={i} style={{ background: "#060a12", border: "1px solid " + (userPoints >= r.pts ? r.col + "33" : "#111d2e"), borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{r.icon}</div>
                    <div style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600, marginBottom: 2 }}>{r.title}</div>
                    <div style={{ fontSize: 9, color: r.col, marginBottom: 8 }}>{r.pts.toLocaleString()} pts</div>
                    <button onClick={() => {
                      if (userPoints >= r.pts) { setUserPoints(p => p - r.pts); setRedeemedRewards(p => [...p, r.title]); showToast("🎁 Redeemed: " + r.title, "success"); vibrateSuccess(); }
                      else { showToast("Not enough points!", "error"); vibrateError(); }
                    }} style={{ width: "100%", padding: "5px", borderRadius: 6, border: "1px solid " + (userPoints >= r.pts ? r.col + "44" : "#1e3a5f"), background: userPoints >= r.pts ? r.col + "15" : "transparent", color: userPoints >= r.pts ? r.col : "#314e6a", fontSize: 9, fontWeight: 700, cursor: userPoints >= r.pts ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                      {userPoints >= r.pts ? "Redeem →" : "🔒 Locked"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>📋 POINTS HISTORY</div>
              {rewardHistory.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #0a0f1e" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 14 }}>{r.type === "trade" ? "📈" : r.type === "streak" ? "🔥" : r.type === "profit" ? "💰" : r.type === "learn" ? "📚" : "👥"}</span>
                    <div>
                      <div style={{ fontSize: 10, color: "#e2e8f0" }}>{r.desc}</div>
                      <div style={{ fontSize: 8, color: "#314e6a" }}>{r.time}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#00e5a0", fontWeight: 700 }}>+{r.pts}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ PAYMENT TAB ═══ */}
        {activeTab === "payment" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ background: "linear-gradient(135deg,#0d1929,#0a1322)", border: "1px solid #1e3a5f", borderRadius: 14, padding: 20, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 4 }}>CASH BALANCE</div>
                <div style={{ fontSize: 26, color: "#38bdf8", fontWeight: 900, fontFamily: "'Orbitron',sans-serif" }}>${portfolio.cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 8, color: "#314e6a", marginBottom: 4 }}>PORTFOLIO</div>
                <div style={{ fontSize: 14, color: "#00e5a0", fontWeight: 700 }}>${portfolioValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
              </div>
            </div>
            <div style={{ display: "flex", marginBottom: 16, background: "#0a0d16", borderRadius: 8, padding: 3, border: "1px solid #111d2e" }}>
              {[["deposit", "💳 Deposit"], ["manage", "🏦 Manage Cards"]].map(([k, l]) => (
                <button key={k} onClick={() => setPayTab(k)} style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", background: payTab === k ? "#1e3a5f" : "transparent", color: payTab === k ? "#e2e8f0" : "#475569", fontSize: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: payTab === k ? 700 : 400 }}>{l}</button>
              ))}
            </div>
            {payTab === "deposit" && (
              <div>
                <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>PAYMENT METHOD</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                    {[["card", "💳 Card"], ["upi", "📱 UPI"], ["netbank", "🏦 Net Banking"], ["crypto", "₿ Crypto"]].map(([k, l]) => (
                      <button key={k} onClick={() => setPayMode(k)} style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: "1px solid " + (payMode === k ? "#00e5a044" : "#1e3a5f"), background: payMode === k ? "#00e5a015" : "transparent", color: payMode === k ? "#00e5a0" : "#475569", fontSize: 9, cursor: "pointer", fontFamily: "inherit", fontWeight: payMode === k ? 700 : 400 }}>{l}</button>
                    ))}
                  </div>
                  {payMode === "card" && (
                    <div>
                      {savedCards.map(card => (
                        <div key={card.id} onClick={() => setSelectedCard(card.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, border: "1px solid " + (selectedCard === card.id ? "#00e5a044" : "#1e3a5f"), background: selectedCard === card.id ? "#00e5a008" : "#060a12", marginBottom: 8, cursor: "pointer" }}>
                          <div style={{ width: 40, height: 26, background: card.type === "Visa" ? "linear-gradient(135deg,#1a1fa8,#2d35cc)" : "linear-gradient(135deg,#8b1a1a,#cc2d2d)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#fff", fontWeight: 700 }}>{card.type.slice(0, 4)}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: "#e2e8f0" }}>•••• {card.last4}</div>
                            <div style={{ fontSize: 8, color: "#475569" }}>{card.name} · {card.expiry}</div>
                          </div>
                          {selectedCard === card.id && <span style={{ color: "#00e5a0" }}>✓</span>}
                        </div>
                      ))}
                      <button onClick={() => showToast("Add card coming soon!", "info")} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px dashed #1e3a5f", background: "transparent", color: "#314e6a", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>+ Add New Card</button>
                    </div>
                  )}
                  {payMode === "upi" && (
                    <div>
                      <input value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="yourname@upi" style={{ width: "100%", background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 6, padding: "10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", marginBottom: 8 }} />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["GPay", "PhonePe", "Paytm", "BHIM"].map(app => (
                          <button key={app} onClick={() => setUpiId("user@" + app.toLowerCase())} style={{ padding: "5px 12px", borderRadius: 20, border: "1px solid #1e3a5f", background: "#060a12", color: "#64748b", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>{app}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {payMode === "netbank" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank", "Kotak", "Yes Bank"].map(b => (
                        <button key={b} onClick={() => { showToast("Redirecting to " + b + "...", "info"); vibrateShort(); }} style={{ padding: "10px 8px", borderRadius: 8, border: "1px solid #1e3a5f", background: "#060a12", color: "#64748b", fontSize: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>🏦 {b}</button>
                      ))}
                    </div>
                  )}
                  {payMode === "crypto" && (
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <div style={{ background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 9, color: "#f59e0b", wordBreak: "break-all", marginBottom: 8 }}>0x742d35Cc6634C0532925a3b8D4C9E0f4b0b6e5D7</div>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        {["BTC", "ETH", "USDT", "USDC"].map(c => (
                          <button key={c} onClick={() => showToast(c + " address copied!", "success")} style={{ padding: "5px 12px", borderRadius: 20, border: "1px solid #f59e0b44", background: "#f59e0b11", color: "#f59e0b", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>{c}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 8 }}>DEPOSIT AMOUNT</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {["500", "1000", "5000", "10000"].map(a => (
                      <button key={a} onClick={() => setDepositAmount(a)} style={{ flex: 1, padding: "7px 4px", borderRadius: 6, border: "1px solid " + (depositAmount === a ? "#38bdf844" : "#1e3a5f"), background: depositAmount === a ? "#38bdf815" : "transparent", color: depositAmount === a ? "#38bdf8" : "#475569", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>${a}</button>
                    ))}
                  </div>
                  <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="Custom amount" style={{ width: "100%", background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 6, padding: "10px", color: "#e2e8f0", fontSize: 14, fontFamily: "inherit", textAlign: "center", fontWeight: 700 }} />
                </div>
                <button onClick={handleDeposit} disabled={depositLoading} style={{ width: "100%", padding: 14, background: depositLoading ? "#0a0d16" : "linear-gradient(135deg,#38bdf8,#0284c7)", border: "none", borderRadius: 10, color: depositLoading ? "#314e6a" : "#fff", fontSize: 13, fontWeight: 900, cursor: depositLoading ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: 1 }}>
                  {depositLoading ? "⚡ Processing..." : "💳 DEPOSIT $" + parseFloat(depositAmount || 0).toLocaleString()}
                </button>
              </div>
            )}
            {payTab === "manage" && (
              <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 12 }}>SAVED PAYMENT METHODS</div>
                {savedCards.map(card => (
                  <div key={card.id} style={{ display: "flex", gap: 12, padding: 14, borderRadius: 10, border: "1px solid #1e3a5f", background: "#060a12", marginBottom: 10, alignItems: "center" }}>
                    <div style={{ width: 50, height: 32, background: card.type === "Visa" ? "linear-gradient(135deg,#1a1fa8,#2d35cc)" : "linear-gradient(135deg,#8b1a1a,#cc2d2d)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>{card.type}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>•••• {card.last4}</div>
                      <div style={{ fontSize: 9, color: "#475569" }}>{card.name} · Exp {card.expiry}</div>
                    </div>
                    <button onClick={() => setSavedCards(c => c.filter(x => x.id !== card.id))} style={{ background: "none", border: "none", color: "#ff4d6d66", fontSize: 18, cursor: "pointer" }}>🗑</button>
                  </div>
                ))}
                <button onClick={() => showToast("Add card coming soon!", "info")} style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px dashed #1e3a5f", background: "transparent", color: "#38bdf8", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>+ Add New Payment Method</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ WITHDRAW TAB ═══ */}
        {activeTab === "withdraw" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <div style={{ background: "linear-gradient(135deg,#0d2215,#0a1a0e)", border: "1px solid #00e5a033", borderRadius: 14, padding: 20, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 8, color: "#314e6a", letterSpacing: 2, marginBottom: 4 }}>WITHDRAWABLE CASH</div>
                <div style={{ fontSize: 26, color: "#00e5a0", fontWeight: 900, fontFamily: "'Orbitron',sans-serif" }}>${portfolio.cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>Available now · Zero fees</div>
              </div>
              <div style={{ fontSize: 36 }}>💸</div>
            </div>
            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>WITHDRAW TO</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {[["bank", "🏦 Bank"], ["upi", "📱 UPI"], ["card", "💳 Card"]].map(([k, l]) => (
                  <button key={k} onClick={() => setWithdrawTo(k)} style={{ flex: 1, padding: "10px 6px", borderRadius: 8, border: "1px solid " + (withdrawTo === k ? "#00e5a044" : "#1e3a5f"), background: withdrawTo === k ? "#00e5a015" : "transparent", color: withdrawTo === k ? "#00e5a0" : "#475569", fontSize: 9, cursor: "pointer", fontFamily: "inherit", fontWeight: withdrawTo === k ? 700 : 400 }}>{l}</button>
                ))}
              </div>
              {withdrawTo === "bank" && (
                <div style={{ background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: "#314e6a" }}>LINKED ACCOUNT</span>
                    <span style={{ fontSize: 8, color: "#00e5a0" }}>✓ Verified</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>HDFC Bank</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>John Trader · ****4523</div>
                  <div style={{ marginTop: 8, padding: "5px 10px", background: "#00e5a008", border: "1px solid #00e5a022", borderRadius: 6, fontSize: 9, color: "#00e5a0" }}>⚡ Instant transfer · 24/7</div>
                </div>
              )}
              {withdrawTo === "upi" && (
                <input value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="Enter UPI ID" style={{ width: "100%", background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 6, padding: "10px", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit" }} />
              )}
              {withdrawTo === "card" && (
                <div style={{ display: "flex", gap: 8 }}>
                  {savedCards.map(card => (
                    <div key={card.id} onClick={() => setSelectedCard(card.id)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid " + (selectedCard === card.id ? "#00e5a044" : "#1e3a5f"), background: "#060a12", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 700 }}>•••• {card.last4}</div>
                      <div style={{ fontSize: 8, color: "#475569" }}>{card.type}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 8 }}>AMOUNT</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {["250", "500", "1000", "5000"].map(a => (
                  <button key={a} onClick={() => setWithdrawAmount(a)} style={{ flex: 1, padding: "7px 4px", borderRadius: 6, border: "1px solid " + (withdrawAmount === a ? "#00e5a044" : "#1e3a5f"), background: withdrawAmount === a ? "#00e5a015" : "transparent", color: withdrawAmount === a ? "#00e5a0" : "#475569", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>${a}</button>
                ))}
                <button onClick={() => setWithdrawAmount(Math.floor(portfolio.cash).toString())} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #f59e0b44", background: "#f59e0b11", color: "#f59e0b", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>Max</button>
              </div>
              <input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} style={{ width: "100%", background: "#060a12", border: "1px solid #1e3a5f", borderRadius: 6, padding: 12, color: "#00e5a0", fontSize: 22, fontFamily: "'Orbitron',sans-serif", textAlign: "center", fontWeight: 900 }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9, color: "#475569" }}>
                <span>Min: $50</span><span>Fee: FREE</span><span>Receive: <span style={{ color: "#00e5a0", fontWeight: 700 }}>${parseFloat(withdrawAmount || 0).toLocaleString()}</span></span>
              </div>
            </div>
            <button onClick={handleWithdraw} disabled={withdrawLoading} style={{ width: "100%", padding: 14, background: withdrawLoading ? "#0a0d16" : "linear-gradient(135deg,#00e5a0,#00b37d)", border: "none", borderRadius: 10, color: withdrawLoading ? "#314e6a" : "#060a12", fontSize: 13, fontWeight: 900, cursor: withdrawLoading ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: 1, marginBottom: 16 }}>
              {withdrawLoading ? "⚡ Processing..." : "💸 WITHDRAW $" + parseFloat(withdrawAmount || 0).toLocaleString()}
            </button>
            <div style={{ background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>WITHDRAWAL HISTORY</div>
              {withdrawHistory.map((w, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #0a0f1e" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: w.status === "success" ? "#00e5a015" : "#f59e0b15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{w.status === "success" ? "✅" : "⏳"}</div>
                    <div>
                      <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>to {w.to}</div>
                      <div style={{ fontSize: 8, color: "#475569" }}>{w.time}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "#00e5a0", fontWeight: 700 }}>-${w.amount.toLocaleString()}</div>
                    <div style={{ fontSize: 8, color: w.status === "success" ? "#00e5a066" : "#f59e0b", textTransform: "capitalize" }}>{w.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ GALLERY TAB ═══ */}
        {activeTab === "gallery" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20, position: "relative" }}>
            {galleryView && (
              <div onClick={() => setGalleryView(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)", zIndex: 9990, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", backdropFilter: "blur(6px)" }}>
                <div onClick={e => e.stopPropagation()} style={{ maxWidth: "88vw", maxHeight: "85vh", position: "relative" }}>
                  <img src={galleryView.url.replace("w=400", "w=900")} alt={galleryView.title} style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 12, border: "1px solid #1e3a5f" }} />
                  <div style={{ textAlign: "center", marginTop: 12 }}>
                    <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>{galleryView.title}</div>
                    <div style={{ fontSize: 9, color: "#475569", marginTop: 3 }}>{galleryView.tag}</div>
                  </div>
                  <button onClick={() => setGalleryView(null)} style={{ position: "absolute", top: -12, right: -12, width: 28, height: 28, borderRadius: "50%", background: "#ff4d6d", border: "none", color: "#fff", fontSize: 14, cursor: "pointer", fontWeight: 700 }}>✕</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 10, color: "#314e6a", letterSpacing: 2 }}>🖼 MARKET GALLERY</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {["All", "Market", "Tech", "Exchange", "Finance", "Analysis", "Crypto"].map(f => (
                  <button key={f} onClick={() => setGalleryFilter(f)} style={{ padding: "4px 10px", borderRadius: 20, border: "1px solid " + (galleryFilter === f ? "#00e5a044" : "#111d2e"), background: galleryFilter === f ? "#00e5a015" : "transparent", color: galleryFilter === f ? "#00e5a0" : "#314e6a", fontSize: 8, cursor: "pointer", fontFamily: "inherit" }}>{f}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12 }}>
              {GALLERY_IMAGES.filter(img => galleryFilter === "All" || img.tag === galleryFilter).map(img => (
                <div key={img.id} onClick={() => { setGalleryView(img); vibrateShort(); }}
                  style={{ borderRadius: 10, overflow: "hidden", cursor: "zoom-in", border: "1px solid #111d2e", background: "#0a0d16", transition: "transform 0.2s, box-shadow 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 0 20px #00e5a022"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ position: "relative" }}>
                    <img src={img.url} alt={img.title} style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }} onError={e => { e.target.style.display = "none"; }} />
                    <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.7)", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🔍</div>
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600, marginBottom: 3 }}>{img.title}</div>
                    <span style={{ fontSize: 8, color: "#00e5a0", background: "#00e5a011", padding: "2px 7px", borderRadius: 8 }}>{img.tag}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, background: "#0a0d16", border: "1px solid #111d2e", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 9, color: "#314e6a", letterSpacing: 2, marginBottom: 10 }}>📤 UPLOAD CHART SCREENSHOT</div>
              <div style={{ border: "2px dashed #1e3a5f", borderRadius: 8, padding: 22, textAlign: "center", cursor: "pointer" }} onClick={() => showToast("Upload coming soon!", "info")}>
                <div style={{ fontSize: 26, marginBottom: 6 }}>📁</div>
                <div style={{ fontSize: 10, color: "#475569" }}>Click to upload PNG / JPG</div>
                <div style={{ fontSize: 8, color: "#314e6a", marginTop: 3 }}>Share your winning trades!</div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Status bar */}
      <div style={{ background: "#050810", borderTop: "1px solid #0f1d30", padding: "3px 16px", display: "flex", gap: 16, alignItems: "center", fontSize: 8, color: "#1e3a5f" }}>
        <span>QuantRL Pro v5.0</span>
        <span>|</span>
        <span style={{ color: "#00e5a0" }}>● WebSocket LIVE</span>
        <span>|</span>
        <span>🔐 OTP 2FA Active</span>
        <span>|</span>
        <span>📳 Haptic Feedback</span>
        <span>|</span>
        <span>Engine: PPO + AI</span>
        <span>|</span>
        <span>Stocks: {stocks.length} | Trades: {trades.length} | Episodes: {agentEpisode}</span>
        <span style={{ marginLeft: "auto" }}>{new Date().toLocaleString()}</span>
      </div>
    </div>
  );
}
