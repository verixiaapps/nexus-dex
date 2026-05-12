import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey } from '@solana/web3.js';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SPL_LEGACY_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_TOKEN2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  if (n > 0) return '$' + n.toFixed(6);
  return '$0.00';
}

function fmtTokenAmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n > 0) return n.toFixed(6);
  return '0';
}

function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}

function tokenAmountForOne(decimals) {
  const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 6;
  return String(Math.round(10 ** Math.min(Math.max(d, 0), 12)));
}

function openTokenPage(token, onSelectCoin) {
  if (!token || !onSelectCoin) return;

  const mint = token.mint || token.address || token.tokenAddress || token.id;
  if (!mint) return;

  onSelectCoin({
    id: mint,
    mint,
    address: mint,
    tokenAddress: mint,
    symbol: token.symbol || mint.slice(0, 4) + '...',
    name: token.name || token.symbol || mint.slice(0, 4) + '...',
    chain: 'solana',
    decimals: token.decimals,
    price: token.price,
    value: token.value,
    uiAmount: token.uiAmount,
  });
}

const _priceCache = {};

function clearPriceCache() {
  Object.keys(_priceCache).forEach(k => delete _priceCache[k]);
}

function readOkxToTokenAmount(data) {
  const d = Array.isArray(data) ? data[0] : data;
  return Number(
    d?.toTokenAmount ||
    d?.routerResult?.toTokenAmount ||
    d?.quoteCompareList?.[0]?.toTokenAmount ||
    0
  );
}

async function fetchOkxPrice(mint, decimals = 6, force = false) {
  if (!mint) return 0;
  const key = `${String(mint).toLowerCase()}:${decimals}`;
  if (!force && _priceCache[key] && Date.now() - _priceCache[key].ts < 60000) {
    return _priceCache[key].price;
  }

  try {
    const amount = mint === SOL_MINT ? '1000000000' : tokenAmountForOne(decimals);
    const r = await fetch(
      `/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${mint}&toTokenAddress=${USDC_SOLANA}&amount=${amount}`
    );
    const j = await r.json();

    if (j.code === '0' && j.data) {
      const toTokenAmount = readOkxToTokenAmount(j.data);
      const price = toTokenAmount / 1e6;

      if (price > 0 && Number.isFinite(price)) {
        _priceCache[key] = { price, ts: Date.now() };
        return price;
      }
    }
  } catch {}

  return 0;
}

