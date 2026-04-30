import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, TransactionMessage, AddressLookupTableAccount, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Buffer } from 'buffer';
 
const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.04;
const ANTIMEV_FEE = 0.02;
const SPREAD = 0.005;
const JUP_API_KEY = process.env.REACT_APP_JUPITER_API_KEY1 || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PRESET_KEY = 'nexus_launch_presets';
const LAST_AMT_KEY = 'nexus_launch_last_amt';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  down: '#3b9eff', orange: '#ff9500', purple: '#9945ff',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function loadCachedTokens() {
  try {
    const v = localStorage.getItem('nexus_launch_cache');
    if (!v) return [];
    const parsed = JSON.parse(v);
    if (Date.now() - (parsed.ts || 0) > 300000) return [];
    return parsed.tokens || [];
  } catch (e) { return []; }
}

function saveCachedTokens(tokens) {
  try {
    localStorage.setItem('nexus_launch_cache', JSON.stringify({ ts: Date.now(), tokens: tokens.slice(0, 30) }));
  } catch (e) {}
}

function loadPresets() {
  try {
    const v = localStorage.getItem(PRESET_KEY);
    return v ? JSON.parse(v) : [5, 10, 25, 50, 100];
  } catch (e) { return [5, 10, 25, 50, 100]; }
}

function savePresets(arr) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) {} }
function loadLastAmt() { try { return parseFloat(localStorage.getItem(LAST_AMT_KEY) || '25') || 25; } catch (e) { return 25; } }
function saveLastAmt(v) { try { localStorage.setItem(LAST_AMT_KEY, String(v)); } catch (e) {} }

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  return Math.floor(diff / 3600) + 'h';
}

function fmtMc(n) {
  if (!n) return '–';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPrice(n) {
  if (!n || n === 0) return '–';
  if (n < 0.000001) return '$' + n.toExponential(2);
  if (n < 0.001) return '$' + n.toFixed(7);
  if (n < 1) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return null;
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function pctColor(n) {
  if (n == null) return C.muted2;
  return n >= 0 ? C.green : C.down;
}

async function sendFee(publicKey, sendTransaction, connection, dollarAmt, solPrice, totalFeeRate) {
  if (!publicKey) return;
  try {
    const feeSol = dollarAmt > 0 ? (dollarAmt * (totalFeeRate + SPREAD)) / solPrice : 0;
    const feeLamports = Math.round(Math.max(feeSol * LAMPORTS_PER_SOL, 50000));
    const lb = await connection.getLatestBlockhash('finalized');
    const feeTx = new Transaction();
    feeTx.recentBlockhash = lb.blockhash;
    feeTx.lastValidBlockHeight = lb.lastValidBlockHeight;
    feeTx.feePayer = publicKey;
    feeTx.add(SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: new PublicKey(FEE_WALLET),
      lamports: feeLamports,
    }));
    const feeSig = await sendTransaction(feeTx, connection);
    console.log('Fee sent:', feeSig, 'lamports:', feeLamports);
  } catch (e) { console.error('Fee tx error:', e); }
}

async function fetchGeckoTerminal(mints) {
  if (!mints || !mints.length) return {};
  try {
    const chunks = [];
    for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
    const results = await Promise.all(chunks.map(chunk =>
      fetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/' + chunk.join(','))
        .then(r => r.json()).catch(() => ({ data: [] }))
    ));
    const out = {};
    results.forEach(res => {
      if (!res.data) return;
      res.data.forEach(item => {
        const attrs = item.attributes;
        if (!attrs) return;
        const addr = attrs.address;
        if (!addr) return;
        const price = parseFloat(attrs.price_usd || 0);
        const pChange = attrs.price_change_percentage || {};
        out[addr] = {
          price,
          marketCap: parseFloat(attrs.fdv_usd || attrs.market_cap_usd || 0),
          pct5m: pChange.m5 ? parseFloat(pChange.m5) : null,
          pct1h: pChange.h1 ? parseFloat(pChange.h1) : null,
          pct24h: pChange.h24 ? parseFloat(pChange.h24) : null,
          volume24h: parseFloat(attrs.volume_usd?.h24 || 0),
          buys24h: attrs.transactions?.h24?.buys || 0,
          image: attrs.image_url || null,
          name: attrs.name || null,
          symbol: attrs.symbol || null,
          graduated: true,
          priceHistory: price > 0 ? [price] : [],
        };
      });
    });
    return out;
  } catch (e) { return {}; }
}

const fetchDexScreener = mints => fetchGeckoTerminal(mints);
const fetchJupiterPrices = mints => fetchGeckoTerminal(mints);
const fetchTokenData = mints => fetchGeckoTerminal(mints);

