import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const JUPITER_REFERRAL_KEY = 'E2yVdtMKBX8c7nNwks2mJ8gXpVrEMf2gkrXLz5oaDzQX';
const JUPITER_FEE_BPS = 30;

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'ETH', decimals: 8 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
];

function fmt(n, d) {
  d = d || 2;
  if (n == null) return '--';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (!n && n !== 0) return '--';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function TokenSelect({ selected, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: C.card3, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
      }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 10 }}>v</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 200,
          background: C.card, border: '1px solid ' + C.borderHi,
          borderRadius: 14, width: 200, boxShadow: '0 20px 60px rgba(0,0,0,.6)'
        }}>
          {TOKENS.map(t => (
            <div key={t.mint} onClick={() => { onSelect(t); setOpen(false); }}
              style={{ padding: '12px 16px', cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 600 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{t.symbol}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SwapWidget({ coins }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [slip, setSlip] = useState(0.5);
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [selectedChart, setSelectedChart] = useState('bitcoin');

  const fetchQuote = useCallback(async () => {
    if (!fromAmt || parseFloat(fromAmt) <= 0) return;
    setQuoteLoading(true);
    try {
      const amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
      const params = new URLSearchParams({
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amount: amount.toString(),
        slippageBps: Math.round(slip * 100).toString(),
        platformFeeBps: JUPITER_FEE_BPS.toString(),
      });
      const res = await fetch('https://quote-api.jup.ag/v6/quote?' + params);
      const data = await res.json();
      if (data.outAmount) {
        setQuote({
          outAmount: data.outAmount,
          outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: data.priceImpactPct,
          quoteResponse: data,
        });
      }
    } catch (e) {
      console.error('Quote error:', e);
    }
    setQuoteLoading(false);
  }, [fromAmt, fromToken, toToken, slip]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, 600);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  useEffect(() => {
    const fetchChart = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/coins/' + selectedChart + '/market_chart?vs_currency=u​​​​​​​​​​​​​​​​