export default function Portfolio({ onSelectCoin, onSend, onConnectWallet }) {
  const { publicKey: extPk, connected: solCon } = useWallet();
  const { connection } = useConnection();
  const { privyEmbeddedSol } = useNexusWallet();

  const pubkey = useMemo(() => {
    if (extPk) return extPk;
    if (privyEmbeddedSol?.address) {
      try {
        return new PublicKey(privyEmbeddedSol.address);
      } catch {
        return null;
      }
    }
    return null;
  }, [extPk, privyEmbeddedSol?.address]);

  const hasSol = !!(solCon || (privyEmbeddedSol && pubkey));

  const [solBalance, setSolBalance] = useState(0);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [solBalances, setSolBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchPortfolio = useCallback(async (force = false) => {
    if (!pubkey || !connection) {
      setLoading(false);
      return;
    }

    if (force) clearPriceCache();

    setLoading(true);
    setRefreshing(true);
    setError('');

    try {
      const lamports = await connection.getBalance(pubkey);
      const nextSolBalance = lamports / 1e9;
      setSolBalance(nextSolBalance);

      const solPrice = await fetchOkxPrice(SOL_MINT, 9, force);
      setSolPriceUsd(solPrice > 0 ? solPrice : 0);

      const results = await Promise.allSettled([
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_LEGACY_PROGRAM }),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN2022_PROGRAM }),
      ]);

      let allAccounts = [];
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value?.value) {
          allAccounts = allAccounts.concat(r.value.value);
        }
      });

      const byMint = {};
      allAccounts.forEach(acc => {
        try {
          const info = acc.account.data.parsed.info;
          const ta = info.tokenAmount || {};
          const ui = Number(ta.uiAmountString || ta.uiAmount || 0);
          const mint = info.mint;

          if (!mint || !Number.isFinite(ui) || ui <= 0.000001) return;

          if (!byMint[mint]) {
            byMint[mint] = {
              mint,
              uiAmount: 0,
              decimals: Number.isFinite(Number(ta.decimals)) ? Number(ta.decimals) : 6,
            };
          }

          byMint[mint].uiAmount += ui;
        } catch {}
      });

      let holdings = Object.values(byMint).filter(h => h.mint !== SOL_MINT);
      const priced = [];

      for (const h of holdings) {
        const price = await fetchOkxPrice(h.mint, h.decimals, force);
        const value = h.uiAmount * price;

        priced.push({
          ...h,
          price: price > 0 && Number.isFinite(price) ? price : 0,
          value: value > 0 && Number.isFinite(value) ? value : 0,
          symbol: h.mint.slice(0, 4) + '...',
          name: '',
        });
      }

      priced.sort((a, b) => b.value - a.value);
      setSolBalances(priced);
    } catch (e) {
      setError('Failed to load portfolio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pubkey, connection]);

  useEffect(() => {
    if (!pubkey || !connection) {
      setLoading(false);
      return undefined;
    }

    fetchPortfolio(false);

    const i = setInterval(() => {
      fetchPortfolio(false);
    }, 30000);

    return () => clearInterval(i);
  }, [pubkey, connection, fetchPortfolio]);

  const handleRefresh = useCallback(() => {
    fetchPortfolio(true);
  }, [fetchPortfolio]);

  const solValue = solBalance * solPriceUsd;
  const tokensTotal = solBalances.reduce((s, h) => s + (h.value || 0), 0);
  const totalValue = solValue + tokensTotal;
  const displayAddr = pubkey ? pubkey.toString() : null;

  if (!hasSol) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12 }}>Solana wallet balances via OKX</p>
        </div>

        <div style={{ textAlign: 'center', padding: '50px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Connect your Solana wallet to view balances.</p>
          <button
            onClick={() => onConnectWallet?.()}
            style={{
              background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
              border: 'none',
              borderRadius: 10,
              padding: '12px 28px',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'Syne, sans-serif',
            }}
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12 }}>Solana &middot; OKX prices &middot; auto-refresh 30s</p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: 'rgba(0,229,255,.08)',
            border: '1px solid rgba(0,229,255,.2)',
            borderRadius: 8,
            padding: '7px 14px',
            color: C.accent,
            fontSize: 12,
            cursor: refreshing ? 'not-allowed' : 'pointer',
            opacity: refreshing ? 0.65 : 1,
            fontFamily: 'Syne, sans-serif',
            fontWeight: 600,
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div style={{ background: 'linear-gradient(135deg,rgba(0,229,255,.08),rgba(0,85,255,.04))', border: '1px solid ' + C.borderHi, borderRadius: 18, padding: 20, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 4 }}>TOTAL PORTFOLIO VALUE</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{fmt(totalValue)}</div>
        </div>

        <button
          onClick={() => onSend && onSend()}
          disabled={!onSend}
          style={{
            background: onSend ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.04)',
            border: 'none',
            borderRadius: 12,
            padding: '14px 22px',
            color: onSend ? '#03060f' : C.muted,
            fontSize: 14,
            fontWeight: 800,
            cursor: onSend ? 'pointer' : 'not-allowed',
            fontFamily: 'Syne, sans-serif',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 48,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Send
        </button>
      </div>

      <div style={{ background: C.card, border: '1px solid rgba(153,69,255,.2)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#9945ff' }}>
            S
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>SOLANA</div>
            <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace' }}>{shortAddr(displayAddr)}</div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: C.muted }}>{solBalance.toFixed(4)} SOL</div>
          <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>{fmt(totalValue)}</div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>SOLANA TOKENS</div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
          <div>TOKEN</div>
          <div style={{ textAlign: 'right' }}>BALANCE</div>
          <div style={{ textAlign: 'right' }}>PRICE</div>
          <div style={{ textAlign: 'right' }}>VALUE</div>
        </div>

        <div
          onClick={() => openTokenPage({ mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, price: solPriceUsd, value: solValue, uiAmount: solBalance }, onSelectCoin)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              openTokenPage({ mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, price: solPriceUsd, value: solValue, uiAmount: solBalance }, onSelectCoin);
            }
          }}
          style={{
            padding: '12px 16px',
            display: 'grid',
            gridTemplateColumns: '1fr 80px 80px 90px',
            gap: 8,
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,.025)',
            cursor: onSelectCoin ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'rgba(0,229,255,.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>
              S
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div>
              <div style={{ color: C.muted, fontSize: 10 }}>Solana</div>
            </div>
          </div>
          <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solBalance.toFixed(4)}</div>
          <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solPriceUsd > 0 ? fmt(solPriceUsd) : '-'}</div>
          <div style={{ textAlign: 'right', color: solValue > 0 ? C.green : C.muted, fontSize: 13, fontWeight: 600 }}>{solValue > 0 ? fmt(solValue) : '-'}</div>
        </div>

        {loading && !solBalances.length ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading tokens...</div>
        ) : !solBalances.length ? (
          <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 12 }}>No SPL tokens found</div>
        ) : solBalances.map(token => {
          const val = token.value || 0;
          const symbol = token.symbol || token.mint.slice(0, 4) + '...';

          return (
            <div
              key={token.mint}
              onClick={() => openTokenPage(token, onSelectCoin)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') openTokenPage(token, onSelectCoin);
              }}
              style={{
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: '1fr 80px 80px 90px',
                gap: 8,
                alignItems: 'center',
                borderBottom: '1px solid rgba(255,255,255,.025)',
                cursor: onSelectCoin ? 'pointer' : 'default',
                WebkitTapHighlightColor: 'rgba(0,229,255,.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                  {symbol.charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{symbol}</div>
                  <div style={{ color: C.muted, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{shortAddr(token.mint)}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmtTokenAmt(token.uiAmount)}</div>
              <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{token.price > 0 ? fmt(token.price) : '-'}</div>
              <div style={{ textAlign: 'right', color: val > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{val > 0 ? fmt(val) : '-'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}