function Sparkline({ history, up }) {
  if (!history || history.length < 2) return <div style={{ width: 64, height: 28 }} />;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || min * 0.01 || 1;
  const w = 64, h = 28;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const color = up == null ? C.muted2 : up ? C.green : C.down;
  return (
    <svg width={w} height={h} style={{ overflow: 'hidden', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PresetEditor({ open, onClose, presets, onSave }) {
  const [vals, setVals] = useState(presets.map(String));
  useEffect(() => { if (open) setVals(presets.map(String)); }, [open, presets]);
  if (!open) return null;
  return (
    <div>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.8)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, padding: 24, width: '90vw', maxWidth: 360, boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Edit Quick Buy Presets</div>
        <div style={{ color: C.muted, fontSize: 11, marginBottom: 18 }}>Set your 5 saved quick-buy amounts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {vals.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 12, width: 56, flexShrink: 0 }}>Slot {i + 1}</span>
              <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.muted }}>$</span>
                <input
                  value={v}
                  onChange={e => {
                    const nv = e.target.value.replace(/[^0-9.]/g, '');
                    setVals(prev => { const n = [...prev]; n[i] = nv; return n; });
                  }}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, outline: 'none', width: '100%' }}
                />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, background: C.card2, border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={() => {
              let parsed = vals.map(v => parseFloat(v) || 0).filter(v => v > 0);
              while (parsed.length < 5) parsed.push(25);
              onSave(parsed.slice(0, 5));
              onClose();
            }}
            style={{ flex: 2, padding: 12, borderRadius: 10, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}
          >Save Presets</button>
        </div>
      </div>
    </div>
  );
}

function TradeDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, isSolanaConnected, presets, onPresetsChange }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [activePreset, setActivePreset] = useState(null);
  const [customAmt, setCustomAmt] = useState('');
  const [sellPct, setSellPct] = useState(50);
  const [customSellAmt, setCustomSellAmt] = useState('');
  const [solBalance, setSolBalance] = useState(null);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [antiMev, setAntiMev] = useState(true);
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);

  useEffect(() => {
    if (!publicKey || !connection || !open) { setSolBalance(null); setTokenBalance(null); return; }
    connection.getBalance(publicKey).then(lam => setSolBalance(lam / 1e9)).catch(() => {});
    if (token?.mint) {
      connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(token.mint) })
        .then(accts => setTokenBalance(accts.value.length > 0 ? accts.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0))
        .catch(() => {});
    }
  }, [publicKey, connection, token, open]);

  const totalFeeRate = BASE_FEE + (antiMev ? ANTIMEV_FEE : 0);

  useEffect(() => {
    if (open) {
      const last = loadLastAmt();
      const match = presets.find(p => p === last);
      if (match) { setActivePreset(last); setCustomAmt(''); }
      else { setActivePreset(null); setCustomAmt(String(last)); }
      setStatus('idle'); setTxSig(null); setError(''); setCustomSellAmt('');
    }
  }, [open, presets]);

  const activeDollar = parseFloat(customAmt) || activePreset || loadLastAmt();
  const solAmt = solPrice > 0 ? activeDollar / solPrice : 0;

  const deserializeIx = ix => ({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });

  const executeTrade = async () => {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!publicKey) { setError('Please connect a wallet'); return; }
    if (!token) return;
    setStatus('loading'); setError('');
    const isGrad = token.graduated;
    try {
      try {
        const solBal = (await connection.getBalance(publicKey)) / 1e9;
        if (solBal < 0.003) {
          setError('Insufficient SOL. Need at least 0.003 SOL for fees and gas.');
          setStatus('error');
          setTimeout(() => { setStatus('idle'); setError(''); }, 6000);
          return;
        }
      } catch (_e) {}

      if (!isGrad) {
        const res = await fetch('https://pumpportal.fun/api/trade-local', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicKey: publicKey.toString(), action: mode, mint: token.mint,
            denominatedInSol: mode === 'buy' ? 'true' : 'false',
            amount: mode === 'buy' ? parseFloat(solAmt.toFixed(6)) : (sellPct + '%'),
            slippage: 15, priorityFee: antiMev ? 0.001 : 0.0001, pool: 'auto',
          }),
        });
        if (!res.ok) throw new Error('PumpPortal error ' + res.status);
        const txBytes = await res.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        setTxSig(sig);
      } else {
        const inputMint = mode === 'buy' ? SOL_MINT : token.mint;
        const outputMint = mode === 'buy' ? token.mint : SOL_MINT;
        const amount = mode === 'buy'
          ? Math.round(solAmt * 1e9)
          : Math.round((sellPct / 100) * (token.userBalance || 1e6));

        const qRes = await fetch(
          `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=150&restrictIntermediateTokens=true`,
          { headers: { 'x-api-key': JUP_API_KEY } }
        );
        const qData = await qRes.json();
        if (!qData.outAmount) throw new Error(qData.error || 'No route');

        const feeLamports = Math.round(Math.max(
          activeDollar > 0
            ? (activeDollar * (totalFeeRate + SPREAD) / solPrice) * LAMPORTS_PER_SOL
            : solAmt * (totalFeeRate + SPREAD) * LAMPORTS_PER_SOL,
          50000
        ));

        const instrRes = await fetch('https://api.jup.ag/swap/v1/swap-instructions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': JUP_API_KEY },
          body: JSON.stringify({
            quoteResponse: qData, userPublicKey: publicKey.toString(),
            wrapAndUnwrapSol: true, computeUnitPriceMicroLamports: antiMev ? 50000 : 1000,
          }),
        });
        const instrData = await instrRes.json();

        let sig;
        if (instrData && instrData.swapInstruction && !instrData.error) {
          const ixs = [];
          instrData.computeBudgetInstructions?.forEach(ix => ixs.push(deserializeIx(ix)));
          instrData.setupInstructions?.forEach(ix => ixs.push(deserializeIx(ix)));
          ixs.push(deserializeIx(instrData.swapInstruction));
          if (instrData.cleanupInstruction) ixs.push(deserializeIx(instrData.cleanupInstruction));
          ixs.push(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(FEE_WALLET), lamports: feeLamports }));

          let luts = [];
          if (instrData.addressLookupTableAddresses?.length) {
            const lutKeys = instrData.addressLookupTableAddresses.map(a => new PublicKey(a));
            const lutInfos = await connection.getMultipleAccountsInfo(lutKeys);
            luts = lutInfos.reduce((acc, info, i) => {
              if (info) acc.push(new AddressLookupTableAccount({ key: lutKeys[i], state: AddressLookupTableAccount.deserialize(info.data) }));
              return acc;
            }, []);
          }

          const bh = await connection.getLatestBlockhash('confirmed');
          const msgV0 = new TransactionMessage({
            payerKey: publicKey, recentBlockhash: bh.blockhash, instructions: ixs,
          }).compileToV0Message(luts);
          sig = await sendTransaction(new VersionedTransaction(msgV0), connection);
          await connection.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
        } else {
          const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': JUP_API_KEY },
            body: JSON.stringify({ quoteResponse: qData, userPublicKey: publicKey.toString(), wrapAndUnwrapSol: true, computeUnitPriceMicroLamports: antiMev ? 50000 : 1000 }),
          });
          const swapData = await swapRes.json();
          if (!swapData.swapTransaction) throw new Error('No swap tx');
          sig = await sendTransaction(VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64')), connection);
          await connection.confirmTransaction(sig, 'confirmed');
          await sendFee(publicKey, sendTransaction, connection, activeDollar, solPrice, totalFeeRate);
        }
        setTxSig(sig);
      }

      saveLastAmt(activeDollar);
      setStatus('success');
      setTimeout(() => { setStatus('idle'); setTxSig(null); onClose(); }, 3000);
    } catch (e) {
      console.error('Trade error:', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setTimeout(() => { setStatus('idle'); setError(''); }, 4000);
    }
  };

  if (!open || !token) return null;
  const isBuy = mode === 'buy';

  return (
    <div>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', padding: '20px 20px 44px', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -20px 60px rgba(0,0,0,.9)' }}>
        <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 18px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {token.image
              ? <img src={token.image} alt={token.symbol} style={{ width: 38, height: 38, borderRadius: 10 }} onError={e => { e.target.style.display = 'none'; }} />
              : <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: C.purple, fontSize: 16 }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
            }
            <div>
              <div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 20 }}>{isBuy ? 'Buy' : 'Sell'} {token.symbol}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{token.graduated ? 'Jupiter swap' : 'Pump.fun'} - {(totalFeeRate * 100).toFixed(0)}% fee</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 28, cursor: 'pointer', padding: 0 }}>x</button>
        </div>

        <div style={{ background: C.card2, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: token.price > 0 ? 10 : 0 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>Current price</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{token.price > 0 ? fmtPrice(token.price) : 'Loading...'}</span>
              {token.pct1h != null && (
                <span style={{ fontSize: 13, fontWeight: 800, color: pctColor(token.pct1h), background: token.pct1h >= 0 ? 'rgba(0,255,163,.1)' : 'rgba(59,158,255,.1)', padding: '2px 8px', borderRadius: 6 }}>
                  {fmtPct(token.pct1h)} 1h
                </span>
              )}
            </div>
          </div>
          {isBuy && token.price > 0 && activeDollar > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.05)' }}>
              <span style={{ color: C.muted, fontSize: 12 }}>You receive approx</span>
              <span style={{ color: C.green, fontWeight: 800, fontSize: 15 }}>
                {((activeDollar * (1 - totalFeeRate)) / token.price).toLocaleString('en-US', { maximumFractionDigits: 0 })} {token.symbol}
              </span>
            </div>
          )}
          {!isBuy && token.price > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.05)' }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Selling {sellPct}% - fee {(totalFeeRate * 100).toFixed(0)}%</span>
              <span style={{ color: C.down, fontWeight: 700, fontSize: 13 }}>SOL credited to wallet</span>
            </div>
          )}
        </div>

        {!isConnected && (
          <div style={{ marginBottom: 14, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
            <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
          </div>
        )}

        {isBuy ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>QUICK BUY</span>
                {solBalance != null && (
                  <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>
                    SOL: <span style={{ color: C.text }}>{solBalance.toFixed(4)}</span>
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {solBalance != null && solBalance > 0.01 && (
                  <button
                    onClick={() => {
                      const max = Math.max(0, solBalance - 0.005);
                      setCustomAmt((max * solPrice).toFixed(2));
                      setActivePreset(null);
                    }}
                    style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '2px 8px', color: C.accent, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                  >MAX</button>
                )}
                <button onClick={() => setPresetEditorOpen(true)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, padding: 0 }}>Edit presets</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {presets.map(amt => {
                const active = activePreset === amt && !customAmt;
                return (
                  <button
                    key={amt}
                    onClick={() => { setActivePreset(amt); setCustomAmt(''); }}
                    style={{ flex: 1, padding: '12px 2px', borderRadius: 10, border: '1px solid ' + (active ? C.accent : C.border), background: active ? 'rgba(0,229,255,.15)' : C.card2, color: active ? C.accent : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
                  >${amt}</button>
                );
              })}
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + (customAmt ? C.accent : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 20, fontWeight: 600 }}>$</span>
              <input
                value={customAmt}
                onChange={e => { setCustomAmt(e.target.value.replace(/[^0-9.]/g, '')); setActivePreset(null); }}
                placeholder="Custom Amount"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }}
              />
              {solPrice > 0 && activeDollar > 0 && (
                <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>{(activeDollar / solPrice).toFixed(3)} SOL</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>SELL AMOUNT</span>
              {tokenBalance != null && (
                <span style={{ fontSize: 10, color: C.muted }}>
                  {token?.symbol}: <span style={{ color: C.text }}>{tokenBalance >= 1000 ? tokenBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : tokenBalance.toFixed(4)}</span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => { setSellPct(pct); setCustomSellAmt(''); }}
                  style={{ flex: 1, padding: '12px 2px', borderRadius: 10, border: '1px solid ' + (sellPct === pct && !customSellAmt ? C.red : C.border), background: sellPct === pct && !customSellAmt ? 'rgba(255,59,107,.15)' : C.card2, color: sellPct === pct && !customSellAmt ? C.red : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
                >{pct === 100 ? 'MAX' : pct + '%'}</button>
              ))}
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + (customSellAmt ? C.red : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                value={customSellAmt}
                onChange={e => { setCustomSellAmt(e.target.value.replace(/[^0-9.]/g, '')); setSellPct(null); }}
                placeholder="Custom Amount"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }}
              />
              <span style={{ color: C.muted, fontSize: 13, flexShrink: 0 }}>{token ? token.symbol : ''}</span>
              {tokenBalance != null && tokenBalance > 0 && (
                <button
                  onClick={() => { setCustomSellAmt(tokenBalance.toFixed(6)); setSellPct(null); }}
                  style={{ background: 'rgba(255,59,107,.12)', border: '1px solid rgba(255,59,107,.25)', borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >MAX</button>
              )}
            </div>
            {token && token.price > 0 && customSellAmt && parseFloat(customSellAmt) > 0 && (
              <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>
                approx ${(parseFloat(customSellAmt) * token.price).toFixed(4)} USD
              </div>
            )}
          </div>
        )}

        <div style={{ background: '#050912', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SNIPER PROTECTION</span>
            <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>
              {antiMev ? 'ON - Priority, bot protected (+1%)' : 'OFF - Standard speed (saves 1%)'}
            </div>
          </div>
          <button
            onClick={() => setAntiMev(!antiMev)}
            style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, position: 'relative', flexShrink: 0 }}
          >
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
          </button>
        </div>

        {!antiMev && (
          <div style={{ padding: '8px 12px', background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.2)', borderRadius: 8, fontSize: 11, color: C.orange, marginBottom: 14 }}>
            Warning: bots may front-run your trade
          </div>
        )}
        {error && (
          <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>
        )}

        <button
          onClick={executeTrade}
          disabled={status === 'loading'}
          style={{
            width: '100%', padding: 20, borderRadius: 14, border: 'none',
            background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : status === 'error' ? 'rgba(255,59,107,.2)'
              : !isConnected ? 'linear-gradient(135deg,#9945ff,#7c3aed)'
              : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
              : 'linear-gradient(135deg,#ff3b6b,#cc1144)',
            color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18,
            cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 58,
            boxShadow: status === 'idle' && isConnected
              ? (isBuy ? '0 0 24px rgba(0,229,255,.25)' : '0 0 24px rgba(255,59,107,.2)')
              : 'none',
          }}
        >
          {!isConnected ? 'Connect Wallet'
            : status === 'loading' ? 'Confirming...'
            : status === 'success' ? (isBuy ? 'Bought!' : 'Sold!') + ' Confirmed'
            : status === 'error' ? 'Failed - Try Again'
            : isBuy ? `Buy $${activeDollar.toFixed(2)} of ${token.symbol}`
            : `Sell ${sellPct}% of ${token.symbol}`}
        </button>

        {txSig && status === 'success' && (
          <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>
        )}
        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 10, lineHeight: 1.6 }}>Non-custodial - Fees go directly to Nexus DEX</p>
      </div>
      <PresetEditor open={presetEditorOpen} onClose={() => setPresetEditorOpen(false)} presets={presets} onSave={onPresetsChange} />
    </div>
  );
}

function TokenPage({ token, onBack, onConnectWallet, isConnected, isSolanaConnected, solPrice, presets, onPresetsChange }) {
  const [liveData, setLiveData] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchDexScreener([token.mint]).then(d => {
      if (d[token.mint]) setLiveData(d[token.mint]);
      setLoading(false);
    });
    const interval = setInterval(() => {
      fetchDexScreener([token.mint]).then(d => { if (d[token.mint]) setLiveData(d[token.mint]); });
    }, 10000);
    return () => clearInterval(interval);
  }, [token]);

  if (!token) return null;

  const price = liveData?.price || token.price || 0;
  const marketCap = liveData?.marketCap || token.marketCap || 0;
  const pct5m = liveData ? liveData.pct5m : token.pct5m;
  const pct1h = liveData ? liveData.pct1h : token.pct1h;
  const pct24h = liveData ? liveData.pct24h : token.pct24h;
  const volume = liveData?.volume24h || token.volume24h || 0;
  const buys = liveData?.buys24h || 0;
  const isGrad = liveData?.graduated || token.graduated || (token.bondingProgress || 0) >= 100;
  const progress = token.bondingProgress || 0;
  const history = token.priceHistory || [];
  const sparkUp = pct1h != null ? pct1h >= 0 : null;
  const fullToken = { ...token, ...(liveData || {}), graduated: isGrad, price };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', overscrollBehavior: 'none' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>
        Back to Launches
      </button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {token.image
              ? <img src={token.image} alt={token.symbol} style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
              : <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
            }
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 22 }}>{token.symbol}</span>
                {isGrad
                  ? <span style={{ background: 'rgba(0,255,163,.12)', color: C.green, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(0,255,163,.25)' }}>GRADUATED</span>
                  : <span style={{ background: 'rgba(153,69,255,.12)', color: C.purple, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(153,69,255,.25)' }}>PUMP.FUN</span>
                }
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>{token.name}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>{loading && !price ? '...' : fmtPrice(price)}</div>
            {pct1h != null && <div style={{ fontSize: 14, fontWeight: 700, color: pctColor(pct1h), marginTop: 3 }}>{fmtPct(pct1h)} 1h</div>}
          </div>
        </div>

        {history.length >= 2 && (
          <div style={{ marginBottom: 16, background: C.card2, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>PRICE CHART (live)</div>
            <svg width="100%" height="60" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ display: 'block' }}>
              {(() => {
                const min = Math.min(...history);
                const max = Math.max(...history);
                const range = max - min || min * 0.01 || 1;
                const pts = history.map((v, i) => {
                  const x = (i / (history.length - 1)) * 400;
                  const y = 55 - ((v - min) / range) * 50;
                  return x.toFixed(1) + ',' + y.toFixed(1);
                }).join(' ');
                const col = sparkUp == null ? C.accent : sparkUp ? C.green : C.down;
                return (
                  <g>
                    <polyline points={pts + ' 400,60 0,60'} fill={col + '22'} stroke="none" />
                    <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                );
              })()}
            </svg>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
          {[['5m', pct5m], ['1h', pct1h], ['24h', pct24h]].map(([label, val]) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: pctColor(val) }}>{val == null ? (loading ? '...' : '--') : fmtPct(val)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
          {[
            ['Market Cap', fmtMc(marketCap)],
            ['Volume 24h', fmtMc(volume)],
            ['Buys 24h', buys > 0 ? buys.toLocaleString() : '--'],
            ['Age', timeAgo(token.createdAt) + ' ago'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>

        {!isGrad && progress > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>BONDING CURVE</span>
              <span style={{ fontSize: 11, color: progress > 75 ? C.orange : C.muted, fontWeight: 700 }}>{progress.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: C.card3, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
            {progress >= 80 && <div style={{ marginTop: 5, fontSize: 10, color: C.orange }}>Almost to Raydium - {(100 - progress).toFixed(1)}% left</div>}
          </div>
        )}

        <div style={{ background: C.card3, borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{token.mint}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <button
          onClick={() => { setDrawerMode('buy'); setDrawerOpen(true); }}
          style={{ padding: '20px 10px', borderRadius: 16, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20, boxShadow: '0 0 28px rgba(0,229,255,.3)', minHeight: 60 }}
        >Buy {token.symbol}</button>
        <button
          onClick={() => { setDrawerMode('sell'); setDrawerOpen(true); }}
          style={{ padding: '20px 10px', borderRadius: 16, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.4)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20, boxShadow: '0 0 20px rgba(255,59,107,.1)', minHeight: 60 }}
        >Sell {token.symbol}</button>
      </div>

      <TradeDrawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)} mode={drawerMode}
        token={fullToken} solPrice={solPrice} onConnectWallet={onConnectWallet}
        isConnected={isConnected} isSolanaConnected={isSolanaConnected}
        presets={presets} onPresetsChange={onPresetsChange}
      />
    </div>
  );
}

function TokenCard({ token, onCardClick, onBuyClick, onSellClick, isNew }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (isNew) { setFlash(true); const t = setTimeout(() => setFlash(false), 5000); return () => clearTimeout(t); }
  }, [isNew]);

  const progress = token.bondingProgress || 0;
  const isGrad = token.graduated || progress >= 100;
  const pct = token.pct1h != null ? token.pct1h : token.pct5m != null ? token.pct5m : null;
  const pctLabel = token.pct1h != null ? '1h' : '5m';

  return (
    <div style={{ background: flash ? 'rgba(0,255,163,0.04)' : C.card, border: '1px solid ' + (flash ? 'rgba(0,255,163,.2)' : C.border), borderRadius: 14, padding: '12px 14px', marginBottom: 10, transition: 'background 0.8s, border 0.8s', boxSizing: 'border-box', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }} onClick={() => onCardClick(token)}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {token.image
            ? <img src={token.image} alt={token.symbol} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
            : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(153,69,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
          }
          {flash && <div style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: C.green, boxShadow: '0 0 8px ' + C.green }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol || '???'}</span>
            {isGrad
              ? <span style={{ background: 'rgba(0,255,163,.1)', color: C.green, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>GRAD</span>
              : <span style={{ background: 'rgba(153,69,255,.1)', color: C.purple, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>PUMP</span>
            }
            {flash && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>NEW</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {token.price > 0 && <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtPrice(token.price)}</span>}
            {token.marketCap > 0 && <span style={{ fontSize: 11, color: C.muted }}>{fmtMc(token.marketCap)}</span>}
            <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
            {token.buys24h > 0 && <span style={{ fontSize: 10, color: C.orange }}>{token.buys24h} buys</span>}
          </div>
          {!isGrad && progress > 0 && (
            <div style={{ marginTop: 5, height: 3, background: C.card3, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0 }}>
          {pct != null ? (
            <div style={{ background: pct >= 0 ? 'rgba(0,255,163,.12)' : 'rgba(59,158,255,.12)', border: '1px solid ' + (pct >= 0 ? 'rgba(0,255,163,.25)' : 'rgba(59,158,255,.25)'), borderRadius: 8, padding: '5px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: pctColor(pct) }}>{fmtPct(pct)}</div>
              <div style={{ fontSize: 9, color: C.muted2, marginTop: 1 }}>{pctLabel}</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.muted2 }}>--</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={e => { e.stopPropagation(); onBuyClick(token); }} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontWeight: 800, fontSize: 14, fontFamily: 'Syne, sans-serif', boxShadow: '0 0 14px rgba(0,229,255,.2)' }}>Buy</button>
        <button onClick={e => { e.stopPropagation(); onSellClick(token); }} style={{ flex: 1, padding: '11px', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.35)', color: C.red, fontWeight: 800, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Sell</button>
      </div>
    </div>
  );
}

export default function NewLaunches({ coins, onConnectWallet, isConnected, isSolanaConnected, walletAddress, resetKey }) {
  const [tokens, setTokens] = useState([]);
  const [tab, setTab] = useState('new');
  const [selectedToken, setSelectedToken] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [drawerToken, setDrawerToken] = useState(null);
  const [newMints, setNewMints] = useState(new Set());
  const [wsStatus, setWsStatus] = useState('connecting');
  const [presets, setPresets] = useState(loadPresets());
  const tokensRef = useRef([]);
  const dexQueueRef = useRef([]);
  const dexTimerRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const solCoin = coins && coins.find(c => c.id === 'solana');
  const solPrice = solCoin ? solCoin.current_price : 150;

  useEffect(() => { setSelectedToken(null); }, [resetKey]);

  const handlePresetsChange = p => { setPresets(p); savePresets(p); };

  const updateTokenDexData = useCallback(dexData => {
    let updated = false;
    tokensRef.current = tokensRef.current.map(t => {
      const d = dexData[t.mint];
      if (!d) return t;
      updated = true;
      const newPrice = d.price || t.price;
      const prevHistory = t.priceHistory || [];
      const newHistory = newPrice > 0 ? [...prevHistory, newPrice].slice(-30) : prevHistory;
      let pct1h = null, pct5m = null;
      if (newHistory.length >= 2) {
        const first = newHistory[0];
        const last = newHistory[newHistory.length - 1];
        if (first > 0) pct1h = ((last - first) / first) * 100;
        if (newHistory.length >= 4) {
          const older = newHistory[newHistory.length - 4];
          if (older > 0) pct5m = ((last - older) / older) * 100;
        }
      }
      return { ...t, ...d, priceHistory: newHistory, pct1h: d.pct1h != null ? d.pct1h : pct1h, pct5m: d.pct5m != null ? d.pct5m : pct5m };
    });
    if (updated) setTokens([...tokensRef.current]);
  }, []);

  const queueDexFetch = useCallback(mint => {
    if (!dexQueueRef.current.includes(mint)) dexQueueRef.current.push(mint);
    if (dexTimerRef.current) clearTimeout(dexTimerRef.current);
    dexTimerRef.current = setTimeout(async () => {
      const batch = dexQueueRef.current.splice(0, 30);
      if (!batch.length) return;
      const data = await fetchTokenData(batch);
      updateTokenDexData(data);
    }, 100);
  }, [updateTokenDexData]);

  const addToken = useCallback(token => {
    tokensRef.current = [token, ...tokensRef.current.filter(t => t.mint !== token.mint)].slice(0, 150);
    setTokens([...tokensRef.current]);
    fetchDexScreener([token.mint]).then(data => {
      const d = data[token.mint];
      if (!d) return;
      tokensRef.current = tokensRef.current.map(t =>
        t.mint !== token.mint ? t : { ...t, ...d, priceHistory: d.price > 0 ? [d.price] : [] }
      );
      setTokens([...tokensRef.current]);
    });
    queueDexFetch(token.mint);
  }, [queueDexFetch]);

  useEffect(() => {
    let ws, reconnectTimer;

    const connect = () => {
      try {
        ws = new WebSocket('wss://mainnet.helius-rpc.com/?api-key=45c791fa-d4fd-480e-aee3-7f998177b732');
        ws.onopen = () => {
          setWsStatus('live');
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'] }, { commitment: 'processed' }] }));
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'logsSubscribe', params: [{ mentions: ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'] }, { commitment: 'processed' }] }));
        };
        ws.onmessage = event => {
          try {
            const msg = JSON.parse(event.data);
            if (!msg.params?.result) return;
            const result = msg.params.result;
            const logs = result.value?.logs || [];
            const sig = result.value?.signature;
            if (!logs.length || !sig) return;
            let mintAddr = null;
            logs.forEach(log => {
              const match = log.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
              if (match) match.forEach(addr => { if (addr.length >= 32 && addr.length <= 44 && !mintAddr) mintAddr = addr; });
            });
            if (!mintAddr || tokensRef.current.find(t => t.mint === mintAddr)) return;
            const token = {
              mint: mintAddr, symbol: mintAddr.slice(0, 4).toUpperCase(), name: 'Loading...',
              image: null, marketCap: 0, price: 0,
              pct5m: null, pct1h: null, pct24h: null,
              volume24h: 0, buys24h: 0, priceHistory: [],
              bondingProgress: 0, graduated: false, createdAt: Date.now(),
            };
            setNewMints(prev => {
              const next = new Set(prev);
              next.add(mintAddr);
              setTimeout(() => setNewMints(p => { const n = new Set(p); n.delete(mintAddr); return n; }), 6000);
              return next;
            });
            addToken(token);
            setTimeout(() => {
              fetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + mintAddr)
                .then(r => r.json())
                .then(data => {
                  const attrs = data.data?.attributes;
                  if (!attrs) return;
                  tokensRef.current = tokensRef.current.map(t => {
                    if (t.mint !== mintAddr) return t;
                    const price = parseFloat(attrs.price_usd || 0);
                    return { ...t, name: attrs.name || t.name, symbol: attrs.symbol || t.symbol, image: attrs.image_url || null, price, marketCap: parseFloat(attrs.fdv_usd || attrs.market_cap_usd || 0), pct5m: attrs.price_change_percentage?.m5 ? parseFloat(attrs.price_change_percentage.m5) : null, pct1h: attrs.price_change_percentage?.h1 ? parseFloat(attrs.price_change_percentage.h1) : null, pct24h: attrs.price_change_percentage?.h24 ? parseFloat(attrs.price_change_percentage.h24) : null, volume24h: parseFloat(attrs.volume_usd?.h24 || 0), priceHistory: price > 0 ? [price] : [] };
                  });
                  setTokens([...tokensRef.current]);
                }).catch(() => {});
            }, 2000);
          } catch (e) {}
        };
        ws.onerror = () => setWsStatus('error');
        ws.onclose = () => { setWsStatus('reconnecting'); reconnectTimer = setTimeout(connect, 3000); };
      } catch (e) { setWsStatus('error'); reconnectTimer = setTimeout(connect, 5000); }
    };

    connect();

    const cached = loadCachedTokens();
    if (cached.length > 0) {
      tokensRef.current = cached;
      setTokens([...cached]);
      fetchJupiterPrices(cached.map(t => t.mint)).then(prices => {
        tokensRef.current = tokensRef.current.map(t => {
          const p = prices[t.mint];
          if (!p || !p.price) return t;
          return { ...t, price: p.price };
        });
        setTokens([...tokensRef.current]);
      });
    }

    refreshTimerRef.current = setInterval(async () => {
      const mints = tokensRef.current.slice(0, 30).map(t => t.mint);
      if (!mints.length) return;
      const data = await fetchDexScreener(mints);
      updateTokenDexData(data);
      saveCachedTokens(tokensRef.current);
    }, 15000);

    const loadInitial = async () => {
      try {
        const res = await fetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
        const data = await res.json();
        const pools = (data.data || []).slice(0, 30);
        if (!pools.length) return;
        const initialTokens = pools.map(pool => {
          const attrs = pool.attributes || {};
          const pChange = attrs.price_change_percentage || {};
          const txns = attrs.transactions || {};
          const price = parseFloat(attrs.base_token_price_usd || 0);
          let mintAddr = pool.relationships?.base_token?.data?.id;
          mintAddr = mintAddr ? mintAddr.replace('solana_', '') : null;
          if (!mintAddr) return null;
          return {
            mint: mintAddr,
            symbol: attrs.name ? attrs.name.split('/')[0] : '???',
            name: attrs.name ? attrs.name.split('/')[0] : 'Unknown',
            image: null,
            marketCap: parseFloat(attrs.fdv_usd || attrs.market_cap_usd || 0),
            price,
            pct5m: pChange.m5 ? parseFloat(pChange.m5) : null,
            pct1h: pChange.h1 ? parseFloat(pChange.h1) : null,
            pct24h: pChange.h24 ? parseFloat(pChange.h24) : null,
            volume24h: parseFloat(attrs.volume_usd?.h24 || 0),
            buys24h: txns.h24?.buys || 0,
            priceHistory: price > 0 ? [price] : [],
            bondingProgress: 0, graduated: false,
            createdAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : Date.now(),
          };
        }).filter(Boolean);
        tokensRef.current = initialTokens;
        setTokens([...tokensRef.current]);
        saveCachedTokens(tokensRef.current);
        fetchGeckoTerminal(initialTokens.map(t => t.mint)).then(gtData => {
          tokensRef.current = tokensRef.current.map(t => {
            const d = gtData[t.mint];
            if (!d) return t;
            return { ...t, image: d.image || t.image, name: d.name || t.name, symbol: d.symbol || t.symbol, price: d.price || t.price, marketCap: d.marketCap || t.marketCap, pct5m: d.pct5m !== null ? d.pct5m : t.pct5m, pct1h: d.pct1h !== null ? d.pct1h : t.pct1h, pct24h: d.pct24h !== null ? d.pct24h : t.pct24h };
          });
          setTokens([...tokensRef.current]);
          saveCachedTokens(tokensRef.current);
        });
      } catch (e) {}
    };
    loadInitial();

    return () => {
      clearTimeout(reconnectTimer);
      clearTimeout(dexTimerRef.current);
      clearInterval(refreshTimerRef.current);
      if (ws) ws.close();
    };
  }, [addToken, updateTokenDexData]);

  const displayTokens = [...tokens].sort((a, b) => {
    if (tab === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
    const scoreA = (a.volume24h || 0) + (a.buys24h || 0) * 10 + Math.abs(a.pct1h || a.pct5m || 0) * 100;
    const scoreB = (b.volume24h || 0) + (b.buys24h || 0) * 10 + Math.abs(b.pct1h || b.pct5m || 0) * 100;
    return scoreB - scoreA;
  });

  const openBuyDrawer = token => { setDrawerToken(token); setDrawerMode('buy'); setDrawerOpen(true); };
  const openSellDrawer = token => { setDrawerToken(token); setDrawerMode('sell'); setDrawerOpen(true); };

  if (selectedToken) {
    return (
      <TokenPage
        token={selectedToken} onBack={() => setSelectedToken(null)}
        onConnectWallet={onConnectWallet} isConnected={isConnected} isSolanaConnected={isSolanaConnected}
        solPrice={solPrice} presets={presets} onPresetsChange={handlePresetsChange}
      />
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: wsStatus === 'live' ? 'rgba(0,255,163,.08)' : 'rgba(255,149,0,.08)', border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.2)' : 'rgba(255,149,0,.2)'), borderRadius: 20, padding: '3px 10px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: wsStatus === 'live' ? C.green : C.orange, animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
            <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>
              {wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
            </span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{tokens.length} tokens tracked - tap any to trade</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => setTab('new')} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'new' ? 'rgba(0,229,255,.1)' : C.card2, border: '1px solid ' + (tab === 'new' ? 'rgba(0,229,255,.3)' : C.border), color: tab === 'new' ? C.accent : C.muted }}>New</button>
        <button onClick={() => setTab('trending')} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'trending' ? 'rgba(255,149,0,.1)' : C.card2, border: '1px solid ' + (tab === 'trending' ? 'rgba(255,149,0,.3)' : C.border), color: tab === 'trending' ? C.orange : C.muted }}>Trending</button>
      </div>

      {tab === 'trending' && (
        <div style={{ fontSize: 11, color: C.orange, marginBottom: 12, padding: '8px 12px', background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.2)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Ranked by volume, buys and price movement</span>
          <span style={{ color: C.muted2, fontSize: 10 }}>live</span>
        </div>
      )}

      {tokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: C.card, border: '1px solid ' + C.border, borderRadius: 16 }}>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>{wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting to live feed...'}</div>
          <div style={{ color: C.muted2, fontSize: 11 }}>Tokens appear here as they launch on Solana</div>
        </div>
      ) : (
        displayTokens.map(token => (
          <TokenCard
            key={token.mint} token={token}
            onCardClick={setSelectedToken}
            onBuyClick={openBuyDrawer}
            onSellClick={openSellDrawer}
            isNew={newMints.has(token.mint)}
          />
        ))
      )}

      <TradeDrawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)} mode={drawerMode}
        token={drawerToken} solPrice={solPrice} onConnectWallet={onConnectWallet}
        isConnected={isConnected} isSolanaConnected={isSolanaConnected}
        presets={presets} onPresetsChange={handlePresetsChange}
      />
    </div>
  );
}
